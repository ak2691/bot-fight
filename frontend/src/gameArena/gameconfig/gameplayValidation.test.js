import assert from "node:assert/strict";
import test from "node:test";
import abilitiesFile from "../../../../shared/gameplay/abilities.json" with { type: "json" };
import channelsFile from "../../../../shared/gameplay/channels.json" with { type: "json" };
import movementFile from "../../../../shared/gameplay/movement.json" with { type: "json" };
import statusesFile from "../../../../shared/gameplay/statuses.json" with { type: "json" };
import { GAMEPLAY_DATA } from "../../../../shared/engine/gameconfig/gameplayData.js";
import { validateGameplayData } from "../../../../shared/engine/gameconfig/gameplayValidation.js";

// One valid data set, then one broken copy per rule. GameplayDataTest.java runs the same cases on the server.
const fresh = () => structuredClone({ abilities: abilitiesFile, statuses: statusesFile, movement: movementFile, channels: channelsFile });
const ability = (data, id) => data.abilities.abilities.find((entry) => entry.id === id);
const verb = (data, id, index = 0) => ability(data, id).onActivate[index];
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
    assert.equal(GAMEPLAY_DATA.abilities.abilities.length, 32);
    assert.equal(Object.isFrozen(GAMEPLAY_DATA), true);
    assert.equal(Object.isFrozen(GAMEPLAY_DATA.abilities.abilities[0].onActivate[0].effects[0]), true);
});

test("a trigger's radius is trigger.radius and the hitbox does not stand in for it", () => {
    // Proximity Mine's armed phase has a trigger event and a body: its hitbox, health and killed event.
    assertBroken("needs its own radius", (data) => { phase(data, 29, 0).trigger.radius = null; });
    assertBroken("a trigger event needs a trigger", (data) => { phase(data, 29, 0).trigger = null; });
    assertBroken("no collision, hit or killed event uses the hitbox", (data) => {
        delete phase(data, 29, 0).on.killed;
        phase(data, 29, 0).health = null;
        phase(data, 29, 0).hitbox.radius = 87.5;
    });
    // Snare Bomb keeps a body hitbox next to a different trigger radius because it has health and a killed event.
    assertBroken("no collision, hit or killed event uses the hitbox", (data) => {
        delete phase(data, 29, 0).on.killed;
        phase(data, 29, 0).health = null;
    });
});

test("trigger.contact replaces the removed trap flags and lists only BOT or SUMMON", () => {
    assertBroken("botContact", (data) => { phase(data, 29, 0).trigger.botContact = true; });
    assertBroken("attackHits", (data) => { phase(data, 29, 0).trigger.attackHits = true; });
    assertBroken("projectileOverlap", (data) => { phase(data, 29, 0).trigger.projectileOverlap = true; });
    assertBroken("needs a non-empty list", (data) => { phase(data, 29, 0).trigger.contact = []; });
    assertBroken("needs a non-empty list", (data) => { delete phase(data, 29, 0).trigger.contact; });
    assertBroken("FRIEND", (data) => { phase(data, 29, 0).trigger.contact = ["FRIEND"]; });
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
    assertBroken("unknown statusEffectType", (data) => { data.statuses.statuses.silence.effects[0].type = "bogus"; });
    assertBroken("unknown statusMode", (data) => { data.statuses.statuses.silence.effects[0].mode = "bogus"; });
});

test("3. every transition.to names a phase of that entity, every spawn an entity of its ability", () => {
    assertBroken("is not a phase of this entity", (data) => { eventVerb(data, 4, "lifetimeEnd", "transition").to = "nowhere"; });
    assertBroken("is not an entity of this ability", (data) => { verb(data, 4, 0).entity = "nowhere"; });
});

