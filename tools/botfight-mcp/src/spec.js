import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { mcpRoot } from "./runtime.js";

const SPEC_DIR = path.join(mcpRoot, "specs");
const SLUG_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const CATEGORIES = ["botAttached", "projectile", "trap", "summon", "zone"];
const PHASE_TYPES = ["self", "melee", "ray", "arc", "projectile", "zone", "summon", "botAttached"];
const EFFECT_TYPES = ["damage", "healing", "knockback", "pull", "status", "buff", "interrupt", "teleport", "restore_state", "damage_reduction", "damage_immunity", "damage_reflection"];
const PHASE_EVENTS = ["activation", "collision", "trigger", "hit", "killed", "lifetimeEnd", "enter", "exit"];
const PHASE_ACTIONS = ["applyEffects", "startMovement", "startOrientation", "transition", "remove", "emitVisual"];
const TARGET_KINDS = ["BOT", "HP_ENTITY", "SUMMON", "ENTITY"];
const TIMER_MODES = ["NONE", "AGE", "REMAINING", "STOPPED", "FUSE"];
const RESOURCE_MODELS = ["NONE", "RELOAD_WHEN_EMPTY", "REGENERATE", "FIXED", "HP"];
const EVENT_SCHEDULES = ["once", "repeat", "continuous"];
const TARGET_POLICIES = ["once", "everyTick", "interval"];
const PHASE_FIELDS = ["id", "type", "movement", "trigger", "hitbox", "health", "effects", "visual", "events", "durationMs", "execution", "transitionOnly", "skipOwner", "hit", "visibleMs", "statOverrides", "effectOverrides", "startMs", "orientation"];

