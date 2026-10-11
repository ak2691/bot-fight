import assert from "node:assert/strict";
import test from "node:test";
import abilitiesFile from "../../../../shared/gameplay/abilities.json" with { type: "json" };
import channelsFile from "../../../../shared/gameplay/channels.json" with { type: "json" };
import movementFile from "../../../../shared/gameplay/movement.json" with { type: "json" };
import statusesFile from "../../../../shared/gameplay/statuses.json" with { type: "json" };
import { GAMEPLAY_DATA } from "./gameplayData.js";
import { validateGameplayData } from "./gameplayValidation.js";

// One valid data set, then one broken copy per rule. GameplayDataTest.java runs the same cases on the server.
const fresh = () => structuredClone({ abilities: abilitiesFile, statuses: statusesFile, movement: movementFile, channels: channelsFile });
const ability = (data, id) => data.abilities.abilities.find((entry) => entry.id === id);
const verb = (data, id, index = 0) => ability(data, id).onTrigger[index];
const entity = (data, id) => Object.values(ability(data, id).entities)[0];
const phase = (data, id, index = 0) => entity(data, id).phases[index];
const eventVerb = (data, id, eventType, kind, phaseIndex = 0) =>
    phase(data, id, phaseIndex).on[eventType].do.find((candidate) => candidate.do === kind);

function assertBroken(expected, edit) {
    const data = fresh();
    edit(data);
    assert.throws(() => validateGameplayData(data), (error) => {
        assert.match(error.message, new RegExp(expected));
        return true;
    });
}

test("the shipped files are valid and the loaded data is frozen", () => {
    validateGameplayData(fresh());
    assert.equal(GAMEPLAY_DATA.abilities.abilities.length, 36);
    assert.equal(Object.isFrozen(GAMEPLAY_DATA), true);
    assert.equal(Object.isFrozen(GAMEPLAY_DATA.abilities.abilities[0].onTrigger[0].effects[0]), true);
});

test("a trigger's radius is trigger.radius and the hitbox does not stand in for it", () => {
    // Proximity Mine's armed phase has a trigger event and no collision, hit or killed event.
    assertBroken("needs its own radius", (data) => { phase(data, 11, 1).trigger.radius = null; });
    assertBroken("a trigger event needs a trigger", (data) => { phase(data, 11, 1).trigger = null; });
    assertBroken("no collision, hit or killed event uses the hitbox", (data) => { phase(data, 11, 1).hitbox.radius = 87.5; });
    // Snare Bomb keeps a body hitbox next to a different trigger radius because it has health and a killed event.
    assertBroken("no collision, hit or killed event uses the hitbox", (data) => {
        delete phase(data, 29, 0).on.killed;
        phase(data, 29, 0).health = null;
    });
});

test("1. ids are unique positive integers", () => {
    assertBroken("duplicate id 1", (data) => { ability(data, 3).id = 1; });
    assertBroken("not a positive integer", (data) => { ability(data, 3).id = 0; });
    assertBroken("duplicate name", (data) => { ability(data, 3).name = "slash"; });
    assertBroken("duplicate label", (data) => { ability(data, 3).label = "Slash"; });
});

test("2. every closed vocabulary value is known", () => {
    assertBroken("unknown phaseType", (data) => { phase(data, 4).type = "bogus"; });
    assertBroken("unknown category", (data) => { entity(data, 4).category = "bogus"; });
    assertBroken("unknown effectType", (data) => { verb(data, 1).effects[0].type = "bogus"; });
    assertBroken("unknown eventType", (data) => { phase(data, 4).on.bogus = phase(data, 4).on.collision; });
    assertBroken("unknown targetKind", (data) => { verb(data, 1).effects[0].targetKinds.push("NOBODY"); });
    assertBroken("unknown verbTarget", (data) => { verb(data, 1).targets.push("NOBODY"); });
    assertBroken("unknown scheduleMode", (data) => { phase(data, 4).on.collision.schedule.mode = "bogus"; });
    assertBroken("unknown movementMode", (data) => { phase(data, 4).movement.mode = "bogus"; });
    assertBroken("unknown patternType", (data) => { verb(data, 4, 0).pattern = { type: "bogus", count: 3 }; });
    assertBroken("unknown hitAim", (data) => { eventVerb(data, 17, "schedule", "hit").aim = "bogus"; });
    assertBroken("unknown statusEffectType", (data) => { data.statuses.statuses.burn.effects[0].type = "bogus"; });
    assertBroken("unknown statusMode", (data) => { data.statuses.statuses.burn.effects[0].mode = "bogus"; });
});

test("3. every transition.to names a phase of that entity, every spawn an entity of its ability", () => {
    assertBroken("is not a phase of this entity", (data) => { eventVerb(data, 4, "lifetimeEnd", "transition").to = "nowhere"; });
    assertBroken("is not an entity of this ability", (data) => { verb(data, 4, 0).entity = "nowhere"; });
});

