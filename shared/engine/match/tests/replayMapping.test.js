import assert from "node:assert/strict";
import test from "node:test";
import { createMatchBots } from "../botSetup.js";
import { replayBot, replayBotStatic, replayEntity, replayFrame, replayInitialState, replayResult, teamLabel } from "../replayMapping.js";

const idle = { version: 2, customVariables: [], loadout: { abilities: [] }, roots: [] };

function matchBots(overrides = []) {
    const base = [
        { userId: "alpha", username: "Alpha", slot: 1, x: 600, y: 150, rotation: null, size: 60, selectedLoadout: "custom:", brain: idle, initialHp: null, teamNumber: 1 },
        { userId: "bravo", username: "Bravo", slot: 2, x: 600, y: 1050, rotation: null, size: 60, selectedLoadout: "custom:", brain: idle, initialHp: null, teamNumber: 2 },
    ];
    const bots = base.map((bot, index) => ({ ...bot, ...(overrides[index] ?? {}) }));
    return createMatchBots({ bots }, { initialElapsedMs: 0 });
}

test("static bot metadata drops a zero rotation and keeps the standard abilities", () => {
    const [first] = matchBots([{ rotation: 0 }]);
    const dto = replayBotStatic(first);

    assert.equal("rotation" in dto, false);
    assert.deepEqual(dto.abilities, [19, 20, 34]);
    assert.deepEqual(dto.abilityCooldowns, { 19: 0, 20: 0, 34: 0 });
    assert.equal(dto.teamNumber, 1);
    assert.equal(dto.maxHp, 150);
});

test("dynamic bot state omits zero timers and null trigger fields", () => {
    const [first] = matchBots();
    const shape = {
        ...first,
        abilityCooldowns: { 19: 0, 20: 35 },
        abilityActiveMs: { 19: 0, 34: 200 },
        abilityCharges: { 1: 0, 3: 2 },
        abilityRechargeMs: { 1: 500, 3: 0 },
    };
    const dto = replayBot(shape);

    assert.deepEqual(dto.abilityCooldowns, { 20: 35 });
    assert.deepEqual(dto.abilityActiveMs, { 34: 200 });
    assert.deepEqual(dto.abilityCharges, { 1: 0, 3: 2 });
    assert.deepEqual(dto.abilityRechargeMs, { 1: 500 });
    assert.equal("triggeredAbility" in dto, false);
    assert.equal("preparingAbility" in dto, false);
    assert.equal("preparingMs" in dto, false);
    assert.equal("statusEffects" in dto, true);
});

test("trigger-only fields appear only on the tick an ability fires", () => {
    const [first] = matchBots();
    const idleTick = replayBot({ ...first, triggeredAbility: null, abilityTargetX: 200, abilityTargetY: 300 });
    const firing = replayBot({ ...first, triggeredAbility: 1, abilityTargetX: 200, abilityTargetY: 300 });

    assert.equal("abilityTargetX" in idleTick, false);
    assert.equal(firing.triggeredAbility, 1);
    assert.equal(firing.abilityTargetX, 200);
    assert.equal(firing.abilityTargetY, 300);
    assert.equal("visualOriginX" in firing, false);
    const abilityVisual = { ability: 1, ms: 300, x: 620.5, y: 140, rotation: 75 };
    const visual = replayBot({ ...first, triggeredAbility: 1, abilityVisual });
    assert.equal(visual.visualOriginX, 620.5);
    assert.equal(visual.visualOriginY, 140);
    assert.equal(visual.visualOriginRotation, 75);
    // Like Java, the origin is sent only on the trigger tick, not while the visual lingers.
    assert.equal("visualOriginX" in replayBot({ ...first, triggeredAbility: null, abilityVisual }), false);
});

test("dash direction is only reported while a dash is visible", () => {
    const [first] = matchBots();
    const settled = replayBot({ ...first, dashRemaining: 0, abilityActiveMs: {}, dashDirectionX: 1, dashDirectionY: 0 });
    const dashing = replayBot({ ...first, dashRemaining: 40, abilityActiveMs: {}, dashDirectionX: 1, dashDirectionY: 0 });

    assert.equal("dashDirectionX" in settled, false);
    assert.equal(dashing.dashDirectionX, 1);
    assert.equal(dashing.dashDirectionY, 0);
});