test("4. each verb runs where it is allowed", () => {
    assertBroken("unknown activationVerb", (data) => { ability(data, 1).onActivate.push({ do: "transition", to: "x" }); });
    assertBroken("unknown activationVerb", (data) => { ability(data, 1).onActivate.push({ do: "remove" }); });
    assertBroken("unknown eventVerb", (data) => { phase(data, 4).on.collision.do.push({ ...verb(data, 19), do: "move" }); });
    assertBroken("must target OWNER", (data) => { verb(data, 21).targets = ["BOT"]; });
    assertBroken("needs at least one verb", (data) => { ability(data, 1).onActivate = []; });
    assertBroken("hit needs at least one effect", (data) => { verb(data, 1).effects = []; });
    assertBroken("hit needs targets", (data) => { verb(data, 1).targets = []; });
    assertBroken("needs a hitbox", (data) => { verb(data, 1).hitbox = null; });
    assertBroken("move needs distance and unitsPerTick", (data) => { verb(data, 19).distance = null; });
    assertBroken("emitVisual needs a positive visibleMs", (data) => { eventVerb(data, 4, "collision", "emitVisual", 2).visibleMs = 0; });
});

test("5. every *Ms is a whole number of ticks within bounds", () => {
    assertBroken("not a multiple of 100 ms", (data) => { ability(data, 1).timing.cooldownMs = 250; });
    assertBroken("not a whole number of ms", (data) => { ability(data, 1).timing.windupMs = 5_000_000; });
    assertBroken("not a multiple of 100 ms", (data) => { eventVerb(data, 5, "collision", "applyEffects").effects[1].durationMs = 5050; });
    assertBroken("not a multiple of 100 ms", (data) => { eventVerb(data, 4, "collision", "emitVisual", 2).visibleMs = 250; });
    assertBroken("not a whole number of ms", (data) => { entity(data, 29).lifetime.duration = -100; });
    // No exceptions: the old 1 ms active time is gone, and a time field no named check covers is still held to ticks.
    assertBroken("not a multiple of 100 ms", (data) => { ability(data, 4).timing.activeMs = 1; });
    assertBroken("not a multiple of 100 ms", (data) => { phase(data, 4, 1).startMs = 50; });
    assertBroken("not a multiple of 100 ms", (data) => { data.statuses.statuses.parry.reactMs = 150; });
    assertBroken("regenDelayMs", (data) => { data.movement.config.regenDelayMs = 450; });
});

test("6. counts and sizes are in bounds", () => {
    assertBroken("maxCharges", (data) => { ability(data, 3).timing.maxCharges = 0; });
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
    assertBroken("displace needs distance or falloff", (data) => { verb(data, 8).effects[1].distance = null; });
    assertBroken("status needs durationMs or whileInside", (data) => { verb(data, 6).effects[1].durationMs = null; });
    assertBroken("status needs subtype", (data) => { verb(data, 21).effects[0].subtype = null; });
    assertBroken("status needs durationMs or whileInside", (data) => { verb(data, 30).effects[1].durationMs = null; });
    assertBroken("status needs durationMs or whileInside", (data) => { verb(data, 21).effects[0].durationMs = null; });
    assertBroken("status needs durationMs or whileInside", (data) => { verb(data, 21).effects[0].durationMs = null; });
});

test("displace replaces knockback, pull and teleport, and an owner moves only from an activation", () => {
    assertBroken("unknown effectType \"knockback\"", (data) => { verb(data, 8).effects[1].type = "knockback"; });
    assertBroken("unknown effectType \"teleport\"", (data) => { verb(data, 25).effects[0].type = "teleport"; });
    assertBroken("mirror takes no distance", (data) => { verb(data, 25).effects[0].distance = 40; });
    assertBroken("removed; a displace effect names its direction", (data) => { verb(data, 8).knockbackDirection = "velocity"; });
    assertBroken("removed; a second hit with targetPolicy",(data) => { ability(data, 25).activation.teleportOncePerActivation = true; });
    assertBroken("owner displace is a self move", (data) => { eventVerb(data, 28, "collision", "applyEffects", 1).effects[0].who = "owner"; });
});