test("4. each verb runs where it is allowed", () => {
    assertBroken("unknown triggerVerb", (data) => { ability(data, 1).onTrigger.push({ do: "transition", to: "x" }); });
    assertBroken("unknown triggerVerb", (data) => { ability(data, 1).onTrigger.push({ do: "remove" }); });
    assertBroken("unknown eventVerb", (data) => { phase(data, 4).on.collision.do.push({ ...verb(data, 19), do: "move" }); });
    assertBroken("must target OWNER", (data) => { verb(data, 10).targets = ["BOT"]; });
    assertBroken("needs at least one verb", (data) => { ability(data, 1).onTrigger = []; });
    assertBroken("hit needs at least one effect", (data) => { verb(data, 1).effects = []; });
    assertBroken("hit needs targets", (data) => { verb(data, 1).targets = []; });
    assertBroken("needs a hitbox", (data) => { verb(data, 1).hitbox = null; });
    assertBroken("move needs distance and unitsPerTick", (data) => { verb(data, 19).distance = null; });
    assertBroken("unknown faceTarget", (data) => { verb(data, 20).target = "somewhere"; });
    assertBroken("emitVisual needs a positive visibleMs", (data) => { eventVerb(data, 4, "collision", "emitVisual", 2).visibleMs = 0; });
});

test("5. every *Ms is a whole number of ticks within bounds", () => {
    assertBroken("not a multiple of 100 ms", (data) => { ability(data, 1).timing.cooldownMs = 250; });
    assertBroken("not a whole number of ms", (data) => { ability(data, 1).timing.windupMs = 5_000_000; });
    assertBroken("not a multiple of 100 ms", (data) => { eventVerb(data, 5, "collision", "applyEffects").effects[1].durationMs = 5050; });
    assertBroken("not a multiple of 100 ms", (data) => { eventVerb(data, 4, "collision", "emitVisual", 2).visibleMs = 250; });
    assertBroken("not a whole number of ms", (data) => { entity(data, 11).lifetime.duration = -100; });
    assertBroken("regenDelayMs", (data) => { data.movement.config.regenDelayMs = 450; });
});

test("6. counts and sizes are in bounds", () => {
    assertBroken("maxCharges", (data) => { ability(data, 12).timing.maxCharges = 0; });
    assertBroken("health.hp", (data) => { phase(data, 17).health.hp = 0; });
    assertBroken("hitbox.radius", (data) => { verb(data, 8).hitbox.radius = 99_999; });
    assertBroken("visual.visualSize", (data) => { verb(data, 1).visual.visualSize = 5000; });
    assertBroken("hitbox.arc", (data) => { verb(data, 1).hitbox.arc = 400; });
    assertBroken("pattern.count", (data) => { verb(data, 4, 0).pattern = { type: "ring", count: 13 }; });
    assertBroken("pattern.count", (data) => { verb(data, 4, 0).pattern = { type: "ring", count: 0 }; });
    assertBroken("fan needs spreadDeg", (data) => { verb(data, 4, 0).pattern = { type: "fan", count: 3 }; });
    assertBroken("line needs spacing", (data) => { verb(data, 4, 0).pattern = { type: "line", count: 3 }; });
});

test("6b. spawn patterns of 1 to 12 entities validate", () => {
    for (const count of [1, 7, 12]) {
        const data = fresh();
        verb(data, 4, 0).pattern = { type: "fan", count, spreadDeg: 40 };
        validateGameplayData(data);
    }
});

test("7. an effect carries the fields its type needs", () => {
    assertBroken("damage needs amount or falloff", (data) => { verb(data, 1).effects[0].amount = null; });
    assertBroken("knockback needs amount", (data) => { verb(data, 8).effects[1].amount = null; });
    assertBroken("status needs durationMs or whileInside", (data) => { verb(data, 9).effects[1].durationMs = null; });
    assertBroken("buff needs buff", (data) => { verb(data, 33).effects[0].buff = null; });
    assertBroken("interrupt needs durationMs", (data) => { verb(data, 30).effects[1].durationMs = null; });
    assertBroken("restore_state needs delayMs", (data) => { verb(data, 21).effects[0].delayMs = null; });
    assertBroken("damage_reduction needs durationMs", (data) => { verb(data, 16).effects[0].durationMs = null; });
    assertBroken("teleport needs distanceMode or amount", (data) => { verb(data, 25).effects[0].distanceMode = null; });
});

test("8. every status an effect applies has a preset, and tokens are known", () => {
    assertBroken("has no preset in statuses.json", (data) => { verb(data, 9).effects[1].subtype = "zap"; });
    assertBroken("has no preset in statuses.json", (data) => { delete data.statuses.statuses.slow; });
    assertBroken("unknown token", (data) => { data.statuses.statuses.burn.effects[0].amount = "$bogus"; });
});

test("9. movement numbers are whole and in bounds", () => {
    assertBroken("ticks every 100 ms", (data) => { data.movement.tickMs = 50; });
    assertBroken("staminaMax", (data) => { data.movement.config.staminaMax = 100.5; });
    assertBroken("windupCancelCost", (data) => { data.movement.config.windupCancelCost = -1; });
    assertBroken("sprintDrainPerTick", (data) => { data.movement.config.sprintDrainPerTick = 5000; });
});