const object = (value, pathName, allowed = null) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${pathName} must be an object.`);
    }
    if (allowed) {
        const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
        if (unknown.length) throw new Error(`${pathName} has unsupported field(s): ${unknown.join(", ")}.`);
    }
    return value;
};
const finite = (value, pathName, { min = -Infinity, max = Infinity, integer = false, optional = false } = {}) => {
    if (value == null && optional) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new Error(`${pathName} must be a ${integer ? "whole number" : "finite number"} between ${min} and ${max}.`);
    }
    return value;
};
const text = (value, pathName, { min = 1, max = 160, optional = false } = {}) => {
    if (value == null && optional) return undefined;
    if (typeof value !== "string" || value.trim().length < min || value.length > max) {
        throw new Error(`${pathName} must be a string ${min}-${max} characters long.`);
    }
    return value.trim();
};
const bool = (value, pathName, fallback = false) => {
    if (value == null) return fallback;
    if (typeof value !== "boolean") throw new Error(`${pathName} must be a boolean.`);
    return value;
};
const normalizeEnumText = (value) => String(value).trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
const enumKey = (value, keys, pathName) => {
    const key = normalizeEnumText(value);
    if (!keys.includes(key)) throw new Error(`${pathName} must be one of: ${keys.join(", ")}.`);
    return key;
};
const enumCase = (value, values, pathName) => {
    const entry = values.find((candidate) => normalizeEnumText(candidate) === normalizeEnumText(value));
    if (!entry) throw new Error(`${pathName} must be one of: ${values.join(", ")}.`);
    return entry;
};
const enumCamel = (value, values, pathName) => {
    const key = normalizeEnumText(value);
    const entry = values.find((item) => normalizeEnumText(item) === key);
    if (!entry) throw new Error(pathName + " must be one of: " + values.join(", ") + ".");
    return entry;
};
const enumSnake = (value, values, pathName) => {
    const entry = values.find((item) => normalizeEnumText(item) === normalizeEnumText(value));
    if (!entry) throw new Error(`${pathName} must be one of: ${values.join(", ")}.`);
    return entry;
};
const compact = (entries) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
function array(value, pathName, fallback = []) {
    if (value == null) return fallback;
    if (!Array.isArray(value)) throw new Error(`${pathName} must be an array.`);
    return value;
}

function normalizeTargetDefault(value, pathName) {
    if (value == null) return undefined;
    if (typeof value === "number") return finite(value, pathName);
    const expected = pathName.endsWith("defaultX") ? "owner.x" : "owner.y";
    if (value === expected) return value;
    throw new Error(`${pathName} must be a finite number or '${expected}'.`);
}

function normalizeFalloff(value, pathName) {
    if (value == null) return undefined;
    const source = object(value, pathName, ["minAmount", "maxAmount", "minDurationMs", "maxDurationMs", "falloffStart", "falloffEnd"]);
    const result = compact({
        minAmount: finite(source.minAmount, `${pathName}.minAmount`, { min: 0, optional: true }),
        maxAmount: finite(source.maxAmount, `${pathName}.maxAmount`, { min: 0, optional: true }),
        minDurationMs: finite(source.minDurationMs, `${pathName}.minDurationMs`, { min: 0, integer: true, optional: true }),
        maxDurationMs: finite(source.maxDurationMs, `${pathName}.maxDurationMs`, { min: 0, integer: true, optional: true }),
        falloffStart: finite(source.falloffStart, `${pathName}.falloffStart`, { min: 0, optional: true }),
        falloffEnd: finite(source.falloffEnd, `${pathName}.falloffEnd`, { min: 0, optional: true }),
    });
    if (result.falloffStart == null || result.falloffEnd == null) throw new Error(`${pathName} requires falloffStart and falloffEnd.`);
    if (result.falloffEnd < result.falloffStart) throw new Error(`${pathName}.falloffEnd cannot be less than falloffStart.`);
    if (result.minAmount == null && result.maxAmount == null && result.minDurationMs == null && result.maxDurationMs == null) {
        throw new Error(`${pathName} requires an amount or duration profile.`);
    }
    return result;
}

function normalizeEffectOverride(value, pathName) {
    const source = object(value, pathName, ["amount", "durationMs", "falloff"]);
    const result = compact({
        amount: finite(source.amount, `${pathName}.amount`, { min: 0, optional: true }),
        durationMs: finite(source.durationMs, `${pathName}.durationMs`, { min: 0, integer: true, optional: true }),
        falloff: normalizeFalloff(source.falloff, `${pathName}.falloff`),
    });
    if (!Object.keys(result).length) throw new Error(`${pathName} must set amount, durationMs, or falloff.`);
    return result;
}

function normalizeEffect(value, pathName) {
    const source = object(value, pathName, ["type", "subtype", "buff", "amount", "multiplier", "durationMs", "delayMs", "whileInside", "runtimeComputed", "recipient", "requiresConfirmedDamage", "mirrorsDamage", "distanceMode", "falloff", "intervalMs", "movementLockMs", "targetKinds"]);
    const typeValue = enumSnake(source.type, EFFECT_TYPES, `${pathName}.type`);
    const subtype = text(source.subtype ?? source.buff, `${pathName}.subtype`, { max: 80, optional: true });
    if (["status", "buff"].includes(typeValue) && !subtype) throw new Error(`${pathName}.subtype is required for ${typeValue}.`);
    if (source.multiplier != null && !["buff", "damage_reduction", "damage_reflection"].includes(typeValue)) {
        throw new Error(`${pathName}.multiplier is only supported on buff, damage_reduction, or damage_reflection effects.`);
    }
    if (source.whileInside != null && typeValue !== "status") throw new Error(`${pathName}.whileInside is only supported on status effects.`);
    if (source.distanceMode != null && typeValue !== "teleport") throw new Error(`${pathName}.distanceMode is only supported on teleport effects.`);
    const distanceMode = source.distanceMode == null ? undefined
        : enumCase(source.distanceMode, ["center_distance"], `${pathName}.distanceMode`);
    const sourceTargetKinds = array(source.targetKinds, `${pathName}.targetKinds`);
    const targetKinds = sourceTargetKinds.length === 0
        ? typeValue === "damage" ? ["BOT", "HP_ENTITY"] : ["BOT"]
        : sourceTargetKinds.map((item, index) => enumKey(item, TARGET_KINDS, `${pathName}.targetKinds[${index}]`));
    return {
        type: typeValue,
        ...compact({
            subtype,
            amount: finite(source.amount, `${pathName}.amount`, { min: 0, optional: true }),
            multiplier: finite(source.multiplier, `${pathName}.multiplier`, { min: 0, optional: true }),
            durationMs: finite(source.durationMs ?? source.delayMs, `${pathName}.durationMs`, { min: 0, integer: true, optional: true }),
            whileInside: source.whileInside == null ? undefined : bool(source.whileInside, `${pathName}.whileInside`),
            runtimeComputed: source.runtimeComputed == null ? undefined : bool(source.runtimeComputed, `${pathName}.runtimeComputed`),
            recipient: text(source.recipient, `${pathName}.recipient`, { max: 50, optional: true }),
            requiresConfirmedDamage: source.requiresConfirmedDamage == null ? undefined : bool(source.requiresConfirmedDamage, `${pathName}.requiresConfirmedDamage`),
            mirrorsDamage: source.mirrorsDamage == null ? undefined : bool(source.mirrorsDamage, `${pathName}.mirrorsDamage`),
            distanceMode,
            falloff: normalizeFalloff(source.falloff, `${pathName}.falloff`),
            intervalMs: finite(source.intervalMs, `${pathName}.intervalMs`, { min: 1, integer: true, optional: true }),
            movementLockMs: finite(source.movementLockMs, `${pathName}.movementLockMs`, { min: 0, integer: true, optional: true }),
        }),
        targetKinds: [...new Set(targetKinds)],
    };
}

function normalizeSchedule(value, eventType, pathName) {
    const source = value == null ? {} : object(value, pathName, ["mode", "intervalMs", "startImmediately", "count"]);
    const defaultMode = eventType === "collision" ? "continuous" : "once";
    const mode = source.mode == null ? defaultMode : enumCase(source.mode, EVENT_SCHEDULES, `${pathName}.mode`);
    if (mode === "continuous" && eventType !== "collision") throw new Error(`${pathName}.mode continuous is only valid for collision events.`);
    if (mode !== "repeat") return { mode };
    return {
        mode,
        intervalMs: finite(source.intervalMs, `${pathName}.intervalMs`, { min: 1, integer: true }),
        startImmediately: bool(source.startImmediately, `${pathName}.startImmediately`, true),
        ...compact({ count: finite(source.count, `${pathName}.count`, { min: 1, integer: true, optional: true }) }),
    };
}

function normalizeEvent(value, eventType, pathName) {
    const source = object(value, pathName, ["actions", "effectTypes", "transition", "schedule", "visualType", "visibleMs", "visualSize", "targetPolicy", "targetKinds", "statusTypes", "pullDirection", "recheckCollisionOnTransition"]);
    const actions = array(source.actions, `${pathName}.actions`)
        .map((item, index) => enumCamel(item, PHASE_ACTIONS, `${pathName}.actions[${index}]`));
    const visualType = text(source.visualType, `${pathName}.visualType`, { max: 100, optional: true });
    const visibleMs = finite(source.visibleMs, `${pathName}.visibleMs`, { min: 1, integer: true, optional: true });
    if (visualType && visibleMs == null) throw new Error(`${pathName} visualType requires a positive visibleMs.`);
    if (actions.includes("emitVisual") && !visualType) throw new Error(`${pathName}.actions includes emitVisual but no visualType is declared.`);
    if (visualType && !actions.includes("emitVisual")) {
        const removeIndex = actions.indexOf("remove");
        actions.splice(removeIndex < 0 ? actions.length : removeIndex, 0, "emitVisual");
    }
    const transition = source.transition == null ? undefined : (() => {
        const spec = object(source.transition, `${pathName}.transition`, ["to"]);
        return { to: text(spec.to, `${pathName}.transition.to`, { max: 80 }) };
    })();
    if (actions.includes("transition") && !transition) throw new Error(`${pathName} has a transition action but no transition.to.`);
    if (transition && !actions.includes("transition")) throw new Error(`${pathName}.transition requires the transition action.`);
    const policy = source.targetPolicy == null ? undefined : (() => {
        const spec = object(source.targetPolicy, `${pathName}.targetPolicy`, ["mode", "intervalStat", "interval", "intervalMs"]);
        const mode = enumCase(spec.mode, TARGET_POLICIES, `${pathName}.targetPolicy.mode`);
        if (spec.intervalStat != null || spec.interval != null) {
            throw new Error(`${pathName}.targetPolicy intervalStat is not supported by the browser and Java event executors; use intervalMs.`);
        }
        return compact({
            mode,
            intervalMs: finite(spec.intervalMs, `${pathName}.targetPolicy.intervalMs`, { min: 1, integer: true, optional: true }),
        });
    })();
    const sourceTargetKinds = array(source.targetKinds, `${pathName}.targetKinds`);
    const kinds = sourceTargetKinds.length === 0
        ? ["BOT"]
        : sourceTargetKinds.map((item, index) => enumKey(item, TARGET_KINDS, `${pathName}.targetKinds[${index}]`));
    const effectTypes = array(source.effectTypes, `${pathName}.effectTypes`)
        .map((item, index) => enumSnake(item, EFFECT_TYPES, `${pathName}.effectTypes[${index}]`));
    const statusTypes = array(source.statusTypes, `${pathName}.statusTypes`)
        .map((item, index) => text(item, `${pathName}.statusTypes[${index}]`, { max: 80 }).toLowerCase());
    return compact({
        actions: [...new Set(actions)],
        effectTypes: effectTypes.length ? [...new Set(effectTypes)] : undefined,
        transition,
        schedule: normalizeSchedule(source.schedule, eventType, `${pathName}.schedule`),
        visualType,
        visibleMs,
        visualSize: finite(source.visualSize, `${pathName}.visualSize`, { min: 0, optional: true }),
        targetPolicy: policy,
        targetKinds: [...new Set(kinds)],
        statusTypes: statusTypes.length ? [...new Set(statusTypes)] : undefined,
        pullDirection: source.pullDirection == null ? undefined : text(source.pullDirection, `${pathName}.pullDirection`, { max: 80 }).toLowerCase(),
        recheckCollisionOnTransition: source.recheckCollisionOnTransition == null ? undefined : bool(source.recheckCollisionOnTransition, `${pathName}.recheckCollisionOnTransition`),
    });
}

function normalizePhase(value, pathName) {
    const source = object(value, pathName, PHASE_FIELDS);
    const id = text(source.id, `${pathName}.id`, { max: 80 });
    const type = enumCamel(source.type, PHASE_TYPES, `${pathName}.type`);
    const movement = source.movement == null ? undefined : (() => {
        const item = object(source.movement, `${pathName}.movement`, ["speed", "turnDegrees", "size", "distance", "trailMs", "blockedByStatus", "direction"]);
        return compact({
            speed: finite(item.speed, `${pathName}.movement.speed`, { min: 0 }),
            turnDegrees: finite(item.turnDegrees, `${pathName}.movement.turnDegrees`, { optional: true }),
            size: finite(item.size, `${pathName}.movement.size`, { min: 0, optional: true }),
            distance: finite(item.distance, `${pathName}.movement.distance`, { min: 0, optional: true }),
            trailMs: finite(item.trailMs, `${pathName}.movement.trailMs`, { min: 0, integer: true, optional: true }),
            blockedByStatus: text(item.blockedByStatus, `${pathName}.movement.blockedByStatus`, { max: 80, optional: true }),
            direction: item.direction == null ? undefined : enumCase(item.direction, ["forward", "backward"], `${pathName}.movement.direction`),
        });
    })();
    const hitbox = source.hitbox == null ? undefined : (() => {
        const item = object(source.hitbox, `${pathName}.hitbox`, ["shape", "radius", "range", "arc", "radiusMultiplier", "width", "length", "includeTargetRadius"]);
        const shape = enumCase(item.shape, ["circle", "rectangle", "ray", "arc"], `${pathName}.hitbox.shape`);
        const result = compact({
            shape,
            radius: finite(item.radius, `${pathName}.hitbox.radius`, { min: 0, optional: true }),
            range: finite(item.range, `${pathName}.hitbox.range`, { min: 0, optional: true }),
            arc: finite(item.arc, `${pathName}.hitbox.arc`, { min: 0, max: 360, optional: true }),
            radiusMultiplier: finite(item.radiusMultiplier, `${pathName}.hitbox.radiusMultiplier`, { min: 0, optional: true }),
            width: finite(item.width, `${pathName}.hitbox.width`, { min: 0, optional: true }),
            length: finite(item.length, `${pathName}.hitbox.length`, { min: 0, optional: true }),
            includeTargetRadius: item.includeTargetRadius == null ? undefined : bool(item.includeTargetRadius, `${pathName}.hitbox.includeTargetRadius`),
        });
        const has = (field) => result[field] != null;
        if (shape === "circle" && !has("radius")) throw new Error(`${pathName}.hitbox.radius is required for a circle.`);
        if (shape === "rectangle" && (!has("width") || !has("length"))) throw new Error(`${pathName}.hitbox.width and length are required for a rectangle.`);
        if (shape === "ray" && (!has("range") || !has("width"))) throw new Error(`${pathName}.hitbox.range and width are required for a ray.`);
        if (shape === "arc" && (!has("range") || !has("arc"))) throw new Error(`${pathName}.hitbox.range and arc are required for an arc.`);
        return result;
    })();
    const effects = array(source.effects, `${pathName}.effects`)
        .map((item, index) => normalizeEffect(item, `${pathName}.effects[${index}]`));
    const eventsSource = source.events == null ? {} : object(source.events, `${pathName}.events`, null);
    const events = {};
    for (const [key, event] of Object.entries(eventsSource)) {
        const eventType = enumCamel(key, PHASE_EVENTS, `${pathName}.events key`);
        events[eventType] = normalizeEvent(event, eventType, `${pathName}.events.${eventType}`);
    }
    const visual = source.visual === null ? null : source.visual == null ? undefined : (() => {
        const item = object(source.visual, `${pathName}.visual`, ["type", "state", "visualSize", "visibleMs"]);
        return {
            type: text(item.type, `${pathName}.visual.type`, { max: 100 }),
            visualSize: finite(item.visualSize, `${pathName}.visual.visualSize`, { min: 0 }),
            ...compact({
                state: text(item.state, `${pathName}.visual.state`, { max: 80, optional: true }),
                visibleMs: finite(item.visibleMs, `${pathName}.visual.visibleMs`, { min: 1, integer: true, optional: true }),
            }),
        };
    })();
    const health = source.health == null ? undefined : (() => {
        const item = object(source.health, `${pathName}.health`, ["hp", "maxHp", "allowFriendlyDamage"]);
        const maxHp = finite(item.maxHp, `${pathName}.health.maxHp`, { min: 0 });
        const hp = finite(item.hp ?? maxHp, `${pathName}.health.hp`, { min: 0 });
        if (hp > maxHp) throw new Error(`${pathName}.health.hp cannot exceed maxHp.`);
        return { hp, maxHp, allowFriendlyDamage: bool(item.allowFriendlyDamage, `${pathName}.health.allowFriendlyDamage`) };
    })();
    const trigger = source.trigger == null ? undefined : (() => {
        const item = object(source.trigger, `${pathName}.trigger`, ["radius", "lifetimeMs", "attackHits", "projectileOverlap", "botContact", "chain"]);
        return compact({
            radius: finite(item.radius, `${pathName}.trigger.radius`, { min: 0, optional: true }),
            lifetimeMs: finite(item.lifetimeMs, `${pathName}.trigger.lifetimeMs`, { min: 0, integer: true, optional: true }),
            attackHits: item.attackHits == null ? undefined : bool(item.attackHits, `${pathName}.trigger.attackHits`),
            projectileOverlap: item.projectileOverlap == null ? undefined : bool(item.projectileOverlap, `${pathName}.trigger.projectileOverlap`),
            botContact: item.botContact == null ? undefined : bool(item.botContact, `${pathName}.trigger.botContact`),
            chain: item.chain == null ? undefined : bool(item.chain, `${pathName}.trigger.chain`),
        });
    })();
    const execution = source.execution == null ? undefined : (() => {
        const item = object(source.execution, `${pathName}.execution`, ["event", "interval", "intervalMs", "startImmediately", "abilityId"]);
        return compact({
            event: item.event == null ? undefined : enumCamel(item.event, PHASE_EVENTS, `${pathName}.execution.event`),
            interval: text(item.interval, `${pathName}.execution.interval`, { max: 80, optional: true }),
            intervalMs: finite(item.intervalMs, `${pathName}.execution.intervalMs`, { min: 1, integer: true, optional: true }),
            startImmediately: item.startImmediately == null ? undefined : bool(item.startImmediately, `${pathName}.execution.startImmediately`),
            abilityId: text(item.abilityId, `${pathName}.execution.abilityId`, { max: 80, optional: true }),
        });
    })();
    const orientation = source.orientation == null ? undefined : (() => {
        const item = object(source.orientation, `${pathName}.orientation`, ["mode", "targetSource"]);
        return {
            mode: enumCamel(item.mode, ["faceTarget"], `${pathName}.orientation.mode`),
            targetSource: enumCamel(item.targetSource, ["activationTarget"], `${pathName}.orientation.targetSource`),
        };
    })();
    for (const [eventType, event] of Object.entries(events)) {
        if (event.actions.includes("applyEffects") && effects.length === 0) {
            throw new Error(`${pathName}.events.${eventType} applies effects but the phase has no effects.`);
        }
        if (event.actions.includes("startMovement") && !movement) {
            throw new Error(`${pathName}.events.${eventType} starts movement but the phase has no movement contract.`);
        }
        if (event.actions.includes("startOrientation") && !orientation) {
            throw new Error(`${pathName}.events.${eventType} starts orientation but the phase has no orientation contract.`);
        }
        if (event.effectTypes?.some((type) => !effects.some((effect) => effect.type === type))) {
            throw new Error(`${pathName}.events.${eventType}.effectTypes must reference an effect present on the same phase.`);
        }
    }
    const hit = source.hit == null ? undefined : (() => {
        const item = object(source.hit, `${pathName}.hit`, ["mode", "removeOnHit", "oncePerTarget", "knockbackDirection"]);
        return compact({
            mode: item.mode == null ? undefined : enumCase(item.mode, ["all", "nearest"], `${pathName}.hit.mode`),
            removeOnHit: item.removeOnHit == null ? undefined : bool(item.removeOnHit, `${pathName}.hit.removeOnHit`),
            oncePerTarget: item.oncePerTarget == null ? undefined : bool(item.oncePerTarget, `${pathName}.hit.oncePerTarget`),
            knockbackDirection: text(item.knockbackDirection, `${pathName}.hit.knockbackDirection`, { max: 80, optional: true }),
        });
    })();
    const durationMs = finite(source.durationMs, `${pathName}.durationMs`, { min: 0, integer: true, optional: true });
    const visibleMs = finite(source.visibleMs, `${pathName}.visibleMs`, { min: 1, integer: true, optional: true });
    const statOverrides = source.statOverrides == null ? undefined : (() => {
        const item = object(source.statOverrides, `${pathName}.statOverrides`, null);
        return Object.fromEntries(Object.entries(item).map(([key, number]) => [key, finite(number, `${pathName}.statOverrides.${key}`)]));
    })();
    const effectOverrides = source.effectOverrides == null ? undefined : (() => {
        const item = object(source.effectOverrides, `${pathName}.effectOverrides`, null);
        return Object.fromEntries(Object.entries(item).map(([key, override]) => [
            text(key, `${pathName}.effectOverrides key`, { max: 100 }),
            normalizeEffectOverride(override, `${pathName}.effectOverrides.${key}`),
        ]));
    })();
    return compact({
        id,
        type,
        movement,
        trigger,
        hitbox,
        health,
        effects,
        visual,
        events: Object.keys(events).length ? events : undefined,
        durationMs,
        execution,
        transitionOnly: source.transitionOnly == null ? undefined : bool(source.transitionOnly, `${pathName}.transitionOnly`),
        skipOwner: source.skipOwner == null ? undefined : bool(source.skipOwner, `${pathName}.skipOwner`),
        hit,
        visibleMs,
        statOverrides,
        effectOverrides,
        startMs: finite(source.startMs, `${pathName}.startMs`, { min: -1, integer: true, optional: true }),
        orientation,
    });
}

function normalizeContract(value, category, pathName) {
    const source = object(value, pathName, ["entityType", "runtimeType", "spawn", "targeting", "lifetime", "state", "activation", "phases", "abilities"]);
    const spawnSource = source.spawn == null ? {} : object(source.spawn, `${pathName}.spawn`, ["offset", "rotation", "rotationSpace"]);
    const offsetSource = spawnSource.offset == null ? {} : object(spawnSource.offset, `${pathName}.spawn.offset`, ["x", "y"]);
    const spawn = {
        offset: {
            x: finite(offsetSource.x ?? 0, `${pathName}.spawn.offset.x`),
            y: finite(offsetSource.y ?? 0, `${pathName}.spawn.offset.y`),
        },
        rotation: finite(spawnSource.rotation ?? 0, `${pathName}.spawn.rotation`, { min: -360, max: 360 }),
        rotationSpace: enumCase(spawnSource.rotationSpace ?? "owner", ["owner", "world"], `${pathName}.spawn.rotationSpace`),
    };
    const targetingSource = source.targeting == null ? {} : object(source.targeting, `${pathName}.targeting`, ["owner", "position", "clampToRadius", "defaultX", "defaultY"]);
    const targeting = compact({
        owner: enumCase(targetingSource.owner ?? "owner", ["owner", "none"], `${pathName}.targeting.owner`),
        position: targetingSource.position == null ? undefined : enumCase(targetingSource.position, ["target"], `${pathName}.targeting.position`),
        clampToRadius: finite(targetingSource.clampToRadius, `${pathName}.targeting.clampToRadius`, { min: 0, optional: true }),
        defaultX: normalizeTargetDefault(targetingSource.defaultX, `${pathName}.targeting.defaultX`),
        defaultY: normalizeTargetDefault(targetingSource.defaultY, `${pathName}.targeting.defaultY`),
    });
    const lifetimeSource = source.lifetime == null ? {} : object(source.lifetime, `${pathName}.lifetime`, ["duration", "add", "timerMode"]);
    const lifetime = compact({
        duration: finite(lifetimeSource.duration, `${pathName}.lifetime.duration`, { min: 0, integer: true, optional: true }),
        add: finite(lifetimeSource.add, `${pathName}.lifetime.add`, { min: 0, integer: true, optional: true }),
        timerMode: lifetimeSource.timerMode == null ? undefined : enumKey(lifetimeSource.timerMode, TIMER_MODES, `${pathName}.lifetime.timerMode`),
    });
    if (category !== "botAttached" && lifetime.duration > 0 && lifetime.timerMode == null) {
        throw new Error(`${pathName}.lifetime.timerMode is required for a timed entity ability (AGE, REMAINING, STOPPED, or FUSE).`);
    }
    if (category === "botAttached" && lifetime.timerMode == null) lifetime.timerMode = "NONE";
    const stateSource = source.state == null ? {} : object(source.state, `${pathName}.state`, ["armed", "damageMultiplier"]);
    const state = compact({
        armed: stateSource.armed == null ? undefined : bool(stateSource.armed, `${pathName}.state.armed`),
        damageMultiplier: stateSource.damageMultiplier == null ? undefined : (() => {
            const value = object(stateSource.damageMultiplier, `${pathName}.state.damageMultiplier`, ["context", "fallback"]);
            if (value.context !== "damageMultiplier") throw new Error(`${pathName}.state.damageMultiplier.context must be damageMultiplier.`);
            const fallback = object(value.fallback, `${pathName}.state.damageMultiplier.fallback`, ["ownerStat", "fallback"]);
            if (fallback.ownerStat !== "attackDamageMultiplier") throw new Error(`${pathName}.state.damageMultiplier.fallback.ownerStat must be attackDamageMultiplier.`);
            const fallbackValue = finite(fallback.fallback, `${pathName}.state.damageMultiplier.fallback.fallback`);
            if (fallbackValue !== 1) throw new Error(`${pathName}.state.damageMultiplier fallback must be 1 because the Java InitialState contract stores only whether owner scaling is enabled.`);
            return { context: "damageMultiplier", fallback: { ownerStat: "attackDamageMultiplier", fallback: fallbackValue } };
        })(),
    });
    const activationSource = source.activation == null ? {} : object(source.activation, `${pathName}.activation`, ["targetMode", "captureAtActivation", "phaseFacingDefault", "ignoresGlobalAbilityLock", "teleportOncePerActivation", "capture"]);
    const activation = compact({
        targetMode: text(activationSource.targetMode, `${pathName}.activation.targetMode`, { max: 80, optional: true }),
        captureAtActivation: activationSource.captureAtActivation == null ? undefined : bool(activationSource.captureAtActivation, `${pathName}.activation.captureAtActivation`),
        phaseFacingDefault: text(activationSource.phaseFacingDefault, `${pathName}.activation.phaseFacingDefault`, { max: 80, optional: true }),
        ignoresGlobalAbilityLock: activationSource.ignoresGlobalAbilityLock == null ? undefined : bool(activationSource.ignoresGlobalAbilityLock, `${pathName}.activation.ignoresGlobalAbilityLock`),
        teleportOncePerActivation: activationSource.teleportOncePerActivation == null ? undefined : bool(activationSource.teleportOncePerActivation, `${pathName}.activation.teleportOncePerActivation`),
        capture: activationSource.capture == null ? undefined : object(activationSource.capture, `${pathName}.activation.capture`, null),
    });
    if (!Array.isArray(source.phases) || source.phases.length < 1 || source.phases.length > 16) {
        throw new Error(`${pathName}.phases must contain between 1 and 16 phases.`);
    }
    const phases = source.phases.map((item, index) => normalizePhase(item, `${pathName}.phases[${index}]`));
    const ids = new Set(phases.map((phase) => phase.id));
    if (ids.size !== phases.length) throw new Error(`${pathName}.phases must have unique IDs.`);
    for (const [phaseIndex, phase] of phases.entries()) {
        for (const [eventType, event] of Object.entries(phase.events ?? {})) {
            if (event.transition && !ids.has(event.transition.to)) {
                throw new Error(`${pathName}.phases[${phaseIndex}].events.${eventType}.transition.to references missing phase '${event.transition.to}'.`);
            }
        }
    }
    const entityType = text(source.entityType, `${pathName}.entityType`, { max: 80, optional: category === "botAttached" });
    const runtimeType = text(source.runtimeType, `${pathName}.runtimeType`, { max: 80, optional: category === "botAttached" });
    if (category !== "botAttached" && (!entityType || !runtimeType)) {
        throw new Error(`${pathName}.entityType and runtimeType are required for ${category} abilities.`);
    }
    if (category === "botAttached" && phases.length !== 1) {
        throw new Error(`${pathName}.phases must contain exactly one phase for a botAttached ability.`);
    }
    if (category === "botAttached") {
        if (entityType || runtimeType) throw new Error(`${pathName}.entityType and runtimeType must be omitted for botAttached abilities.`);
        if (lifetime.duration || lifetime.add || (lifetime.timerMode != null && lifetime.timerMode !== "NONE")) {
            throw new Error(`${pathName}.lifetime is not supported for botAttached abilities.`);
        }
        if (targeting.owner !== "owner" || targeting.position || targeting.clampToRadius
            || targeting.defaultX != null || targeting.defaultY != null) {
            throw new Error(`${pathName}.targeting only supports owner=OWNER for botAttached abilities.`);
        }
        if (state.armed != null || state.damageMultiplier != null || (source.abilities?.length ?? 0) > 0) {
            throw new Error(`${pathName}.state and embedded abilities are not supported for botAttached abilities.`);
        }
    }
    const abilities = source.abilities ?? [];
    if (!Array.isArray(abilities) || abilities.length > 8) throw new Error(`${pathName}.abilities must be an array with at most 8 embedded abilities.`);
    const normalizedAbilities = abilities.map((entry, index) => {
        const childPath = `${pathName}.abilities[${index}]`;
        const child = object(entry, childPath, ["id", "spawn", "phases"]);
        const childSpawn = child.spawn == null ? spawn : normalizeContractSpawn(child.spawn, `${childPath}.spawn`);
        if (!Array.isArray(child.phases) || child.phases.length < 1 || child.phases.length > 16) throw new Error(`${childPath}.phases must contain 1-16 phases.`);
        return { id: text(child.id, `${childPath}.id`, { max: 80 }), spawn: childSpawn, phases: child.phases.map((phase, phaseIndex) => normalizePhase(phase, `${childPath}.phases[${phaseIndex}]`)) };
    });
    return {
        entityType: entityType ?? null,
        runtimeType: runtimeType ?? null,
        spawn,
        targeting,
        lifetime,
        state,
        activation,
        phases,
        abilities: normalizedAbilities,
    };
}

function normalizeContractSpawn(value, pathName) {
    const source = object(value, pathName, ["offset", "rotation", "rotationSpace"]);
    const offset = source.offset == null ? {} : object(source.offset, `${pathName}.offset`, ["x", "y"]);
    return {
        offset: { x: finite(offset.x ?? 0, `${pathName}.offset.x`), y: finite(offset.y ?? 0, `${pathName}.offset.y`) },
        rotation: finite(source.rotation ?? 0, `${pathName}.rotation`, { min: -360, max: 360 }),
        rotationSpace: enumCase(source.rotationSpace ?? "owner", ["owner", "world"], `${pathName}.rotationSpace`),
    };
}

export function normalizeAbilitySpec(input, { abilityId = null } = {}) {
    const allowedTop = ["schemaVersion", "id", "abilityId", "name", "label", "category", "round", "summary", "visualInterpolation", "timing", "contract", "implementationNotes"];
    const source = object(input, "spec", allowedTop);
    if (source.schemaVersion != null && source.schemaVersion !== 1) throw new Error("spec.schemaVersion must be 1.");
    const id = text(source.id, "spec.id", { max: 60 });
    if (!SLUG_RE.test(id)) throw new Error("spec.id must be a lowercase snake_case permanent slug.");
    if (abilityId != null && source.abilityId != null && Number(source.abilityId) !== abilityId) throw new Error("spec.abilityId is immutable and must match the requested ability ID.");
    const category = enumCamel(source.category, CATEGORIES, "spec.category");
    const round = finite(source.round, "spec.round", { min: 0, max: 3, integer: true });
    const timingSource = object(source.timing, "spec.timing", ["cooldownMs", "windupMs", "activeMs", "durationMs", "maxCharges", "reloadMs", "resourceModel"]);
    const maxCharges = finite(timingSource.maxCharges ?? 0, "spec.timing.maxCharges", { min: 0, integer: true });
    const reloadMs = finite(timingSource.reloadMs ?? 0, "spec.timing.reloadMs", { min: 0, integer: true });
    const resourceModel = enumKey(timingSource.resourceModel ?? (maxCharges > 0 ? "RELOAD_WHEN_EMPTY" : "NONE"), RESOURCE_MODELS, "spec.timing.resourceModel");
    if (maxCharges > 0 && (resourceModel !== "RELOAD_WHEN_EMPTY" || reloadMs <= 0)) {
        throw new Error("Charged abilities require resourceModel RELOAD_WHEN_EMPTY and reloadMs greater than zero.");
    }
    const timing = {
        cooldownMs: finite(timingSource.cooldownMs, "spec.timing.cooldownMs", { min: 0, integer: true }),
        windupMs: finite(timingSource.windupMs ?? 0, "spec.timing.windupMs", { min: 0, integer: true }),
        activeMs: finite(timingSource.activeMs ?? 0, "spec.timing.activeMs", { min: 0, integer: true }),
        durationMs: finite(timingSource.durationMs ?? 0, "spec.timing.durationMs", { min: 0, integer: true }),
        maxCharges,
        reloadMs,
        resourceModel,
    };
    const implementationNotesSource = source.implementationNotes == null ? {} : object(source.implementationNotes, "spec.implementationNotes", ["browser", "backend", "visual"]);
    const implementationNotes = compact({
        browser: text(implementationNotesSource.browser, "spec.implementationNotes.browser", { max: 1000, optional: true }),
        backend: text(implementationNotesSource.backend, "spec.implementationNotes.backend", { max: 1000, optional: true }),
        visual: text(implementationNotesSource.visual, "spec.implementationNotes.visual", { max: 1000, optional: true }),
    });
    const contract = normalizeContract(source.contract, category, "spec.contract");
    return compact({
        schemaVersion: 1,
        id,
        abilityId: abilityId ?? (source.abilityId == null ? undefined : finite(source.abilityId, "spec.abilityId", { min: 1, integer: true })),
        name: text(source.name, "spec.name", { max: 100 }),
        label: text(source.label ?? source.name, "spec.label", { max: 100 }),
        category,
        round,
        summary: text(source.summary, "spec.summary", { max: 280 }),
        visualInterpolation: enumCase(source.visualInterpolation, ["none", "linear"], "spec.visualInterpolation"),
        timing,
        contract,
        implementationNotes,
    });
}

export function seedSpecFromRuntime(abilityId, browserSnapshot, backendSnapshot) {
    const id = String(abilityId);
    const identity = browserSnapshot.registry?.[id];
    const contract = browserSnapshot.contracts?.[id];
    const timing = browserSnapshot.timing?.[id];
    const loadout = browserSnapshot.loadout?.[id];
    if (!identity || !contract || !timing || !loadout) throw new Error(`Ability ${abilityId} is missing from the browser runtime catalog.`);
    const serverContract = backendSnapshot.contracts?.[id];
    const serverTiming = backendSnapshot.timing?.[id];
    const currentTiming = {
        cooldownMs: timing.cooldownMs ?? 0,
        windupMs: timing.windupMs ?? 0,
        activeMs: timing.activeMs ?? 0,
        durationMs: timing.durationMs ?? 0,
        maxCharges: timing.maxCharges ?? 0,
        reloadMs: timing.reloadMs ?? 0,
        resourceModel: timing.resourceModel === "reload" ? "RELOAD_WHEN_EMPTY" : "NONE",
    };
    if (serverTiming) {
        currentTiming.maxCharges = serverTiming.charges ?? currentTiming.maxCharges;
        currentTiming.reloadMs = serverTiming.rechargeMs ?? currentTiming.reloadMs;
        currentTiming.resourceModel = serverTiming.resourceModel === "RELOAD_WHEN_EMPTY" ? "RELOAD_WHEN_EMPTY" : currentTiming.resourceModel;
    }
    const seededContract = structuredClone(contract);
    delete seededContract.abilityId;
    delete seededContract.category;
    if (serverContract?.lifetime?.timerMode != null) seededContract.lifetime.timerMode = serverContract.lifetime.timerMode;
    return normalizeAbilitySpec({
        schemaVersion: 1,
        id: identity.name,
        abilityId,
        name: identity.label,
        label: identity.label,
        category: contract.category,
        round: loadout.round,
        summary: loadout.summary,
        visualInterpolation: loadout.visualInterpolation,
        timing: currentTiming,
        contract: seededContract,
    }, { abilityId });
}

export function mergePatch(target, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
    const result = target && typeof target === "object" && !Array.isArray(target) ? structuredClone(target) : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete result[key];
        else result[key] = value && typeof value === "object" && !Array.isArray(value)
            ? mergePatch(result[key], value)
            : structuredClone(value);
    }
    return result;
}

export async function readSavedSpec(id) {
    const filePath = path.join(SPEC_DIR, `${id}.json`);
    try {
        return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

export async function listSavedSpecs() {
    await mkdir(SPEC_DIR, { recursive: true });
    const files = (await readdir(SPEC_DIR)).filter((name) => name.endsWith(".json")).sort();
    const rows = [];
    for (const file of files) {
        try {
            const spec = JSON.parse(await readFile(path.join(SPEC_DIR, file), "utf8"));
            rows.push({ id: spec.id, abilityId: spec.abilityId ?? null, file });
        } catch {
            rows.push({ id: path.basename(file, ".json"), abilityId: null, file, error: "invalid_json" });
        }
    }
    return rows;
}

export async function writeSavedSpec(spec, { overwrite = false } = {}) {
    await mkdir(SPEC_DIR, { recursive: true });
    const filePath = path.join(SPEC_DIR, `${spec.id}.json`);
    if (!overwrite) {
        try {
            await readFile(filePath);
            throw new Error(`A saved ability spec for '${spec.id}' already exists. Use edit_ability to update it.`);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    await rename(temporaryPath, filePath);
    return path.relative(mcpRoot, filePath).replaceAll(path.sep, "/");
}

export async function checkNewSpecIdentity(spec, browserSnapshot, backendSnapshot) {
    const browserNames = Object.values(browserSnapshot.registry ?? {}).map((entry) => entry.name);
    const backendNames = Object.values(backendSnapshot.registry ?? {});
    if (browserNames.includes(spec.id) || backendNames.includes(spec.id)) throw new Error(`Ability slug '${spec.id}' is already present in a runtime registry.`);
    const saved = await listSavedSpecs();
    if (saved.some((item) => item.id === spec.id)) throw new Error(`Ability slug '${spec.id}' already has a saved ability spec.`);
    if (browserNames.includes(spec.id) !== backendNames.includes(spec.id)) throw new Error(`Ability slug '${spec.id}' has an inconsistent runtime registry entry.`);
}

export async function nextAbilityId(browserSnapshot, backendSnapshot) {
    const ids = [
        ...Object.keys(browserSnapshot.registry ?? {}).map(Number),
        ...Object.keys(backendSnapshot.registry ?? {}).map(Number),
        ...(await listSavedSpecs()).map((row) => Number(row.abilityId)).filter(Number.isSafeInteger),
    ];
    return Math.max(0, ...ids) + 1;
}