test("8. every status an effect applies has a preset, and tokens are known", () => {
    assertBroken("has no preset in statuses.json", (data) => { verb(data, 6).effects[1].subtype = "zap"; });
    assertBroken("has no preset in statuses.json", (data) => { delete data.statuses.statuses.slow; });
    assertBroken("unknown token", (data) => { data.statuses.statuses.silence.effects[0].amount = "$bogus"; });
    assertBroken("has no preset in statuses.json", (data) => { data.statuses.statuses.shock.on.schedule.effects[1].subtype = "zap"; });
});

test("8b. status events are schedule or lifetimeEnd, whole ticks, with known effects and captures", () => {
    assertBroken("unknown statusEvent", (data) => { data.statuses.statuses.burn.on.tick = { effects: [] }; });
    assertBroken("a schedule needs intervalMs", (data) => { delete data.statuses.statuses.burn.on.schedule.intervalMs; });
    assertBroken("multiple of 100 ms", (data) => { data.statuses.statuses.burn.on.schedule.intervalMs = 150; });
    assertBroken("unknown effectType", (data) => { data.statuses.statuses.bleed.on.schedule.effects[0].type = "zap"; });
    assertBroken("unknown token", (data) => { data.statuses.statuses.burn.on.schedule.effects[0].amount = "$bogus"; });
    assertBroken("unknown statusCapture", (data) => { data.statuses.statuses.rewind.captures = ["z"]; });
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
    assertBroken("notReadyWhileBlocked", (data) => { data.channels.channels.dash.notReadyWhileBlocked = "yes"; });
    assertBroken("notReadyWhileBlocked", (data) => { delete data.channels.channels.ability.notReadyWhileBlocked; });
});

test("a block effect names only known actions and interrupts is a flag", () => {
    assertBroken("unknown blockAction", (data) => { data.statuses.statuses.slow.effects.find(({ type }) => type === "block").actions = ["jump"]; });
    assertBroken("block needs a list of actions", (data) => { data.statuses.statuses.silence.effects[0].actions = []; });
    assertBroken("interrupts", (data) => { data.statuses.statuses.stun.interrupts = "yes"; });
});

test("11. entity phases move in a known mode and timer events repeat", () => {
    assertBroken("straight movement needs unitsPerTick above 0", (data) => { phase(data, 4).movement.unitsPerTick = 0; });
    assertBroken("seek movement needs unitsPerTick above 0", (data) => { phase(data, 17).movement.unitsPerTick = 0; });
    assertBroken("seek needs turnDegrees", (data) => { phase(data, 17).movement.turnDegrees = null; });
    assertBroken("a schedule event repeats", (data) => { phase(data, 17).on.schedule.schedule.mode = "once"; });
    assertBroken("a schedule event needs intervalMs", (data) => { phase(data, 17).on.schedule.schedule.intervalMs = null; });
    assertBroken("only a schedule event waits for its hit", (data) => { phase(data, 4).on.collision.waitForHit = true; });
    assertBroken("bindToCast", (data) => { entity(data, 4).bindToCast = false; });
});

test("12. followOwner entities validate", () => {
    const data = fresh();
    const grenade = entity(data, 4);
    grenade.phases[0].movement = { mode: "followOwner", unitsPerTick: null, direction: null, turnDegrees: null, size: null };
    validateGameplayData(data);
});

test("13. nothing is delayed: no verb carries atMs (null and left out are the same)", () => {
    // Fireball's spawn verb, and a Basic Heal style applyEffects, run on the activation tick and nowhere else.
    const nulled = fresh();
    Object.assign(verb(nulled, 5, 0), { atMs: null });
    validateGameplayData(nulled);
    const omitted = fresh();
    delete verb(omitted, 5, 0).atMs;
    validateGameplayData(omitted);

    assertBroken("removed; anything over time", (data) => { verb(data, 5, 0).atMs = 0; });
    assertBroken("removed; anything over time", (data) => { verb(data, 5, 0).atMs = 100; });
    assertBroken("removed; anything over time", (data) => { verb(data, 19, 0).atMs = 200; });
    assertBroken("removed; anything over time", (data) => { eventVerb(data, 5, "collision", "applyEffects").atMs = 100; });
});