test("temporal rewind coordinates only exist while a pulse is active", () => {
    const [first] = matchBots();
    const quiet = replayBot({ ...first, temporalRewindPulseMs: 0, temporalRewindX: 5, temporalRewindY: 6 });
    const pulsing = replayBot({ ...first, temporalRewindPulseMs: 250, temporalRewindX: 5.25, temporalRewindY: 6 });

    assert.equal("temporalRewindPulseMs" in quiet, false);
    assert.equal("temporalRewindX" in quiet, false);
    assert.equal(pulsing.temporalRewindPulseMs, 250);
    assert.equal(pulsing.temporalRewindX, 5.25);
});

test("entities map drone hp, drop empty status and null fields, and keep armed as a boolean", () => {
    const drone = replayEntity({
        id: "hunterDrone-bot-1-2", type: "hunterDrone", abilityId: 17, x: 10.1234, y: 20, size: 40.4,
        rotation: 0, hp: 0, armed: undefined, remainingMs: 0, velocityX: 0, velocityY: 3,
        phaseId: "travel", phaseTimerMs: 0, statusEffects: [],
    });
    const mine = replayEntity({
        id: "mine-1", type: "mine", abilityId: 11, x: 5, y: 6, size: 30, rotation: 90, hp: 0,
        armed: true, remainingMs: 4000, velocityX: 0, velocityY: 0, phaseId: "armed", phaseTimerMs: 300,
        statusEffects: [{ type: "burn" }],
    });

    assert.equal(drone.x, 10.123);
    assert.equal(drone.size, 40);
    assert.equal(drone.hp, 0);
    assert.equal(drone.armed, false);
    assert.equal("timerMs" in drone, false);
    assert.equal("velocityX" in drone, false);
    assert.equal(drone.velocityY, 3);
    assert.equal("statusEffects" in drone, false);
    assert.equal("hp" in mine, false);
    assert.equal(mine.armed, true);
    assert.equal(mine.timerMs, 4000);
    assert.equal(mine.rotation, 90);
    assert.deepEqual(mine.statusEffects, [{ type: "burn" }]);
    assert.equal("eventType" in mine, false);
    assert.equal("eventPhaseId" in mine, false);
    assert.equal("eventSequence" in mine, false);
});

test("an entity that has fired an event carries its event fields", () => {
    const fired = replayEntity({
        id: "mine-1", type: "mine", abilityId: 11, x: 5, y: 6, size: 30, hp: 0, armed: true,
        remainingMs: 0, phaseId: "armed", phaseTimerMs: 0,
        eventType: "detonate", eventPhaseId: "armed", eventSequence: 2,
    });
    const unfired = replayEntity({
        id: "mine-2", type: "mine", abilityId: 11, x: 5, y: 6, size: 30, phaseId: "armed",
        eventType: "detonate", eventPhaseId: "armed", eventSequence: 0,
    });

    assert.equal(fired.eventType, "detonate");
    assert.equal(fired.eventPhaseId, "armed");
    assert.equal(fired.eventSequence, 2);
    assert.equal("eventSequence" in unfired, false);
});

test("frames omit empty bot and entity lists", () => {
    const shapes = matchBots();

    assert.deepEqual(Object.keys(replayFrame(100, shapes)), ["elapsedMs", "bots"]);
    assert.equal(replayFrame(100, shapes).elapsedMs, 100);
    assert.deepEqual(replayFrame(100, shapes.slice(0, 0)), { elapsedMs: 100 });
});

test("initialState is empty when there are no bots", () => {
    assert.deepEqual(replayInitialState([]), {});
});

test("results name the winning team and omit the winner for a draw", () => {
    const [alpha] = matchBots();

    assert.deepEqual(replayResult(alpha), {
        result: "BOT_WIN",
        winnerUserId: "alpha",
        message: "Blue Team wins.",
    });
    assert.deepEqual(replayResult(null), {
        result: "DRAW",
        message: "The fight ended in a draw.",
    });
    assert.equal(teamLabel(2), "Red Team");
    assert.equal(teamLabel(3), "Blue Team");
});
