import {
    ENTITY_CATEGORIES,
    DISPLACE_DIRECTION,
    DISPLACE_FROM,
    DISPLACE_WHO,
    CONDITION_MEASURES,
    CONDITION_OPS,
    EFFECT_TYPES,
    EVENT_SCHEDULE_MODES,
    MOVEMENT_MODES,
    OWNER_TARGET,
    PHASE_EVENT_TYPES,
    SEEK_TARGETS,
    PHASE_TYPES,
    SPAWN_PATTERN_TYPES,
    BLOCK_ACTIONS,
    MODIFIER_STATS,
    STATUS_EFFECT_APPLICATIONS,
    HIT_AMOUNT_TOKEN,
    REACTION_TARGETS,
    STATUS_REACTION_EVENTS,
    TARGET_KINDS,
    TARGET_POLICY_MODES,
    TARGET_POLICY_SCOPES,
    VERBS,
} from "./vocabulary.js";

/**
 * Semantic checks for shared/gameplay/*.json, run when the module loads (so a bad file fails every test).
 * A field that does not apply is left out of the file; checks only report, they never fill values in.
 *
 *  1. ability ids are unique positive integers; names and labels are unique
 *  2. every closed vocabulary value is a known one
 *  3. every transition.to names a phase of that entity; every spawn names an entity of its ability
 *  4. onActivate verbs are hit, spawn, move or applyEffects (applyEffects there targets OWNER); entity event
 *     verbs are hit, spawn, applyEffects, transition, remove or emitVisual
 *  5. every *Ms is a whole number of 100 ms ticks within bounds
 *  6. counts and sizes are within bounds; a spawn pattern has a count of 1..12 and the fields its type needs;
 *     a spawn verb names one entity, so several entities of one verb always come from a pattern
 *  7. an effect carries the fields its type needs; a hit or applyEffects verb applies at least one effect; a displace
 *     names who, from and direction, takes a distance or falloff (none for mirror), and moves its owner only in onActivate
 *  8. every status an effect applies has a preset in statuses.json, and its tokens are known; a block effect
 *     lists known actions (ability, dash, move, sprint, fastTurn); a modifier names a known stat and a finite
 *     `multiply` of 0 or more (only incomingDamage may carry excludedDamageSourceTypes and rounding);
 *     `interrupts` is true or false; a preset's `on` holds only the schedule (a whole tick interval) and
 *     lifetimeEnd events, with known effects; `captures` lists only x, y and hp
 *  9. movement.json numbers are whole and in bounds
 * 10. every ability names a channel of channels.json; a channel's `notReadyWhileBlocked` is true or false; only the
 *     dash channel may declare a stamina cost, a whole number in 1..staminaMax
 * 11. no verb carries `atMs` (the timeline is gone: anything over time is an attached entity) or `pose`, and no
 *     verb carries `oncePerTarget` (its job is `targetPolicy`); a `targetPolicy`, when present, has a mode (everyTick,
 *     once, or interval with a whole-tick intervalMs) and a scope (phase, entity or activation, left out = phase).
 *     A hit verb takes once or everyTick; an onActivate hit with a targetPolicy takes only once with scope activation;
 *     entities have no `bindToCast`
 * 12. an entity phase moves in a known mode (straight, static, seek or followOwner) with the numbers it needs;
 *     a timer (`schedule`) event repeats at a whole tick interval
 * 13. an ability is a weapon (`weapon: true`), a tier 1, 2 or 3 ability (`tier`), or neither (standard abilities
 *     such as Dash); never both. Tier and weapon are the only loadout-round data; Spring reads the same fields
 */