test("13a. no verb carries pose: a verb fires from the bot's current pose", () => {
    assertBroken("unknown field pose", (data) => { verb(data, 5, 0).pose = "current"; });
    assertBroken("unknown field pose", (data) => { eventVerb(data, 5, "collision", "applyEffects").pose = null; });
});

test("14. oncePerTarget is removed: targetPolicy replaces it", () => {
    assertBroken("removed; use targetPolicy", (data) => { verb(data, 1).oncePerTarget = "step"; });
    assertBroken("removed; use targetPolicy", (data) => { verb(data, 1).oncePerTarget = "activation"; });
    const nulled = fresh();
    verb(nulled, 1).oncePerTarget = null;
    validateGameplayData(nulled);
});

test("14a. an onActivate hit takes only { once, activation }, or no targetPolicy", () => {
    const omitted = fresh();
    delete verb(omitted, 1).targetPolicy;
    validateGameplayData(omitted);
    const hammer = fresh();
    verb(hammer, 1).targetPolicy = { mode: "once", scope: "activation" };
    validateGameplayData(hammer);
    assertBroken("takes only", (data) => { verb(data, 1).targetPolicy = { mode: "once", scope: "phase" }; });
    assertBroken("takes only", (data) => { verb(data, 1).targetPolicy = { mode: "once" }; });
    assertBroken("takes only", (data) => { verb(data, 1).targetPolicy = { mode: "everyTick" }; });
    assertBroken("only a hit verb or an entity event", (data) => { verb(data, 21).targetPolicy = { mode: "once", scope: "activation" }; });
});

test("14b. targetPolicy: a known mode and scope; intervalMs only with interval; a hit verb is never interval", () => {
    for (const policy of [
        { mode: "once" },
        { mode: "once", scope: "entity" },
        { mode: "everyTick", scope: "activation" },
        { mode: "interval", intervalMs: 200, scope: "phase" },
    ]) {
        const data = fresh();
        phase(data, 5).on.collision.targetPolicy = policy;
        validateGameplayData(data);
    }
    assertBroken("unknown targetPolicyScope", (data) => { phase(data, 5).on.collision.targetPolicy = { mode: "once", scope: "world" }; });
    assertBroken("needs intervalMs", (data) => { phase(data, 5).on.collision.targetPolicy = { mode: "interval" }; });
    assertBroken("only an interval policy has intervalMs", (data) => { phase(data, 5).on.collision.targetPolicy = { mode: "once", intervalMs: 200 }; });
    assertBroken("a hit verb takes once or everyTick", (data) => {
        eventVerb(data, 17, "schedule", "hit").targetPolicy = { mode: "interval", intervalMs: 200 };
    });
});

test("an effect's when checks name a known measure and carry only the fields that measure reads", () => {
    const withWhen = (when) => (data) => { verb(data, 6).effects[0].when = when; };
    assertBroken("unknown conditionMeasure", withWhen([{ of: "target", measure: "nope" }]));
    assertBroken("unknown conditionOp", withWhen([{ of: "target", measure: "hpRatio", value: 0.3 }]));
    assertBroken("hpRatio needs a number", withWhen([{ of: "target", measure: "hpRatio", op: "<", value: "0.3" }]));
    assertBroken("unknown conditionSubject", withWhen([{ measure: "hpRatio", op: "<", value: 0.3 }]));
    assertBroken("windingUp takes no op", withWhen([{ of: "target", measure: "windingUp", op: "<" }]));
    assertBroken("damageConfirmed takes no value", withWhen([{ measure: "damageConfirmed", value: true }]));
    assertBroken("distance does not read of", withWhen([{ of: "owner", measure: "distance", op: ">", value: 50 }]));
    assertBroken("hasStatus \"nope\" has no preset", withWhen([{ of: "target", measure: "hasStatus", value: "nope" }]));
    assertBroken("when needs a list of checks", withWhen([]));
    assertBroken("only an effect carries when", (data) => { verb(data, 6).when = [{ measure: "damageConfirmed" }]; });
});

