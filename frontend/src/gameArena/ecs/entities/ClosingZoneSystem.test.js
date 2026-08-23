import assert from "node:assert/strict";
import test from "node:test";
import { applyDamageToShape } from "../../gameconfig/BotCombatSystem.js";
import { CLOSING_ZONE_CONFIG } from "../../gameconfig/ArenaHazardConfig.js";
import {
    closingZoneSafeRadius,
    tickClosingZoneWorld,
} from "./ClosingZoneSystem.js";

const arena = { width: 1000, height: 1000 };

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
