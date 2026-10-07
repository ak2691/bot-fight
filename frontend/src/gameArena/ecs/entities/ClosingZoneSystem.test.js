import assert from "node:assert/strict";
import test from "node:test";
import { applyDamageToShape } from "../../gameconfig/BotCombatSystem.js";
import { CLOSING_ZONE_CONFIG, TIMED_ROUNDS_V2_ZONE_CONFIG } from "../../gameconfig/ArenaHazardConfig.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../../modelPayloads/arenaConstants.js";
import {
    closingZoneSafeRadius,
    closingZoneWarningDiameter,
    tickClosingZoneWorld,
} from "./ClosingZoneSystem.js";

const arena = { width: ARENA_WIDTH_UNITS, height: ARENA_HEIGHT_UNITS };

function bot(overrides = {}) {
    return {
        id: "target",
        slot: 2,
        x: 900,
        y: 500,
        size: 60,
        hp: 100,
        maxHp: 100,
        ...overrides,
    };
}

test("closing zone stays absent before its configured start delay", () => {
    const target = bot();
    const result = tickClosingZoneWorld({
        bots: [target],
        elapsedMs: CLOSING_ZONE_CONFIG.startDelayMs - 100,
        stepMs: 100,
        ...arena,
    }, { applyDamageToShape });

    assert.equal(result.zone, null);
    assert.equal(result.bots[0].hp, 100);
});

test("closing zone caches its radius between one-second geometry updates", () => {
    const first = tickClosingZoneWorld({ bots: [bot()], elapsedMs: 15_000, stepMs: 100, ...arena }, { applyDamageToShape });
    const second = tickClosingZoneWorld({ bots: [bot()], zone: first.zone, elapsedMs: 15_900, stepMs: 100, ...arena }, { applyDamageToShape });
    const third = tickClosingZoneWorld({ bots: [bot()], zone: second.zone, elapsedMs: 16_000, stepMs: 100, ...arena }, { applyDamageToShape });

    assert.equal(second.zone.size, first.zone.size);
    assert.equal(second.zone, first.zone);
    assert.equal(second.zone.geometryElapsedMs, 0);
    assert.equal(third.zone.geometryElapsedMs, 1_000);
    assert.ok(third.zone.safeRadius < second.zone.safeRadius);
});

test("closing zone contracts for five seconds and holds for fifteen seconds", () => {
    const full = closingZoneSafeRadius(15_000, arena.width, arena.height);
    const firstTarget = closingZoneSafeRadius(20_000, arena.width, arena.height);
    const firstHold = closingZoneSafeRadius(25_000, arena.width, arena.height);
    const secondTarget = closingZoneSafeRadius(40_000, arena.width, arena.height);
    const secondHold = closingZoneSafeRadius(50_000, arena.width, arena.height);

    assert.ok(Math.abs(firstTarget - full * (2 / 3)) < 1e-9);
    assert.equal(firstHold, firstTarget);
    assert.ok(Math.abs(secondTarget - full * (1 / 3)) < 1e-9);
    assert.equal(secondHold, secondTarget);
    assert.equal(closingZoneSafeRadius(60_000, arena.width, arena.height), 0);

    const contracted = tickClosingZoneWorld({
        bots: [bot()],
        elapsedMs: 20_000,
        stepMs: 100,
        ...arena,
    }, { applyDamageToShape });
    const held = tickClosingZoneWorld({
        bots: [bot()],
        zone: contracted.zone,
        elapsedMs: 25_000,
        stepMs: 100,
        ...arena,
    }, { applyDamageToShape });
    assert.equal(held.zone, contracted.zone);
});

test("closing zone damages only bot hitboxes that reach the unsafe side", () => {
    const safe = bot({ x: 500, y: 500 });
    const unsafe = bot({ id: "unsafe", x: 30, y: 30 });
    const atDamageTick = tickClosingZoneWorld({
        bots: [safe, unsafe],
        elapsedMs: CLOSING_ZONE_CONFIG.startDelayMs
            + CLOSING_ZONE_CONFIG.approachDurationMs
            + CLOSING_ZONE_CONFIG.damageIntervalMs,
        stepMs: 100,
        ...arena,
    }, { applyDamageToShape });

    assert.equal(atDamageTick.bots[0].hp, 100);
    assert.equal(atDamageTick.bots[1].hp, 98);
    assert.equal(atDamageTick.bots[0].closingZoneDamageCount ?? 0, 0);
    assert.equal(atDamageTick.bots[1].closingZoneDamageCount, 1);
    assert.equal(closingZoneSafeRadius(60_000, arena.width, arena.height), 0);
});

// Parity: the server's ClosingZoneSystemTest checks these same numbers for ClosingZoneConfig.timedRoundsV2().
const V2_RADII = [
    [79_900, null],
    [80_000, 600],
    [82_500, 525],
    [85_000, 450],
    [99_900, 450],
    [100_000, 450],
    [102_500, 375],
    [105_000, 300],
    [120_000, 300],
];
const V2_WARNINGS = [
    [59_900, null],
    [60_000, 900],
    [79_900, 900],
    [80_000, 600],
    [99_900, 600],
    [100_000, null],
];

test("timed rounds zone matches the server schedule: rounds 5 and 6 only, 1200 -> 900 -> 600", () => {
    assert.equal(TIMED_ROUNDS_V2_ZONE_CONFIG.simulationDurationMs, 120_000);
    for (const [elapsedMs, radius] of V2_RADII) {
        const actual = closingZoneSafeRadius(elapsedMs, arena.width, arena.height, TIMED_ROUNDS_V2_ZONE_CONFIG);
        if (radius === null) assert.equal(actual, null, `radius at ${elapsedMs}`);
        else assert.ok(Math.abs(actual - radius) < 1e-9, `radius at ${elapsedMs}: ${actual}`);
    }
    for (const [elapsedMs, diameter] of V2_WARNINGS) {
        assert.equal(closingZoneWarningDiameter(elapsedMs, TIMED_ROUNDS_V2_ZONE_CONFIG), diameter, `warning at ${elapsedMs}`);
    }
    assert.equal(closingZoneWarningDiameter(60_000, CLOSING_ZONE_CONFIG), null);
});

test("timed rounds zone world tick starts at round 5 with a 1200-unit zone and damages outside bots", () => {
    const config = TIMED_ROUNDS_V2_ZONE_CONFIG;
    const before = tickClosingZoneWorld({ bots: [bot()], elapsedMs: 79_900, stepMs: 100, config, ...arena }, { applyDamageToShape });
    assert.equal(before.zone, null);
    const started = tickClosingZoneWorld({ bots: [bot({ x: 600, y: 600 })], elapsedMs: 80_000, stepMs: 100, config, ...arena }, { applyDamageToShape });
    assert.equal(started.zone.size, 1_200);
    assert.equal(started.bots[0].hp, 100);
    const corner = tickClosingZoneWorld({ bots: [bot({ x: 60, y: 60 })], elapsedMs: 80_500, stepMs: 100, config, ...arena }, { applyDamageToShape });
    assert.ok(corner.bots[0].hp < 100);
    const contracted = tickClosingZoneWorld({ bots: [bot({ x: 600, y: 600 })], elapsedMs: 85_000, stepMs: 100, config, ...arena }, { applyDamageToShape });
    assert.equal(contracted.zone.size, 900);
});