test("10. abilities name a channel, and only the dash channel may cost stamina", () => {
    assertBroken("unknown channel", (data) => { ability(data, 1).channel = "bogus"; });
    assertBroken("only the dash channel may declare a stamina cost", (data) => { ability(data, 1).cost = { stamina: 10 }; });
    assertBroken("only the dash channel may declare a stamina cost", (data) => { ability(data, 19).channel = "ability"; });
    assertBroken("cost.stamina", (data) => { ability(data, 19).cost.stamina = 0; });
    assertBroken("cost.stamina", (data) => { ability(data, 19).cost.stamina = 150; });
    assertBroken("has no preset in statuses.json", (data) => { data.channels.channels.dash.blockedByStatuses.push("bogus"); });
    assertBroken("blockedByStatuses", (data) => { data.channels.channels.ability.blockedByStatuses = "stun"; });
    assertBroken("notReadyWhileStatuses", (data) => { data.channels.channels.dash.notReadyWhileStatuses = "slow"; });
    assertBroken("is not one of the channel's blockedByStatuses", (data) => { data.channels.channels.ability.notReadyWhileStatuses = ["slow"]; });
});

test("11. entity phases move in a known mode and timer events repeat", () => {
    assertBroken("straight movement needs unitsPerTick above 0", (data) => { phase(data, 4).movement.unitsPerTick = 0; });
    assertBroken("seek movement needs unitsPerTick above 0", (data) => { phase(data, 17).movement.unitsPerTick = 0; });
    assertBroken("seek needs turnDegrees", (data) => { phase(data, 17).movement.turnDegrees = null; });
    assertBroken("a schedule event repeats", (data) => { phase(data, 17).on.schedule.schedule.mode = "once"; });
    assertBroken("a schedule event needs intervalMs", (data) => { phase(data, 17).on.schedule.schedule.intervalMs = null; });
    assertBroken("only a schedule event waits for its hit", (data) => { phase(data, 4).on.collision.waitForHit = true; });
});

test("12. followOwner entities validate", () => {
    const data = fresh();
    const grenade = entity(data, 4);
    grenade.phases[0].movement = { mode: "followOwner", unitsPerTick: null, direction: null, turnDegrees: null, size: null };
    validateGameplayData(data);
});

test("13. trigger verbs sit on the ability's timeline", () => {
    // Fireball: one spawn verb, 500 ms active. Rewind: applyEffects then spawn, 300 ms active.
    const delay = (data, id, index, atMs, pose) => { Object.assign(verb(data, id, index), { atMs, pose }); };
    for (const [atMs, pose] of [[100, "current"], [500, "current"], [0, null]]) {
        const data = fresh();
        delay(data, 5, 0, atMs, pose);
        validateGameplayData(data);
    }
    const captured = fresh();
    delay(captured, 5, 0, 200, "captured");
    captured.abilities.abilities.find((entry) => entry.id === 5).activation.capture = { stepX: "x", stepY: "y", stepRotation: "rotation" };
    validateGameplayData(captured);
    const ordered = fresh();
    delay(ordered, 21, 0, 100, "current");
    delay(ordered, 21, 1, 200, "current");
    validateGameplayData(ordered);

    assertBroken("after the ability's activeMs", (data) => delay(data, 5, 0, 600, "current"));
    assertBroken("not a multiple of 100", (data) => delay(data, 5, 0, 150, "current"));
    assertBroken("non-decreasing atMs order", (data) => delay(data, 21, 0, 200, "current"));
    assertBroken("cannot be delayed", (data) => delay(data, 20, 0, 100, "current"));
    assertBroken("cannot be delayed", (data) => delay(data, 19, 0, 100, "current"));
    assertBroken("unknown verbPose null", (data) => delay(data, 5, 0, 200, null));
    assertBroken("unknown verbPose", (data) => delay(data, 5, 0, 200, "bogus"));
    assertBroken("pose is only for a delayed verb", (data) => delay(data, 5, 0, null, "current"));
    assertBroken("pose is only for a delayed verb", (data) => delay(data, 5, 0, 0, "current"));
    assertBroken("captured needs activation.capture", (data) => delay(data, 5, 0, 200, "captured"));
    assertBroken("atMs: missing", (data) => { delete verb(data, 5, 0).atMs; });
    assertBroken("pose: missing", (data) => { delete verb(data, 5, 0).pose; });
    assertBroken("only an onTrigger verb has atMs", (data) => { eventVerb(data, 5, "collision", "applyEffects").atMs = 100; });
});

test("14. oncePerTarget is a scope: step, activation or none", () => {
    for (const scope of ["step", "activation", null]) {
        const data = fresh();
        verb(data, 1).oncePerTarget = scope;
        validateGameplayData(data);
    }
    assertBroken("unknown oncePerTarget", (data) => { verb(data, 1).oncePerTarget = "bogus"; });
    assertBroken("unknown oncePerTarget", (data) => { verb(data, 1).oncePerTarget = true; });
    assertBroken("oncePerTarget: missing", (data) => { delete verb(data, 1).oncePerTarget; });
});