// The closed vocabularies come from the engine's enums (gameconfig/vocabulary.js), so the validator and the runtime
// cannot drift. Lists with no engine enum are written here.
export const VOCABULARY = Object.freeze({
    category: Object.values(ENTITY_CATEGORIES),
    phaseType: Object.values(PHASE_TYPES),
    eventType: Object.values(PHASE_EVENT_TYPES),
    verb: Object.values(VERBS),
    activationVerb: [VERBS.HIT, VERBS.SPAWN, VERBS.MOVE, VERBS.APPLY_EFFECTS],
    eventVerb: [VERBS.HIT, VERBS.SPAWN, VERBS.APPLY_EFFECTS, VERBS.TRANSITION, VERBS.REMOVE, VERBS.EMIT_VISUAL],
    // An attached entity's events may also move its owner (a lunge).
    attachedEventVerb: [VERBS.HIT, VERBS.SPAWN, VERBS.APPLY_EFFECTS, VERBS.TRANSITION, VERBS.REMOVE, VERBS.EMIT_VISUAL, VERBS.MOVE],
    triggerContact: ["BOT", "SUMMON"],
    movementMode: Object.values(MOVEMENT_MODES),
    movementDirection: ["forward", "backward"],
    patternType: Object.values(SPAWN_PATTERN_TYPES),
    effectType: Object.values(EFFECT_TYPES),
    targetKind: Object.values(TARGET_KINDS),
    verbTarget: [OWNER_TARGET, ...Object.values(TARGET_KINDS)],
    scheduleMode: Object.values(EVENT_SCHEDULE_MODES),
    targetPolicyMode: Object.values(TARGET_POLICY_MODES),
    targetPolicyScope: Object.values(TARGET_POLICY_SCOPES),
    rotationSpace: ["owner", "world"],
    timerMode: ["none", "age", "remaining", "stopped", "fuse"],
    resourceModel: ["reload"],
    statusMode: ["constant"],
    statusEvent: [PHASE_EVENT_TYPES.SCHEDULE, PHASE_EVENT_TYPES.LIFETIME_END, ...Object.values(STATUS_REACTION_EVENTS)],
    reactionTarget: Object.values(REACTION_TARGETS),
    reactionFrom: ["weapon"],
    statusCapture: ["x", "y", "hp"],
    statusEffectType: Object.values(STATUS_EFFECT_APPLICATIONS),
    statusToken: ["$amount", "$damageMultiplier", "$movementLockMs", HIT_AMOUNT_TOKEN],
    blockAction: [...BLOCK_ACTIONS],
    hitAim: ["seekTarget"],
    displaceWho: Object.values(DISPLACE_WHO),
    displaceFrom: Object.values(DISPLACE_FROM),
    displaceDirection: Object.values(DISPLACE_DIRECTION),
    // An entity event's targets: the kinds, and OWNER (the owner bot alone; see checkEntityEvents).
    eventTarget: [OWNER_TARGET, ...Object.values(TARGET_KINDS)],
    seekMoveTarget: Object.values(SEEK_TARGETS),
    conditionMeasure: Object.values(CONDITION_MEASURES),
    conditionOp: Object.values(CONDITION_OPS),
    conditionSubject: ["target", "owner"],
});

const DASH_CHANNEL = "dash";
/** A phase's `trigger` fields: its own radius, the kinds its proximity sensor notices, and a chain to its neighbours. */
const TRIGGER_FIELDS = ["radius", "contact", "chain"];
/**
 * The verbs an entity event that names OWNER may run: none of them hurts or heals the owner. applyEffects and hit may
 * run too when their own `targets` leave OWNER out (see leavesOwnerOut).
 */
const OWNER_EVENT_VERBS = [VERBS.REMOVE, VERBS.TRANSITION, VERBS.SPAWN, VERBS.EMIT_VISUAL];

/** An applyEffects or hit verb that names targets of its own without OWNER: it cannot reach the owner in an OWNER event. */
function leavesOwnerOut(verb) {
    return [VERBS.APPLY_EFFECTS, VERBS.HIT].includes(verb.do)
        && Array.isArray(verb.targets) && verb.targets.length > 0 && !verb.targets.includes(OWNER_TARGET);
}
const MAX_MS = 600_000;
const MAX_LENGTH = 5000;

function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

