/**
 * Semantic checks for shared/gameplay/*.json. The server runs the same list in GameplayData.java; keep
 * the two in step. Every check only reports: neither runtime fills a missing value in.
 *
 *  1. ability ids are unique positive integers; names and labels are unique
 *  2. every closed vocabulary value is a known one
 *  3. every transition.to names a phase of that entity; every spawn names an entity of its ability
 *  4. onTrigger verbs are hit, spawn, move, face or applyEffects (applyEffects there targets OWNER); entity event
 *     verbs are hit, spawn, applyEffects, transition, remove or emitVisual
 *  5. every *Ms is a whole number of 100 ms ticks within bounds (interrupt durations and the 1 ms Grenade
 *     activeMs predate the tick rule and are the only exceptions)
 *  6. counts and sizes are within bounds; a spawn pattern has a count of 1..12 and the fields its type needs;
 *     a spawn verb names one entity, so several entities of one verb always come from a pattern
 *  7. an effect carries the fields its type needs; a hit or applyEffects verb applies at least one effect
 *  8. every status an effect applies has a preset in statuses.json, and its tokens are known
 *  9. movement.json numbers are whole and in bounds
 * 10. every ability names a channel of channels.json; a channel's blocking statuses have presets (and the ones
 *     that make an ability not ready are among them); only the
 *     dash channel may declare a stamina cost, a whole number in 1..staminaMax
 * 11. an entity phase moves in a known mode (straight, static, seek or followOwner) with the numbers it needs;
 *     a timer (`schedule`) event repeats at a whole tick interval
 */
export const VOCABULARY = Object.freeze({
    category: ["projectile", "zone", "trap", "summon"],
    phaseType: ["projectile", "zone", "summon"],
    eventType: ["collision", "trigger", "hit", "killed", "lifetimeEnd", "schedule"],
    verb: ["hit", "spawn", "move", "face", "applyEffects", "transition", "remove", "emitVisual"],
    triggerVerb: ["hit", "spawn", "move", "face", "applyEffects"],
    eventVerb: ["hit", "spawn", "applyEffects", "transition", "remove", "emitVisual"],
    movementMode: ["straight", "static", "seek", "followOwner"],
    movementDirection: ["forward", "backward"],
    patternType: ["fan", "ring", "line"],
    effectType: ["damage", "healing", "knockback", "pull", "status", "buff", "interrupt", "teleport",
        "restore_state", "damage_reduction", "damage_immunity", "damage_reflection"],
    targetKind: ["BOT", "HP_ENTITY", "SUMMON", "ENTITY"],
    verbTarget: ["OWNER", "BOT", "HP_ENTITY", "SUMMON", "ENTITY"],
    scheduleMode: ["once", "repeat", "continuous"],
    targetPolicyMode: ["once", "everyTick", "interval"],
    rotationSpace: ["owner", "world"],
    timerMode: ["none", "age", "remaining", "stopped", "fuse"],
    resourceModel: ["reload"],
    statusMode: ["constant", "tick"],
    statusEffectType: ["damage", "silence", "stun", "movement_modifier", "movement_lock", "incoming_damage_modifier"],
    statusToken: ["$amount", "$damageMultiplier", "$movementLockMs"],
    faceTarget: ["activationTarget"],
    hitAim: ["seekTarget"],
    pushDirection: ["source", "owner", "velocity"],
});

const DASH_CHANNEL = "dash";
const MAX_MS = 600_000;
const MAX_LENGTH = 5000;

function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