test("removeStatus names a status preset", () => {
    assertBroken("removeStatus nope has no preset", (data) => { verb(data, 6).effects.push({ type: "remove_status", subtype: "nope", targetKinds: ["BOT"] }); });
});

test("a seek movement's target is nearestEnemy or owner, and only seek has one", () => {
    assertBroken("only seek movement has a target", (data) => { phase(data, 5).movement.target = "owner"; });
    assertBroken("unknown seekMoveTarget", (data) => { phase(data, 17).movement.target = "nope"; });
});

test("an entity event may name OWNER only as a collision, and then runs only remove, transition, spawn or emitVisual", () => {
    assertBroken("unknown eventTarget", (data) => { phase(data, 5).on.collision.targets = ["NOPE"]; });
    assertBroken("only a collision event may name OWNER", (data) => {
        phase(data, 17).on.schedule.targets = ["OWNER"];
    });
    assertBroken("applyEffects cannot run in an event that names OWNER unless", (data) => {
        phase(data, 5).on.collision.targets = ["BOT", "OWNER"];
        delete eventVerb(data, 5, "collision", "applyEffects").targets;
    });
    assertBroken("applyEffects cannot run in an event that names OWNER unless", (data) => {
        phase(data, 5).on.collision.targets = ["BOT", "OWNER"];
        eventVerb(data, 5, "collision", "applyEffects").targets = ["BOT", "OWNER"];
    });
    const ownerSafe = fresh();
    phase(ownerSafe, 5).on.collision.targets = ["BOT", "OWNER"];
    eventVerb(ownerSafe, 5, "collision", "applyEffects").targets = ["BOT"];
    validateGameplayData(ownerSafe);
    assertBroken("hit cannot run in an event that names OWNER unless", (data) => {
        phase(data, 5).on.collision.targets = ["OWNER"];
        phase(data, 5).on.collision.do = [{ do: "hit", hitbox: { shape: "circle", radius: 20 }, effects: [{ type: "damage", amount: 5, targetKinds: ["BOT"] }] }];
    });
});

test("every ability states its active time, and a trigger takes only the fields the runtime reads", () => {
    assertBroken("every ability states its active time", (data) => { delete ability(data, 5).timing.activeMs; });
    assertBroken("unknown trigger field", (data) => { phase(data, 29, 0).trigger.lifetimeMs = 16000; });
});

test("a status's reactions (hit, hitDealt) and charges are validated", () => {
    const reaction = (data, name, event) => { data.statuses.statuses.burn.on[name] = event; };
    const damage = { type: "damage", amount: "$hitAmount" };
    assertBroken("a reaction takes no intervalMs", (data) => reaction(data, "hit", { intervalMs: 100, effects: [damage] }));
    assertBroken("a reaction needs a list of effects", (data) => reaction(data, "hit", { target: "attacker" }));
    assertBroken("unknown reactionTarget", (data) => reaction(data, "hit", { target: "nope", effects: [damage] }));
    assertBroken("consume is a whole number", (data) => reaction(data, "hit", { consume: 0, effects: [damage] }));
    assertBroken("unknown reactionFrom", (data) => reaction(data, "hitDealt", { from: ["gun"], effects: [] }));
    assertBroken("belongs to a reaction", (data) => { data.statuses.statuses.burn.on.schedule.target = "attacker"; });
    assertBroken("hitAmount is set by an attack", (data) => { data.statuses.statuses.burn.on.schedule.effects[0].amount = "$hitAmount"; });
    assertBroken("charges", (data) => { data.statuses.statuses.burn.charges = 0; });
});

test("a retired id cannot be used again, and retiredIds holds positive integers", () => {
    assertBroken("is a retired id", (data) => { data.abilities.retiredIds = [...data.abilities.retiredIds, 3]; });
    assertBroken("retiredIds", (data) => { data.abilities.retiredIds = [0]; });
    const cutList = fresh();
    cutList.abilities.retiredIds = [...cutList.abilities.retiredIds, 99];
    validateGameplayData(cutList);
});