export function validateGameplayData({ abilities, statuses, movement, channels }) {
    const errors = [];
    const fail = (path, message) => errors.push(`${path}: ${message}`);
    const oneOf = (path, list, value, { nullable = false } = {}) => {
        if (value == null && nullable) return;
        if (!VOCABULARY[list].includes(value)) fail(path, `unknown ${list} ${JSON.stringify(value)}`);
    };
    const ms = (path, value, { allowSubTick = false } = {}) => {
        if (value === null || value === undefined) return;
        if (!Number.isInteger(value) || value < 0 || value > MAX_MS) fail(path, `${value} is not a whole number of ms in 0..${MAX_MS}`);
        else if (value % 100 !== 0 && !allowSubTick) fail(path, `${value} is not a multiple of 100 ms`);
    };
    const bounded = (path, value, max, { min = 0, integer = false } = {}) => {
        if (value === null || value === undefined) return;
        if (!isNumber(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
            fail(path, `${JSON.stringify(value)} is outside ${min}..${max}`);
        }
    };

    // --- statuses
    const presets = statuses?.statuses ?? {};

    // An effect's `when`: checks that must all pass. Each measure takes exactly the fields it reads: hpRatio and
    // distance take an op and a number; hasStatus takes a preset name; hpRatio, hasStatus and windingUp read `of`
    // (target or owner); the others take no op, value or of (damageConfirmed and fromBehind read the target).
    const checkConditions = (checks, here) => {
        const present = (value) => value !== undefined && value !== null;
        if (!Array.isArray(checks) || checks.length === 0) {
            fail(here, "when needs a list of checks");
            return;
        }
        checks.forEach((check, index) => {
            const path = `${here}[${index}]`;
            if (check === null || typeof check !== "object") {
                fail(path, "a check is an object");
                return;
            }
            const measure = check.measure;
            oneOf(`${path}.measure`, "conditionMeasure", measure);
            if (measure === CONDITION_MEASURES.HP_RATIO || measure === CONDITION_MEASURES.HAS_STATUS
                || measure === CONDITION_MEASURES.WINDING_UP) {
                oneOf(`${path}.of`, "conditionSubject", check.of);
            } else if (present(check.of)) {
                fail(`${path}.of`, `${measure} does not read of`);
            }
            if (measure === CONDITION_MEASURES.HP_RATIO || measure === CONDITION_MEASURES.DISTANCE) {
                oneOf(`${path}.op`, "conditionOp", check.op);
                if (!isNumber(check.value)) fail(`${path}.value`, `${measure} needs a number`);
            } else if (measure === CONDITION_MEASURES.HAS_STATUS) {
                if (present(check.op)) fail(`${path}.op`, "hasStatus takes no op");
                if (!presets[check.value]) fail(`${path}.value`, `hasStatus ${JSON.stringify(check.value)} has no preset in statuses.json`);
            } else {
                if (present(check.op)) fail(`${path}.op`, `${measure} takes no op`);
                if (present(check.value)) fail(`${path}.value`, `${measure} takes no value; it must be true`);
            }
        });
    };

    for (const [name, preset] of Object.entries(presets)) {
        const path = `statuses.${name}`;
        if (preset.interrupts !== undefined && typeof preset.interrupts !== "boolean") fail(`${path}.interrupts`, "must be true or false");
        for (const field of preset.captures ?? []) oneOf(`${path}.captures`, "statusCapture", field);
        for (const [eventName, event] of Object.entries(preset.on ?? {})) {
            const eventPath = `${path}.on.${eventName}`;
            oneOf(`${path}.on`, "statusEvent", eventName);
            if (eventName === PHASE_EVENT_TYPES.SCHEDULE) {
                if (!isNumber(event.intervalMs)) fail(`${eventPath}.intervalMs`, "a schedule needs intervalMs");
                ms(`${eventPath}.intervalMs`, event.intervalMs);
            }
            // A reaction (hit, hitDealt) runs when an attack lands; it may name its target, spend charges and limit the
            // attacks that count. Those fields mean nothing on a schedule or lifetimeEnd event, so they are rejected there.
            const reaction = eventName === STATUS_REACTION_EVENTS.HIT || eventName === STATUS_REACTION_EVENTS.HIT_DEALT;
            if (reaction) {
                if (event.intervalMs !== undefined) fail(eventPath, "a reaction takes no intervalMs");
                if (!Array.isArray(event.effects)) fail(`${eventPath}.effects`, "a reaction needs a list of effects");
                if (event.target !== undefined) oneOf(`${eventPath}.target`, "reactionTarget", event.target);
                if (event.consume !== undefined && !(Number.isInteger(event.consume) && event.consume >= 1)) {
                    fail(`${eventPath}.consume`, "consume is a whole number of charges, 1 or more");
                }
                if (event.from !== undefined) {
                    if (!Array.isArray(event.from) || event.from.length === 0) fail(`${eventPath}.from`, "from is a non-empty list");
                    else for (const kind of event.from) oneOf(`${eventPath}.from`, "reactionFrom", kind);
                }
            } else {
                for (const field of ["target", "consume", "from"]) {
                    if (event[field] != null) fail(`${eventPath}.${field}`, `${field} belongs to a reaction (hit or hitDealt)`);
                }
            }
            for (const [index, entry] of (event.effects ?? []).entries()) {
                const entryPath = `${eventPath}.effects[${index}]`;
                oneOf(`${entryPath}.type`, "effectType", entry.type);
                for (const key of ["amount", "multiplier", "durationMs"]) {
                    const value = entry[key];
                    if (typeof value === "string" && !VOCABULARY.statusToken.includes(value)) fail(`${entryPath}.${key}`, `unknown token ${value}`);
                    if (value === HIT_AMOUNT_TOKEN && !reaction) fail(`${entryPath}.${key}`, "$hitAmount is set by an attack, so it belongs to a reaction");
                }
                if (entry.type === EFFECT_TYPES.STATUS && !presets[entry.subtype]) fail(entryPath, `status ${entry.subtype} has no preset in statuses.json`);
                if (entry.type === EFFECT_TYPES.REMOVE_STATUS && !presets[entry.subtype]) fail(entryPath, `removeStatus ${entry.subtype} has no preset in statuses.json`);
                if (entry.when !== undefined) checkConditions(entry.when, `${entryPath}.when`);
            }
        }
        if (preset.charges !== undefined) bounded(`${path}.charges`, preset.charges, 1000, { min: 1, integer: true });
        for (const [index, entry] of (preset.effects ?? []).entries()) {
            const entryPath = `${path}.effects[${index}]`;
            oneOf(`${entryPath}.type`, "statusEffectType", entry.type);
            oneOf(`${entryPath}.mode`, "statusMode", entry.mode);
            for (const key of ["amount", "multiplier", "durationMs"]) {
                const value = entry[key];
                if (typeof value === "string" && !VOCABULARY.statusToken.includes(value)) fail(`${entryPath}.${key}`, `unknown token ${value}`);
            }
            if (entry.type === STATUS_EFFECT_APPLICATIONS.BLOCK) {
                if (!Array.isArray(entry.actions) || entry.actions.length === 0) fail(`${entryPath}.actions`, "block needs a list of actions");
                for (const action of entry.actions ?? []) oneOf(`${entryPath}.actions`, "blockAction", action);
            }
            if (entry.type === STATUS_EFFECT_APPLICATIONS.MODIFIER) {
                if (!Object.values(MODIFIER_STATS).includes(entry.stat)) fail(`${entryPath}.stat`, `unknown modifier stat ${JSON.stringify(entry.stat)}`);
                if (!isNumber(entry.multiply) || entry.multiply < 0) fail(`${entryPath}.multiply`, `${JSON.stringify(entry.multiply)} must be a finite number of 0 or more`);
                if (entry.stat !== MODIFIER_STATS.INCOMING_DAMAGE) {
                    if (entry.excludedDamageSourceTypes !== undefined) fail(`${entryPath}.excludedDamageSourceTypes`, "only an incomingDamage modifier may exclude damage source types");
                    if (entry.rounding !== undefined) fail(`${entryPath}.rounding`, "only an incomingDamage modifier may round");
                }
            }
        }
    }

    // --- channels
    const channelIds = new Set(Object.keys(channels?.channels ?? {}));
    if (channelIds.size === 0) fail("channels.channels", "needs at least one channel");
    for (const [name, channel] of Object.entries(channels?.channels ?? {})) {
        if (typeof channel.notReadyWhileBlocked !== "boolean") fail(`channels.${name}.notReadyWhileBlocked`, "must be true or false");
    }

    // --- abilities
    // Retired IDs belong to abilities that were cut: no ability may use one again.
    const retired = new Set(abilities?.retiredIds ?? []);
    for (const id of retired) if (!Number.isInteger(id) || id <= 0) fail("abilities.retiredIds", `${id} is not a positive integer`);
    const ids = new Set();
    const names = new Set();
    const labels = new Set();
    const codes = new Set();
    const has = (value) => value !== null && value !== undefined;
    const flag = (path, value) => {
        if (value !== undefined && typeof value !== "boolean") fail(path, "must be true or false");
    };

    // A displace moves one combatant relative to a point. `mirror` lands past `from` and takes no distance. `who: "owner"`
    // is a self move, so only an activation (`context` "activate") may use it, like the other self effects.
    const checkDisplace = (effect, effectPath, context) => {
        oneOf(`${effectPath}.who`, "displaceWho", effect.who);
        oneOf(`${effectPath}.from`, "displaceFrom", effect.from);
        oneOf(`${effectPath}.direction`, "displaceDirection", effect.direction);
        if (effect.who === DISPLACE_WHO.OWNER && context !== "activate") {
            fail(`${effectPath}.who`, "owner displace is a self move, allowed only in onActivate");
        }
        if (effect.direction === DISPLACE_DIRECTION.MIRROR) {
            if (has(effect.distance)) fail(`${effectPath}.distance`, "mirror takes no distance: it lands as far past from as the mover stood from it");
            if (has(effect.falloff)) fail(`${effectPath}.falloff`, "mirror takes no falloff");
        } else {
            if (!has(effect.distance) && !has(effect.falloff)) fail(effectPath, "displace needs distance or falloff");
            bounded(`${effectPath}.distance`, effect.distance, MAX_LENGTH);
        }
    };

    // Fields that displace replaced: a verb that still carries one fails the way a removed trigger flag does.
    const checkRemovedVerbFields = (verb, here) => {
        for (const removed of ["knockbackDirection", "pullDirection"]) {
            if (has(verb[removed])) fail(`${here}.${removed}`, "removed; a displace effect names its direction with from and direction");
        }
    };

    const checkEffects = (effects, here, context) => {
        for (const [effectIndex, effect] of (effects ?? []).entries()) {
            const effectPath = `${here}[${effectIndex}]`;
            oneOf(`${effectPath}.type`, "effectType", effect.type);
            if (has(effect.distanceMode)) fail(`${effectPath}.distanceMode`, "removed; a displace with direction mirror replaces teleport");
            if (has(effect.when)) checkConditions(effect.when, `${effectPath}.when`);
            for (const kind of effect.targetKinds ?? []) oneOf(`${effectPath}.targetKinds`, "targetKind", kind);
            ms(`${effectPath}.durationMs`, effect.durationMs);
            ms(`${effectPath}.intervalMs`, effect.intervalMs);
            ms(`${effectPath}.movementLockMs`, effect.movementLockMs);
            const hasField = (key) => has(effect[key]);
            switch (effect.type) {
                case "damage": if (!hasField("amount") && !hasField("falloff")) fail(effectPath, "damage needs amount or falloff"); break;
                case "healing": if (!hasField("amount") && !effect.mirrorsDamage) fail(effectPath, "healing needs amount or mirrorsDamage"); break;
                case "displace": checkDisplace(effect, effectPath, context); break;
                case "remove_status":
                    if (!hasField("subtype")) fail(effectPath, "removeStatus needs subtype");
                    else if (!presets[effect.subtype]) fail(effectPath, `removeStatus ${effect.subtype} has no preset in statuses.json`);
                    break;
                case "status":
                    if (!hasField("subtype")) fail(effectPath, "status needs subtype");
                    if (hasField("subtype") && !presets[effect.subtype]) fail(effectPath, `status ${effect.subtype} has no preset in statuses.json`);
                    if (!hasField("durationMs") && !effect.whileInside) fail(effectPath, "status needs durationMs or whileInside");
                    break;
                default: break;
            }
        }
    };

    const checkHitbox = (hitbox, here) => {
        if (!hitbox) { fail(here, "needs a hitbox"); return; }
        for (const key of ["radius", "range", "width", "length"]) bounded(`${here}.${key}`, hitbox[key], MAX_LENGTH, { min: 1 });
        bounded(`${here}.arc`, hitbox.arc, 360, { min: 1 });
    };

    const checkVisual = (visual, here) => {
        if (!visual) return;
        ms(`${here}.visibleMs`, visual.visibleMs);
        bounded(`${here}.visualSize`, visual.visualSize, 2000, { min: 1 });
    };

    // Nothing is delayed: every activation verb runs on its tick, and anything that lasts is an attached entity.
    // `pose` is removed for the same reason (a verb always fires from the bot's pose at that moment).
    const checkRemovedTiming = (verb, here) => {
        if (verb.pose !== undefined) fail(`${here}.pose`, "unknown field pose (a verb fires from the bot's current pose)");
        if (has(verb.atMs)) fail(`${here}.atMs`, "removed; anything over time is an attached entity (its phases keep time)");
        if (has(verb.oncePerTarget)) fail(`${here}.oncePerTarget`, "removed; use targetPolicy { mode: \"once\", scope: \"activation\" }");
        if (has(verb.when)) fail(`${here}.when`, "only an effect carries when; put the checks on the effect");
    };

    // A targetPolicy: how often a target can be affected, and how long the memory of that lasts. `hit` names the
    // verb it sits on ("activate" for an onActivate hit, "event" for an entity hit; null for an entity event).
    const checkTargetPolicy = (policy, here, hit = null) => {
        if (!has(policy)) return;
        oneOf(`${here}.mode`, "targetPolicyMode", policy.mode);
        if (has(policy.scope)) oneOf(`${here}.scope`, "targetPolicyScope", policy.scope);
        if (policy.mode === "interval") {
            if (!has(policy.intervalMs)) fail(`${here}.intervalMs`, "an interval policy needs intervalMs");
            else ms(`${here}.intervalMs`, policy.intervalMs);
        } else if (has(policy.intervalMs)) {
            fail(`${here}.intervalMs`, "only an interval policy has intervalMs");
        }
        if (hit === "activate" && (policy.mode !== "once" || policy.scope !== "activation")) {
            fail(here, "an onActivate hit takes only { mode: \"once\", scope: \"activation\" }");
        }
        if (hit === "event" && policy.mode === "interval") fail(here, "a hit verb takes once or everyTick, not interval");
    };

    // One verb of an onActivate list ("activate") or of an entity event ("event").
    const checkVerb = (verb, here, { context, phaseIds, entityNames, attached = false }) => {
        oneOf(`${here}.do`, context === "activate" ? "activationVerb" : attached ? "attachedEventVerb" : "eventVerb", verb.do);
        for (const target of verb.targets ?? []) oneOf(`${here}.targets`, "verbTarget", target);
        checkVisual(verb.visual, `${here}.visual`);
        checkRemovedTiming(verb, here);
        if (verb.do !== "hit" && has(verb.targetPolicy)) fail(`${here}.targetPolicy`, "only a hit verb or an entity event has a targetPolicy");
        switch (verb.do) {
            case "hit":
                checkHitbox(verb.hitbox, `${here}.hitbox`);
                if (!Array.isArray(verb.targets) || verb.targets.length === 0) fail(`${here}.targets`, "hit needs targets");
                if (!Array.isArray(verb.effects) || verb.effects.length === 0) fail(`${here}.effects`, "hit needs at least one effect");
                checkEffects(verb.effects, `${here}.effects`, context);
                flag(`${here}.nearestOnly`, verb.nearestOnly);
                checkTargetPolicy(verb.targetPolicy, `${here}.targetPolicy`, context === "activate" ? "activate" : "event");
                if (has(verb.aim)) oneOf(`${here}.aim`, "hitAim", verb.aim);
                if (verb.origin) oneOf(`${here}.origin.rotationSpace`, "rotationSpace", verb.origin.rotationSpace);
                checkRemovedVerbFields(verb, here);
                break;
            case "applyEffects":
                if (!Array.isArray(verb.effects) || verb.effects.length === 0) fail(`${here}.effects`, "applyEffects needs at least one effect");
                checkEffects(verb.effects, `${here}.effects`, context);
                if (context === "activate" && !(verb.targets ?? []).includes("OWNER")) {
                    fail(`${here}.targets`, "an applyEffects in onActivate must target OWNER");
                }
                checkRemovedVerbFields(verb, here);
                break;
            case "spawn":
                if (!entityNames.has(verb.entity)) fail(`${here}.entity`, `${verb.entity} is not an entity of this ability`);
                if (has(verb.pattern)) {
                    oneOf(`${here}.pattern.type`, "patternType", verb.pattern.type);
                    bounded(`${here}.pattern.count`, verb.pattern.count, 12, { min: 1, integer: true });
                    if (!has(verb.pattern.count)) fail(`${here}.pattern.count`, "missing");
                    if (verb.pattern.type === "fan") {
                        bounded(`${here}.pattern.spreadDeg`, verb.pattern.spreadDeg, 360, { min: 0 });
                        if (!has(verb.pattern.spreadDeg)) fail(`${here}.pattern.spreadDeg`, "fan needs spreadDeg");
                    }
                    if (verb.pattern.type === "line") {
                        bounded(`${here}.pattern.spacing`, verb.pattern.spacing, 500, { min: 1 });
                        if (!has(verb.pattern.spacing)) fail(`${here}.pattern.spacing`, "line needs spacing");
                    }
                }
                break;
            case "move":
                bounded(`${here}.distance`, verb.distance, MAX_LENGTH, { min: 1 });
                bounded(`${here}.unitsPerTick`, verb.unitsPerTick, 500, { min: 1 });
                if (!has(verb.distance) || !has(verb.unitsPerTick)) fail(here, "move needs distance and unitsPerTick");
                break;
            case "transition":
                if (!phaseIds.has(verb.to)) fail(`${here}.to`, `${verb.to} is not a phase of this entity`);
                break;
            case "emitVisual":
                if (!has(verb.visualType)) fail(`${here}.visualType`, "missing");
                ms(`${here}.visibleMs`, verb.visibleMs);
                if (!Number.isInteger(verb.visibleMs) || verb.visibleMs <= 0) fail(`${here}.visibleMs`, "emitVisual needs a positive visibleMs");
                bounded(`${here}.visualSize`, verb.visualSize, 2000, { min: 1 });
                break;
            default: break;
        }
    };

    const checkEntity = (entity, here, entityNames) => {
        oneOf(`${here}.category`, "category", entity.category);
        oneOf(`${here}.spawn.rotationSpace`, "rotationSpace", entity.spawn?.rotationSpace);
        oneOf(`${here}.lifetime.timerMode`, "timerMode", entity.lifetime?.timerMode);
        ms(`${here}.lifetime.duration`, entity.lifetime?.duration);
        ms(`${here}.lifetime.add`, entity.lifetime?.add);
        if (entity.bindToCast !== undefined) fail(`${here}.bindToCast`, "removed; an entity no longer binds to its cast");
        if (!entity.runtimeType) fail(`${here}.runtimeType`, "missing");
        if (!Array.isArray(entity.phases) || entity.phases.length === 0) { fail(`${here}.phases`, "needs at least one phase"); return; }
        const phaseIds = new Set(entity.phases.map((phase) => phase.id));
        if (phaseIds.size !== entity.phases.length) fail(`${here}.phases`, "duplicate phase ids");
        // A trap has two sensors. `trigger.contact` lists the enemy bodies its proximity sensor notices; being hit is
        // the body's job (`health`), so the flags that duplicated it are rejected.
        const checkContact = (trigger, here) => {
            for (const removed of ["botContact", "attackHits", "projectileOverlap"]) {
                if (has(trigger[removed])) fail(`${here}.${removed}`, "removed; trigger.contact covers proximity, and health covers being hit");
            }
            if (!Array.isArray(trigger.contact) || trigger.contact.length === 0) fail(`${here}.contact`, "needs a non-empty list of BOT and/or SUMMON");
            else for (const kind of trigger.contact) oneOf(`${here}.contact`, "triggerContact", kind);
        };
        // trigger.radius is the only radius a trigger uses (detection, chains, trigger targets). A phase with a
        // trigger must set it, and must not also set hitbox.radius unless the hitbox serves another event.
        const checkTriggerRadius = (phase, phasePath) => {
            const hasTrigger = phase.trigger != null || phase.on?.trigger != null;
            if (!hasTrigger) return;
            if (phase.trigger == null) fail(`${phasePath}.trigger`, "a trigger event needs a trigger");
            else {
                checkContact(phase.trigger, `${phasePath}.trigger`);
                if (!(Number(phase.trigger.radius) >= 1)) fail(`${phasePath}.trigger.radius`, "a trigger needs its own radius; the hitbox radius is not used");
            }
            const hitboxServesAnotherEvent = ["collision", "hit", "killed"].some((type) => phase.on?.[type] != null)
                || phase.health != null;
            if (phase.trigger?.radius != null && phase.hitbox?.radius != null && !hitboxServesAnotherEvent) {
                fail(`${phasePath}.hitbox.radius`, "set alongside trigger.radius but no collision, hit or killed event uses the hitbox; drop it");
            }
        };
        for (const [phaseIndex, phase] of entity.phases.entries()) {
            const phasePath = `${here}.phases[${phaseIndex}]`;
            // An attached entity is part of its owner's attack: nothing can target it, so it has no body and no trigger.
            if (entity.category === ENTITY_CATEGORIES.ATTACHED) {
                if (has(phase.health)) fail(`${phasePath}.health`, "an attached entity has no health: nothing can target it");
                if (has(phase.trigger)) fail(`${phasePath}.trigger`, "an attached entity has no trigger: its events keep time");
            }
            oneOf(`${phasePath}.type`, "phaseType", phase.type);
            ms(`${phasePath}.durationMs`, phase.durationMs);
            // A trigger's fields are the ones the runtime reads; any other field is rejected, so a value nothing reads cannot
            // sit in the data as if it did something.
            for (const field of Object.keys(phase.trigger ?? {})) {
                if (!TRIGGER_FIELDS.includes(field)) fail(`${phasePath}.trigger.${field}`, "unknown trigger field");
            }
            checkVisual(phase.visual, `${phasePath}.visual`);
            bounded(`${phasePath}.health.hp`, phase.health?.hp, 10_000, { min: 1 });
            bounded(`${phasePath}.health.maxHp`, phase.health?.maxHp, 10_000, { min: 1 });
            for (const key of ["radius", "range", "width", "length"]) {
                bounded(`${phasePath}.hitbox.${key}`, phase.hitbox?.[key], MAX_LENGTH, { min: 1 });
            }
            bounded(`${phasePath}.hitbox.arc`, phase.hitbox?.arc, 360, { min: 1 });
            checkTriggerRadius(phase, phasePath);
            const phaseMovement = phase.movement;
            if (phaseMovement) {
                oneOf(`${phasePath}.movement.mode`, "movementMode", phaseMovement.mode);
                bounded(`${phasePath}.movement.unitsPerTick`, phaseMovement.unitsPerTick, 500);
                if (has(phaseMovement.direction)) oneOf(`${phasePath}.movement.direction`, "movementDirection", phaseMovement.direction);
                if (["straight", "seek"].includes(phaseMovement.mode) && !(phaseMovement.unitsPerTick > 0)) {
                    fail(`${phasePath}.movement.unitsPerTick`, `${phaseMovement.mode} movement needs unitsPerTick above 0`);
                }
                if (phaseMovement.mode === "seek" && !has(phaseMovement.turnDegrees)) {
                    fail(`${phasePath}.movement.turnDegrees`, "seek needs turnDegrees");
                }
                if (has(phaseMovement.target)) {
                    if (phaseMovement.mode !== "seek") fail(`${phasePath}.movement.target`, "only seek movement has a target");
                    oneOf(`${phasePath}.movement.target`, "seekMoveTarget", phaseMovement.target);
                }
            }
            for (const [eventType, event] of Object.entries(phase.on ?? {})) {
                const eventPath = `${phasePath}.on.${eventType}`;
                oneOf(eventPath, "eventType", eventType);
                for (const kind of event.targets ?? []) oneOf(`${eventPath}.targets`, "eventTarget", kind);
                // OWNER matches only the owner bot, and only a collision event may name it. Such an event runs no hit or
                // applyEffects, so it cannot hurt the owner.
                const namesOwner = (event.targets ?? []).includes(OWNER_TARGET);
                if (namesOwner && eventType !== PHASE_EVENT_TYPES.COLLISION) {
                    fail(`${eventPath}.targets`, "only a collision event may name OWNER");
                }
                if (namesOwner && entity.category === ENTITY_CATEGORIES.ATTACHED) {
                    fail(`${eventPath}.targets`, "an attached entity moves with its owner, so it cannot name OWNER");
                }
                oneOf(`${eventPath}.schedule.mode`, "scheduleMode", event.schedule?.mode);
                ms(`${eventPath}.schedule.intervalMs`, event.schedule?.intervalMs);
                // Unlimited is a missing count; 0 would mean unlimited in the browser and never in the server.
                bounded(`${eventPath}.schedule.count`, event.schedule?.count, 1000, { min: 1 });
                checkTargetPolicy(event.targetPolicy, `${eventPath}.targetPolicy`);
                flag(`${eventPath}.nearestOnly`, event.nearestOnly);
                flag(`${eventPath}.waitForHit`, event.waitForHit);
                if (eventType === "schedule") {
                    if (event.schedule?.mode !== "repeat") fail(`${eventPath}.schedule.mode`, "a schedule event repeats");
                    if (!(event.schedule?.intervalMs > 0)) fail(`${eventPath}.schedule.intervalMs`, "a schedule event needs intervalMs");
                } else if (event.waitForHit) {
                    fail(`${eventPath}.waitForHit`, "only a schedule event waits for its hit");
                }
                if (!Array.isArray(event.do)) { fail(`${eventPath}.do`, "must be a list of verbs"); continue; }
                for (const [verbIndex, verb] of event.do.entries()) {
                    checkVerb(verb, `${eventPath}.do[${verbIndex}]`, {
                        context: "event", phaseIds, entityNames, attached: entity.category === ENTITY_CATEGORIES.ATTACHED,
                    });
                    if (namesOwner && !OWNER_EVENT_VERBS.includes(verb.do) && !leavesOwnerOut(verb)) {
                        fail(`${eventPath}.do[${verbIndex}]`, `${verb.do} cannot run in an event that names OWNER unless its own targets leave OWNER out (remove, transition, spawn or emitVisual, or applyEffects and hit with targets)`);
                    }
                }
            }
        }
    };

    for (const [index, ability] of (abilities?.abilities ?? []).entries()) {
        const path = `abilities[${index}]`;
        if (!Number.isInteger(ability.id) || ability.id <= 0) fail(`${path}.id`, `${ability.id} is not a positive integer`);
        else if (ids.has(ability.id)) fail(`${path}.id`, `duplicate id ${ability.id}`);
        else if (retired.has(ability.id)) fail(`${path}.id`, `${ability.id} is a retired id and cannot be used again`);
        ids.add(ability.id);
        if (!ability.name || names.has(ability.name)) fail(`${path}.name`, `missing or duplicate name ${ability.name}`);
        names.add(ability.name);
        if (!ability.label || labels.has(ability.label)) fail(`${path}.label`, `missing or duplicate label ${ability.label}`);
        if (has(ability.code) && (!/^[A-Za-z]$/.test(ability.code) || codes.has(ability.code))) fail(`${path}.code`, `${ability.code} is not a unique one-letter loadout code`);
        codes.add(ability.code);
        if (has(ability.standard) && ability.standard !== true) fail(`${path}.standard`, "is true or left out");
        if (has(ability.tier) && ![1, 2, 3].includes(ability.tier)) fail(`${path}.tier`, `${ability.tier} is not 1, 2 or 3`);
        if (has(ability.weapon) && ability.weapon !== true) fail(`${path}.weapon`, "is true or left out");
        if (has(ability.tier) && has(ability.weapon)) fail(`${path}`, "is a weapon or a tier ability, not both");
        if (has(ability.standard) && (has(ability.tier) || has(ability.weapon))) fail(`${path}`, "a standard ability has no tier or weapon");
        labels.add(ability.label);

        if (!channelIds.has(ability.channel)) fail(`${path}.channel`, `unknown channel ${JSON.stringify(ability.channel)}`);
        if (has(ability.cost)) {
            if (ability.channel !== DASH_CHANNEL) fail(`${path}.cost`, "only the dash channel may declare a stamina cost");
            bounded(`${path}.cost.stamina`, ability.cost.stamina, movement?.config?.staminaMax ?? 100, { min: 1, integer: true });
            if (ability.cost.stamina == null) fail(`${path}.cost`, "needs stamina");
        }

        const timing = ability.timing ?? {};
        ms(`${path}.timing.cooldownMs`, timing.cooldownMs);
        ms(`${path}.timing.windupMs`, timing.windupMs);
        // Read by the runtime (the action lock after an activation): no fallback, so every ability states it (0 for none).
        if (!has(timing.activeMs)) fail(`${path}.timing.activeMs`, "every ability states its active time (0 for none)");
        ms(`${path}.timing.activeMs`, timing.activeMs);
        ms(`${path}.timing.durationMs`, timing.durationMs);
        ms(`${path}.timing.reloadMs`, timing.reloadMs);
        bounded(`${path}.timing.maxCharges`, timing.maxCharges, 100, { min: 1, integer: true });
        oneOf(`${path}.timing.resourceModel`, "resourceModel", timing.resourceModel, { nullable: true });
        if ((timing.maxCharges == null) !== (timing.reloadMs == null)) fail(`${path}.timing`, "maxCharges and reloadMs go together");

        if (!ability.activation) fail(`${path}.activation`, "missing");
        if (has(ability.activation?.teleportOncePerActivation)) {
            fail(`${path}.activation.teleportOncePerActivation`, "removed; a second hit with targetPolicy { mode: \"once\", scope: \"activation\" } replaces it");
        }
        const entities = ability.entities ?? {};
        const entityNames = new Set(Object.keys(entities));
        if (!Array.isArray(ability.onActivate) || ability.onActivate.length === 0) {
            fail(`${path}.onActivate`, "needs at least one verb");
        }
        for (const [verbIndex, verb] of (ability.onActivate ?? []).entries()) {
            checkVerb(verb, `${path}.onActivate[${verbIndex}]`, { context: "activate", phaseIds: new Set(), entityNames });
        }
        for (const [entityName, entity] of Object.entries(entities)) {
            checkEntity(entity, `${path}.entities.${entityName}`, entityNames);
        }
    }

    // --- movement
    const config = movement?.config ?? {};
    ms("movement.tickMs", movement?.tickMs, { allowSubTick: true });
    if (movement?.tickMs !== 100) fail("movement.tickMs", "the simulation ticks every 100 ms");
    for (const [key, value] of Object.entries(config)) {
        if (!isNumber(value) || value < 0 || value > 1000) fail(`movement.config.${key}`, `${value} is outside 0..1000`);
        else if (/Ms$/.test(key)) ms(`movement.config.${key}`, value);
        else if (!/Multiplier$/.test(key) && !Number.isInteger(value)) fail(`movement.config.${key}`, `${value} must be a whole number`);
    }

    // --- whole ticks everywhere: a time field the checks above don't name (a new one, or a smuggled one) still lands
    // on the 100 ms tick. Duplicates of the named checks are harmless.
    const wholeTicks = (value, path) => {
        if (Array.isArray(value)) value.forEach((item, index) => wholeTicks(item, `${path}[${index}]`));
        else if (value && typeof value === "object") {
            for (const [key, child] of Object.entries(value)) {
                if (/Ms$/.test(key) && typeof child === "number") ms(`${path}.${key}`, child);
                else wholeTicks(child, `${path}.${key}`);
            }
        }
    };
    wholeTicks(abilities?.abilities, "abilities");
    wholeTicks(statuses?.statuses, "statuses");

    if (errors.length > 0) {
        throw new Error(`Invalid gameplay data (${errors.length}):\n${errors.slice(0, 30).join("\n")}`);
    }
}