export function validateGameplayData({ abilities, statuses, movement, channels }) {
    const errors = [];
    const fail = (path, message) => errors.push(`${path}: ${message}`);
    const oneOf = (path, list, value, { nullable = false } = {}) => {
        if (value === null && nullable) return;
        if (!VOCABULARY[list].includes(value)) fail(path, `unknown ${list} ${JSON.stringify(value)}`);
    };
    const ms = (path, value, { allowOneMs = false, allowSubTick = false } = {}) => {
        if (value === null || value === undefined) return;
        if (!Number.isInteger(value) || value < 0 || value > MAX_MS) fail(path, `${value} is not a whole number of ms in 0..${MAX_MS}`);
        else if (value % 100 !== 0 && !(allowOneMs && value === 1) && !allowSubTick) fail(path, `${value} is not a multiple of 100 ms`);
    };
    const bounded = (path, value, max, { min = 0, integer = false } = {}) => {
        if (value === null || value === undefined) return;
        if (!isNumber(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
            fail(path, `${JSON.stringify(value)} is outside ${min}..${max}`);
        }
    };

    // --- statuses
    const presets = statuses?.statuses ?? {};
    for (const [name, preset] of Object.entries(presets)) {
        const path = `statuses.${name}`;
        ms(`${path}.tickIntervalDefaultMs`, preset.tickIntervalDefaultMs);
        for (const [index, entry] of (preset.effects ?? []).entries()) {
            const entryPath = `${path}.effects[${index}]`;
            oneOf(`${entryPath}.type`, "statusEffectType", entry.type);
            oneOf(`${entryPath}.mode`, "statusMode", entry.mode);
            for (const key of ["amount", "multiplier", "durationMs"]) {
                const value = entry[key];
                if (typeof value === "string" && !VOCABULARY.statusToken.includes(value)) fail(`${entryPath}.${key}`, `unknown token ${value}`);
            }
        }
    }

    // --- channels
    const channelIds = new Set(Object.keys(channels?.channels ?? {}));
    if (channelIds.size === 0) fail("channels.channels", "needs at least one channel");
    for (const [name, channel] of Object.entries(channels?.channels ?? {})) {
        if (!Array.isArray(channel.blockedByStatuses)) fail(`channels.${name}.blockedByStatuses`, "must be a list");
        for (const status of channel.blockedByStatuses ?? []) {
            if (!presets[status]) fail(`channels.${name}.blockedByStatuses`, `${status} has no preset in statuses.json`);
        }
        if (!Array.isArray(channel.notReadyWhileStatuses)) fail(`channels.${name}.notReadyWhileStatuses`, "must be a list");
        for (const status of channel.notReadyWhileStatuses ?? []) {
            if (!(channel.blockedByStatuses ?? []).includes(status)) {
                fail(`channels.${name}.notReadyWhileStatuses`, `${status} is not one of the channel's blockedByStatuses`);
            }
        }
    }

    // --- abilities
    const ids = new Set();
    const names = new Set();
    const labels = new Set();
    const legacy = abilities?.legacyNames ?? {};
    const has = (value) => value !== null && value !== undefined;

    const checkEffects = (effects, here) => {
        for (const [effectIndex, effect] of (effects ?? []).entries()) {
            const effectPath = `${here}[${effectIndex}]`;
            oneOf(`${effectPath}.type`, "effectType", effect.type);
            for (const kind of effect.targetKinds ?? []) oneOf(`${effectPath}.targetKinds`, "targetKind", kind);
            ms(`${effectPath}.durationMs`, effect.durationMs, { allowSubTick: effect.type === "interrupt" });
            ms(`${effectPath}.delayMs`, effect.delayMs);
            ms(`${effectPath}.intervalMs`, effect.intervalMs);
            ms(`${effectPath}.movementLockMs`, effect.movementLockMs);
            const hasField = (key) => has(effect[key]);
            const need = (...keys) => keys.forEach((key) => { if (!hasField(key)) fail(effectPath, `${effect.type} needs ${key}`); });
            switch (effect.type) {
                case "damage": if (!hasField("amount") && !hasField("falloff")) fail(effectPath, "damage needs amount or falloff"); break;
                case "healing": if (!hasField("amount") && !effect.mirrorsDamage) fail(effectPath, "healing needs amount or mirrorsDamage"); break;
                case "knockback": case "pull": need("amount"); break;
                case "status":
                    need("subtype");
                    if (hasField("subtype") && !presets[effect.subtype]) fail(effectPath, `status ${effect.subtype} has no preset in statuses.json`);
                    if (!hasField("durationMs") && !effect.whileInside) fail(effectPath, "status needs durationMs or whileInside");
                    break;
                case "buff": need("buff", "amount", "durationMs"); break;
                case "interrupt": need("durationMs"); break;
                case "teleport": if (!hasField("distanceMode") && !hasField("amount")) fail(effectPath, "teleport needs distanceMode or amount"); break;
                case "restore_state": need("delayMs"); break;
                case "damage_reduction": case "damage_reflection": case "damage_immunity": need("amount", "durationMs"); break;
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

    // One verb of an onTrigger list ("trigger") or of an entity event ("event").
    const checkVerb = (verb, here, { context, phaseIds, entityNames }) => {
        oneOf(`${here}.do`, context === "trigger" ? "triggerVerb" : "eventVerb", verb.do);
        for (const target of verb.targets ?? []) oneOf(`${here}.targets`, "verbTarget", target);
        checkVisual(verb.visual, `${here}.visual`);
        switch (verb.do) {
            case "hit":
                checkHitbox(verb.hitbox, `${here}.hitbox`);
                if (!Array.isArray(verb.targets) || verb.targets.length === 0) fail(`${here}.targets`, "hit needs targets");
                if (!Array.isArray(verb.effects) || verb.effects.length === 0) fail(`${here}.effects`, "hit needs at least one effect");
                checkEffects(verb.effects, `${here}.effects`);
                if (typeof verb.nearestOnly !== "boolean") fail(`${here}.nearestOnly`, "missing");
                if (typeof verb.oncePerTarget !== "boolean") fail(`${here}.oncePerTarget`, "missing");
                if (has(verb.aim)) oneOf(`${here}.aim`, "hitAim", verb.aim);
                else if (verb.aim === undefined) fail(`${here}.aim`, "missing (write null for no aim)");
                if (verb.origin) oneOf(`${here}.origin.rotationSpace`, "rotationSpace", verb.origin.rotationSpace);
                if (has(verb.knockbackDirection)) oneOf(`${here}.knockbackDirection`, "pushDirection", verb.knockbackDirection);
                if (has(verb.pullDirection)) oneOf(`${here}.pullDirection`, "pushDirection", verb.pullDirection);
                break;
            case "applyEffects":
                if (!Array.isArray(verb.effects) || verb.effects.length === 0) fail(`${here}.effects`, "applyEffects needs at least one effect");
                checkEffects(verb.effects, `${here}.effects`);
                if (context === "trigger" && !(verb.targets ?? []).includes("OWNER")) {
                    fail(`${here}.targets`, "an applyEffects in onTrigger must target OWNER");
                }
                if (has(verb.knockbackDirection)) oneOf(`${here}.knockbackDirection`, "pushDirection", verb.knockbackDirection);
                if (has(verb.pullDirection)) oneOf(`${here}.pullDirection`, "pushDirection", verb.pullDirection);
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
                ms(`${here}.trailMs`, verb.trailMs);
                if (!has(verb.distance) || !has(verb.unitsPerTick)) fail(here, "move needs distance and unitsPerTick");
                break;
            case "face":
                oneOf(`${here}.target`, "faceTarget", verb.target);
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
        if (typeof entity.bindToCast !== "boolean") fail(`${here}.bindToCast`, "missing");
        if (!entity.runtimeType) fail(`${here}.runtimeType`, "missing");
        if (!Array.isArray(entity.phases) || entity.phases.length === 0) { fail(`${here}.phases`, "needs at least one phase"); return; }
        const phaseIds = new Set(entity.phases.map((phase) => phase.id));
        if (phaseIds.size !== entity.phases.length) fail(`${here}.phases`, "duplicate phase ids");
        // trigger.radius is the only radius a trigger uses (detection, chains, trigger targets). A phase with a
        // trigger must set it, and must not also set hitbox.radius unless the hitbox serves another event.
        const checkTriggerRadius = (phase, phasePath) => {
            const hasTrigger = phase.trigger != null || phase.on?.trigger != null;
            if (!hasTrigger) return;
            if (phase.trigger == null) fail(`${phasePath}.trigger`, "a trigger event needs a trigger");
            else if (!(Number(phase.trigger.radius) >= 1)) fail(`${phasePath}.trigger.radius`, "a trigger needs its own radius; the hitbox radius is not used");
            const hitboxServesAnotherEvent = ["collision", "hit", "killed"].some((type) => phase.on?.[type] != null)
                || phase.health != null;
            if (phase.trigger?.radius != null && phase.hitbox?.radius != null && !hitboxServesAnotherEvent) {
                fail(`${phasePath}.hitbox.radius`, "set alongside trigger.radius but no collision, hit or killed event uses the hitbox; drop it");
            }
        };
        for (const [phaseIndex, phase] of entity.phases.entries()) {
            const phasePath = `${here}.phases[${phaseIndex}]`;
            oneOf(`${phasePath}.type`, "phaseType", phase.type);
            ms(`${phasePath}.durationMs`, phase.durationMs);
            ms(`${phasePath}.trigger.lifetimeMs`, phase.trigger?.lifetimeMs);
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
            }
            for (const [eventType, event] of Object.entries(phase.on ?? {})) {
                const eventPath = `${phasePath}.on.${eventType}`;
                oneOf(eventPath, "eventType", eventType);
                for (const kind of event.targets ?? []) oneOf(`${eventPath}.targets`, "targetKind", kind);
                oneOf(`${eventPath}.schedule.mode`, "scheduleMode", event.schedule?.mode);
                ms(`${eventPath}.schedule.intervalMs`, event.schedule?.intervalMs);
                // Unlimited is a missing count; 0 would mean unlimited in the browser and never in the server.
                bounded(`${eventPath}.schedule.count`, event.schedule?.count, 1000, { min: 1 });
                if (event.targetPolicy) oneOf(`${eventPath}.targetPolicy.mode`, "targetPolicyMode", event.targetPolicy.mode);
                if (typeof event.nearestOnly !== "boolean") fail(`${eventPath}.nearestOnly`, "missing");
                if (typeof event.waitForHit !== "boolean") fail(`${eventPath}.waitForHit`, "missing");
                if (eventType === "schedule") {
                    if (event.schedule?.mode !== "repeat") fail(`${eventPath}.schedule.mode`, "a schedule event repeats");
                    if (!(event.schedule?.intervalMs > 0)) fail(`${eventPath}.schedule.intervalMs`, "a schedule event needs intervalMs");
                } else if (event.waitForHit) {
                    fail(`${eventPath}.waitForHit`, "only a schedule event waits for its hit");
                }
                if (!Array.isArray(event.do)) { fail(`${eventPath}.do`, "must be a list of verbs"); continue; }
                for (const [verbIndex, verb] of event.do.entries()) {
                    checkVerb(verb, `${eventPath}.do[${verbIndex}]`, { context: "event", phaseIds, entityNames });
                }
            }
        }
    };

    for (const [index, ability] of (abilities?.abilities ?? []).entries()) {
        const path = `abilities[${index}]`;
        if (!Number.isInteger(ability.id) || ability.id <= 0) fail(`${path}.id`, `${ability.id} is not a positive integer`);
        else if (ids.has(ability.id)) fail(`${path}.id`, `duplicate id ${ability.id}`);
        ids.add(ability.id);
        if (!ability.name || names.has(ability.name)) fail(`${path}.name`, `missing or duplicate name ${ability.name}`);
        names.add(ability.name);
        if (!ability.label || labels.has(ability.label)) fail(`${path}.label`, `missing or duplicate label ${ability.label}`);
        labels.add(ability.label);

        if (!channelIds.has(ability.channel)) fail(`${path}.channel`, `unknown channel ${JSON.stringify(ability.channel)}`);
        if (ability.cost !== null && ability.cost !== undefined) {
            if (ability.channel !== DASH_CHANNEL) fail(`${path}.cost`, "only the dash channel may declare a stamina cost");
            bounded(`${path}.cost.stamina`, ability.cost.stamina, movement?.config?.staminaMax ?? 100, { min: 1, integer: true });
            if (ability.cost.stamina == null) fail(`${path}.cost`, "needs stamina");
        } else if (ability.cost === undefined) {
            fail(`${path}.cost`, "missing (write null when the ability costs nothing)");
        }

        const timing = ability.timing ?? {};
        ms(`${path}.timing.cooldownMs`, timing.cooldownMs);
        ms(`${path}.timing.windupMs`, timing.windupMs);
        ms(`${path}.timing.activeMs`, timing.activeMs, { allowOneMs: true });
        ms(`${path}.timing.durationMs`, timing.durationMs);
        ms(`${path}.timing.reloadMs`, timing.reloadMs);
        bounded(`${path}.timing.maxCharges`, timing.maxCharges, 100, { min: 1, integer: true });
        oneOf(`${path}.timing.resourceModel`, "resourceModel", timing.resourceModel, { nullable: true });
        if ((timing.maxCharges == null) !== (timing.reloadMs == null)) fail(`${path}.timing`, "maxCharges and reloadMs go together");

        if (!ability.activation) fail(`${path}.activation`, "missing");
        const entities = ability.entities ?? {};
        const entityNames = new Set(Object.keys(entities));
        if (!Array.isArray(ability.onTrigger) || ability.onTrigger.length === 0) {
            fail(`${path}.onTrigger`, "needs at least one verb");
        }
        for (const [verbIndex, verb] of (ability.onTrigger ?? []).entries()) {
            checkVerb(verb, `${path}.onTrigger[${verbIndex}]`, { context: "trigger", phaseIds: new Set(), entityNames });
        }
        for (const [entityName, entity] of Object.entries(entities)) {
            checkEntity(entity, `${path}.entities.${entityName}`, entityNames);
        }
    }
    for (const [name, id] of Object.entries(legacy)) {
        if (!ids.has(id)) fail(`abilities.legacyNames.${name}`, `${id} is not an ability id`);
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

    if (errors.length > 0) {
        throw new Error(`Invalid gameplay data (${errors.length}):\n${errors.slice(0, 30).join("\n")}`);
    }
}
