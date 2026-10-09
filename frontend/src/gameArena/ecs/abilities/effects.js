import {
    abilityContract,
    EFFECT_TYPES,
    effectTargetsTarget,
    entityContractForAbility,
    phaseEffects,
    phaseForEntity,
    targetKindsForEntity,
    TARGET_KINDS,
    TELEPORT_DISTANCE_MODES,
    triggerVerbs,
} from "../contracts/AbilityContracts.js";
import { ignoresHostileEffects, isAliveBot, withoutBotStatuses } from "../../gameconfig/DefensiveState.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { interruptCurrentAbility } from "../../gameconfig/AbilityResourceSystem.js";
import { recordAbilityHit } from "../../gameconfig/AbilityHitRecord.js";
import { GAMEPLAY_DATA } from "../../gameconfig/gameplayData.js";
import { CLOSING_ZONE_TYPE } from "../../gameconfig/ArenaHazardConfig.js";
import {
    HIT_STAGGER_DURATION_MS,
    HIT_STAGGER_MOVEMENT_MULTIPLIER,
    HIT_STAGGER_ROTATION_MULTIPLIER,
} from "../../gameconfig/HitStagger.js";
import { botRef, entityRef, logCombat, targetRef, withCombatAbility } from "../combatLog.js";
import {
    incomingDamageFor,
    normalizeStatusEffect,
    STATUS_EFFECT_APPLICATIONS,
    statusEffectsFor,
    statusEffectValue,
} from "../contracts/StatusContracts.js";
import { isEntityShape, ownerBot } from "../entities/EntityCombat.js";

const STATUS_PRESETS = GAMEPLAY_DATA.statuses.statuses;

/** Effect types that land on the enemy bot and so count as a hit for Time Since Hit. */
export const ENEMY_HIT_EFFECT_TYPES = new Set([
    EFFECT_TYPES.DAMAGE,
    EFFECT_TYPES.STATUS,
    EFFECT_TYPES.INTERRUPT,
    EFFECT_TYPES.KNOCKBACK,
    EFFECT_TYPES.PULL,
]);

/*
 * The mutators. Every change to a combatant (a bot or an HP entity) goes through one of these functions, which
 * write into the target in place and return it. Bots and entities share the combat fields (x, y, rotation, hp,
 * maxHp, statusEffects, damageTakenThisTick), so none of them is split into a bot path and an entity path; the
 * few rules that belong to one kind (immunity, hit stagger and reflection for bots, resetting a summon's
 * timers) are steps inside the function. Nested values (a status list, an ability record) are replaced, never
 * edited, so a frame that copied the target's fields stays valid.
 */

/**
 * Hurts `target`: immunity, incoming modifiers, rounding, the combat log, the damage counters, hit flash and
 * particles, hit stagger, and the clean-up of a bot that dies, in that order. `source` is what the damage comes
 * from (a bot, an entity, a status or the closing zone). When `reflectTo` (the attacking bot) is given and the
 * target has armor that reflects damage, the attacker takes the reflected part afterwards. `log: false` keeps the
 * hit out of the combat log (status damage on an entity, which is not an attack).
 */
export function dealDamage(target, amount, source = null, { reflectTo = null, log = true } = {}) {
    // Read before the hit: it can kill the target and clear its statuses.
    const reflection = reflectTo
        ? statusEffectValue(target, "reactive-armor", STATUS_EFFECT_APPLICATIONS.DAMAGE_REFLECTION, "multiplier", 0)
        : 0;
    if (isEntityShape(target)) damageEntity(target, amount, source, log);
    else damageBot(target, amount, source);
    if (reflection > 0) {
        dealDamage(reflectTo, roundCombatValue(Math.max(0, Number(amount) || 0) * reflection), target);
    }
    return target;
}

function damageBot(bot, damage, source) {
    if ((bot.hp ?? 0) <= 0) return;
    if (ignoresHostileEffects(bot)) return;
    const incomingDamage = incomingDamageFor(bot, source);
    const baseDamage = Math.max(0, Number(damage) || 0);
    let remaining = Math.max(0, baseDamage + baseDamage * incomingDamage.damageModifier);
    if (incomingDamage.truncateToTenths) remaining = Math.trunc(remaining * 10) / 10;
    remaining = roundCombatValue(remaining);
    const hpBefore = Math.max(0, bot.hp);
    const hp = remaining > 0 ? roundCombatValue(Math.max(0, hpBefore - remaining)) : hpBefore;
    const appliedDamage = roundCombatValue(Math.max(0, hpBefore - hp));
    logCombat("effect", { source: botRef(source), target: botRef(bot), effect: "damage", amount: appliedDamage });
    const hostile = isHostileDamageSource(source, bot);
    bot.hp = hp;
    bot.damageTakenThisTick = roundCombatValue(Math.max(0, Number(bot.damageTakenThisTick ?? 0)) + appliedDamage);
    bot.hitFlashMs = 200;
    // Monotonic presentation metadata lets Pixi see repeated hits and hazard ticks.
    if (appliedDamage > 0) bot.hitParticleEvent = Number(bot.hitParticleEvent ?? 0) + 1;
    if (appliedDamage > 0 && source?.type === CLOSING_ZONE_TYPE) {
        bot.closingZoneDamageCount = Number(bot.closingZoneDamageCount ?? 0) + 1;
    }
    if (appliedDamage > 0 && hostile) {
        applyStatus(bot, {
            type: "hit-stagger",
            remainingMs: HIT_STAGGER_DURATION_MS,
            effects: [{
                type: "movement_modifier",
                mode: "constant",
                movementMultiplier: HIT_STAGGER_MOVEMENT_MULTIPLIER,
                rotationMultiplier: HIT_STAGGER_ROTATION_MULTIPLIER,
            }],
        });
    }
    if (hp <= 0) withoutBotStatuses(bot);
}

/** An entity has no immunity, modifiers or stagger: its health goes down by the amount, to 0 at the least. */
function damageEntity(entity, amount, source, log) {
    const hpBefore = Math.max(0, Number(entity.hp ?? 0));
    const hp = Math.max(0, hpBefore - Math.max(0, Number(amount) || 0));
    if (log) logCombat("effect", { source: botRef(source), target: entityRef(entity), effect: "damage", amount: hpBefore - hp });
    entity.hp = hp;
    entity.damageTakenThisTick = Number(entity.damageTakenThisTick ?? 0) + hpBefore - hp;
}

function isHostileDamageSource(source, target) {
    const sourceTeam = Number(source?.teamNumber ?? source?.ownerTeam);
    const targetTeam = Number(target?.teamNumber);
    if (Number.isFinite(sourceTeam) && Number.isFinite(targetTeam)
        && sourceTeam > 0 && targetTeam > 0) return sourceTeam !== targetTeam;
    const sourceSlot = Number(source?.slot ?? source?.ownerSlot);
    const targetSlot = Number(target?.slot);
    return Number.isFinite(sourceSlot) && Number.isFinite(targetSlot) && sourceSlot !== targetSlot;
}

/**
 * Banks healing on `target`; it lands when the tick settles (`settleHealing`), so healing and damage in one
 * tick cannot cancel each other's rounding or revive a bot.
 */
export function heal(target, amount, source = null) {
    logCombat("effect", { source: botRef(source), target: botRef(target), effect: "healing", amount });
    target.pendingHealing = roundCombatValue(Number(target.pendingHealing ?? 0) + amount);
    return target;
}

/** Pays the banked healing into hp, capped at the maximum. */
export function settleHealing(target) {
    const healing = Math.max(0, Number(target?.pendingHealing ?? 0));
    if (!target || healing <= 0) return target;
    const maxHp = Math.max(0, Number(target.maxHp ?? BASE_BOT_HP));
    const hp = Math.max(0, Number(target.hp ?? 0));
    target.hp = roundCombatValue(Math.min(maxHp, hp + healing));
    target.pendingHealing = 0;
    return target;
}

/**
 * Adds a status to `target`, or refreshes the one of the same type and mode while keeping an active tick clock.
 * `effect` is either a ready status record ({ type, remainingMs, effects, ... }) or an effect that names a
 * preset in shared/gameplay/statuses.json ({ subtype, durationMs, ... }); the preset names the status's
 * effects, and "$amount", "$damageMultiplier" and "$movementLockMs" take their value from the effect that
 * applies it and from its source. Applying a preset that clears velocity stops a bot where it is.
 */
export function applyStatus(target, effect, { stats, source, abilityId, distance = 0 } = {}) {
    if (effect.subtype === undefined) {
        upsertStatus(target, effect);
        return target;
    }
    const preset = STATUS_PRESETS[effect.subtype];
    if (!preset) return target;
    const durationMs = Number(effect.durationMs ?? 0);
    const id = abilityId ?? effect.abilityId;
    const tokens = {
        $amount: hasAmountFalloff(effect.falloff)
            ? amountAtDistance(id, distance, effect, stats)
            : Number(effect.amount ?? 0),
        $damageMultiplier: Math.max(1, Number(source?.damageMultiplier ?? source?.attackDamageMultiplier ?? 1)),
        $movementLockMs: Number(effect.movementLockMs ?? 0),
    };
    const presence = preset.presenceWhenInside && Boolean(effect.whileInside);
    const status = {
        type: effect.subtype,
        abilityId: id ?? null,
        mode: preset.presenceWhenInside && presence ? "presence" : "duration",
        remainingMs: presence ? 0 : durationMs,
        tickMs: preset.tickIntervalDefaultMs == null ? 0 : Number(effect.intervalMs ?? preset.tickIntervalDefaultMs),
        tickElapsedMs: 0,
        sourceSlot: preset.carriesSourceSlot ? sourceSlot(source) : null,
        source: preset.presenceWhenInside ? effect.presenceField ?? null : null,
        effects: preset.effects.map((entry) => Object.fromEntries(Object.entries(entry)
            .filter(([, value]) => value !== null)
            .map(([key, value]) => [key, typeof value === "string" && value.startsWith("$") ? tokens[value] : value]))),
    };
    // Only bots carry movement velocity.
    if (preset.clearsVelocity && !isEntityShape(target)) {
        target.movementVelocityX = 0;
        target.movementVelocityY = 0;
        target.velocityX = 0;
        target.velocityY = 0;
    }
    upsertStatus(target, status);
    return target;
}

function upsertStatus(target, incomingStatus) {
    const incoming = normalizeStatusEffect(incomingStatus);
    if (!incoming) return;
    logCombat("status", {
        source: botRef(incoming.sourceSlot),
        target: targetRef(target),
        abilityId: incoming.abilityId,
        effect: incoming.type,
        amount: incoming.remainingMs,
    });
    const currentStatuses = statusEffectsFor(target);
    const current = currentStatuses.find((status) => status.type === incoming.type && status.mode === incoming.mode);
    if (!current) {
        target.statusEffects = [...currentStatuses, incoming];
        return;
    }
    const merged = {
        ...current,
        ...incoming,
        remainingMs: Math.max(current.remainingMs, incoming.remainingMs),
        tickMs: current.remainingMs > 0 || incoming.tickMs === 0 ? current.tickMs : incoming.tickMs,
        tickElapsedMs: current.remainingMs > 0
            ? Number(current.tickElapsedMs ?? 0)
            : Number(incoming.tickElapsedMs ?? 0),
        effects: mergeStatusEffects(current.effects, incoming.effects),
    };
    target.statusEffects = currentStatuses.map((status) => status.type === merged.type && status.mode === merged.mode
        ? merged : status);
}

function mergeStatusEffects(currentEffects, incomingEffects) {
    const merged = [...(currentEffects ?? [])];
    for (const incoming of incomingEffects ?? []) {
        const index = merged.findIndex((effect) => effect.type === incoming.type && effect.mode === incoming.mode);
        if (index < 0) {
            merged.push(incoming);
            continue;
        }
        const current = merged[index];
        merged[index] = {
            ...current,
            ...incoming,
            ...mergeNumericMaximum(current, incoming, "amount"),
            ...mergeNumericMaximum(current, incoming, "multiplier"),
        };
    }
    return merged;
}

function mergeNumericMaximum(current, incoming, field) {
    if (current[field] == null || incoming[field] == null) return {};
    return { [field]: Math.max(Number(current[field]), Number(incoming[field])) };
}

/**
 * Stops what `target` is doing. A bot's winding-up and active abilities are interrupted (their cooldowns
 * start); give `stun` ({ durationMs, stats, source, abilityId }) to also stun it. A summon is stunned for
 * `stun.durationMs` when that is more than 0, and its attack timer starts over either way. Entities that were
 * already spawned keep their own contract's lifetime.
 */
export function interrupt(target, stun = null) {
    if (isEntityShape(target)) {
        if (stun && stun.durationMs > 0) applyStatus(target, { subtype: "stun", durationMs: stun.durationMs }, stun);
        resetEntityExecution(target);
        return target;
    }
    interruptCurrentAbility(target);
    if (stun) applyStatus(target, { subtype: "stun", durationMs: stun.durationMs }, stun);
    return target;
}

/** Moves a bot or entity along (dx, dy) by `distance`, inside the arena. */
export function displace(target, dx, dy, distance, world) {
    const magnitude = Math.max(0.001, Math.hypot(dx, dy));
    const width = Number(world?.width ?? ARENA_WIDTH_UNITS);
    const height = Number(world?.height ?? ARENA_HEIGHT_UNITS);
    const radius = Number(target.size ?? 0) / 2;
    target.x = clamp(Number(target.x) + dx / magnitude * Number(distance || 0), radius, width - radius);
    target.y = clamp(Number(target.y) + dy / magnitude * Number(distance || 0), radius, height - radius);
    return target;
}

/*
 * The effect registry: one apply function per effect type, used for bots and HP entities alike.
 *
 * `ctx`:
 *   abilityId, stats      the ability and the phase numbers its falloff reads
 *   source                what the effect comes from (the attacker bot, or the entity); positions and
 *                         damage attribution read it
 *   owner                 the bot that owns the source. Self effects change it and damage reflection
 *                         goes to it; it is the attacker for a direct ability
 *   target                the bot or entity the effect lands on
 *   originalTarget        the target before this ability's earlier effects moved it (teleport uses it)
 *   distance              source-to-target distance for falloff; computed from positions when omitted
 *   world                 arena size and bots
 *   damageMultiplier      the source's damage multiplier
 *   fromEntity            true when the source is an arena entity (self effects do not apply)
 *   knockbackDirection / pullDirection
 *   damageConfirmed / damageConfirmedAmount
 *
 * `apply` changes the owner and the target in place.
 */
export const EFFECTS = Object.freeze({
    [EFFECT_TYPES.DAMAGE]: { apply: applyDamage },
    [EFFECT_TYPES.HEALING]: { self: true, apply: applyHealing },
    [EFFECT_TYPES.BUFF]: { self: true, apply: applyBuff },
    [EFFECT_TYPES.DAMAGE_REDUCTION]: { self: true, apply: applyReactiveArmor },
    [EFFECT_TYPES.DAMAGE_REFLECTION]: { self: true, apply: applyReactiveArmor },
    [EFFECT_TYPES.DAMAGE_IMMUNITY]: { self: true, apply: applyDamageImmunity },
    [EFFECT_TYPES.STATUS]: { apply: applyStatusEffect },
    [EFFECT_TYPES.INTERRUPT]: { apply: applyInterrupt },
    [EFFECT_TYPES.KNOCKBACK]: { apply: applyKnockback },
    [EFFECT_TYPES.PULL]: { apply: applyPull },
    [EFFECT_TYPES.TELEPORT]: { self: true, apply: applyTeleport },
    [EFFECT_TYPES.RESTORE_STATE]: { self: true, apply: applyRestoreState },
});

/** Applies one effect through the registry. */
export function applyEffect(effect, ctx) {
    const entry = EFFECTS[effect?.type];
    if (!entry || entry.self && ctx.fromEntity) return;
    const damageSource = ctx.source ?? ctx.owner;
    const distance = Number.isFinite(Number(ctx.distance))
        ? Number(ctx.distance)
        : ctx.target && damageSource
            ? Math.hypot(Number(ctx.target.x) - Number(damageSource.x), Number(ctx.target.y) - Number(damageSource.y))
            : 0;
    const stats = ctx.stats ?? {};
    const resolved = hasDurationFalloff(effect)
        ? { ...effect, durationMs: durationAtDistance(ctx.abilityId, distance, effect, stats) }
        : effect;
    entry.apply({
        ...ctx,
        stats,
        distance,
        damageSource,
        effect: resolved,
        world: ctx.world ?? {},
        damageMultiplier: ctx.damageMultiplier ?? 1,
    });
}

function applyDamage(ctx) {
    const { effect, abilityId, stats, distance, owner, target, damageSource } = ctx;
    if (!target) return;
    const amount = amountAtDistance(abilityId, distance, effect, stats) * ctx.damageMultiplier;
    // Damage from an entity is attributed to its owner so reflection reaches the owner bot.
    if (isEntityShape(target)) {
        dealDamage(target, amount, damageSource);
    } else if (owner && owner.id !== target.id) {
        dealDamage(target, amount, damageSource, { reflectTo: owner });
    } else {
        dealDamage(target, amount, owner ?? damageSource);
    }
}

function applyHealing(ctx) {
    const { effect, abilityId, stats, distance, owner, target, damageSource } = ctx;
    if (effect.requiresConfirmedDamage && !ctx.damageConfirmed) return;
    const toTarget = ["target", "defender"].includes(effect.recipient);
    const recipient = toTarget ? target : owner;
    if (!recipient) return;
    const healingAmount = effect.mirrorsDamage
        ? ctx.damageConfirmedAmount
        : amountAtDistance(abilityId, distance, effect, stats);
    heal(recipient, healingAmount, damageSource);
}

function applyBuff({ effect, stats, owner, damageSource }) {
    logCombat("effect", { source: botRef(damageSource), target: botRef(owner), effect: "buff", amount: effect.amount ?? 0 });
    if (effect.buff !== "overclock") return;
    const durationMs = Math.max(0, Number(effect.durationMs ?? stats.durationMs ?? 0));
    const multiplier = Math.min(1, Math.max(0, Number(effect.multiplier ?? (1 - Number(effect.amount ?? 0)))));
    applyStatus(owner, {
        type: "overclock",
        remainingMs: durationMs,
        effects: [{ type: STATUS_EFFECT_APPLICATIONS.COOLDOWN_MODIFIER, mode: "constant", multiplier }],
    });
}

function applyReactiveArmor({ effect, abilityId, stats, owner, damageSource }) {
    logCombat("effect", { source: botRef(damageSource), target: botRef(owner), effect: effect.type, amount: effect.amount ?? 0 });
    const application = effect.type === EFFECT_TYPES.DAMAGE_REDUCTION
        ? {
            type: STATUS_EFFECT_APPLICATIONS.INCOMING_DAMAGE_MODIFIER,
            mode: "constant",
            damageModifier: Math.min(0, Math.max(0, Number(effect.multiplier ?? (1 - Number(effect.amount ?? 0)))) - 1),
        }
        : {
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE_REFLECTION,
            mode: "constant",
            multiplier: Math.max(0, Number(effect.multiplier ?? effect.amount ?? 0)),
        };
    applyStatus(owner, {
        type: "reactive-armor",
        remainingMs: Math.max(0, Number(effect.durationMs ?? stats.durationMs ?? 0)),
        abilityId,
        effects: [application],
    });
}

function applyDamageImmunity({ effect, abilityId, stats, owner, damageSource }) {
    logCombat("effect", { source: botRef(damageSource), target: botRef(owner), effect: "damage_immunity", amount: effect.amount ?? 1 });
    applyStatus(owner, {
        type: "absolute-guard",
        remainingMs: Math.max(0, Number(effect.durationMs ?? stats.durationMs ?? 0)),
        abilityId,
        effects: [{
            type: STATUS_EFFECT_APPLICATIONS.DAMAGE_IMMUNITY,
            mode: "constant",
            amount: Number(effect.amount ?? 1),
        }],
    });
}

function applyStatusEffect(ctx) {
    const { effect, abilityId, stats, distance, target, damageSource } = ctx;
    const entityTarget = isEntityShape(target);
    if (!target || !entityTarget && !isAliveBot(target)) return;
    const durationMs = durationAtDistance(abilityId, distance, effect, stats);
    const preset = STATUS_PRESETS[effect.subtype];
    if (!preset) return;
    const presence = preset.presenceWhenInside && Boolean(effect.whileInside);
    // A timed status that is already over lands nothing on an entity.
    if (entityTarget && durationMs <= 0 && !presence) return;
    applyStatus(target, { ...effect, durationMs }, { stats, source: damageSource, abilityId, distance });
    if (entityTarget && preset.effects.some((entry) => isExecutionBlocker(entry.type))) resetEntityExecution(target);
}

function applyInterrupt(ctx) {
    const { effect, abilityId, stats, distance, target, damageSource } = ctx;
    const entityTarget = isEntityShape(target);
    if (!target || !entityTarget && !isAliveBot(target)) return;
    const durationMs = durationAtDistance(abilityId, distance, effect, stats);
    logCombat("effect", { source: botRef(damageSource), target: entityTarget ? entityRef(target) : botRef(target), effect: "interrupt", amount: durationMs });
    interrupt(target, { durationMs, stats, source: damageSource, abilityId });
}

function applyKnockback(ctx) {
    const { effect, abilityId, stats, distance, target, damageSource, world } = ctx;
    if (!target) return;
    const amount = amountAtDistance(abilityId, distance, effect, stats);
    logCombat("effect", { source: botRef(damageSource), target: targetRefOf(target), effect: "knockback", amount });
    const velocity = ctx.knockbackDirection === "velocity";
    const dx = velocity ? Number(damageSource.velocityX ?? 0) : Number(target.x) - Number(damageSource.x);
    const dy = velocity ? Number(damageSource.velocityY ?? 0) : Number(target.y) - Number(damageSource.y);
    displace(target, dx, dy, amount, world);
}

function applyPull(ctx) {
    const { effect, abilityId, stats, distance, target, damageSource, world } = ctx;
    if (!target) return;
    const amount = amountAtDistance(abilityId, distance, effect, stats);
    logCombat("effect", { source: botRef(damageSource), target: targetRefOf(target), effect: "pull", amount });
    const pullSource = ctx.pullDirection === "owner"
        ? (world.bots ?? []).find((bot) => bot?.id === damageSource?.ownerId
            || Number(bot?.slot) === Number(damageSource?.ownerSlot)) ?? damageSource
        : damageSource;
    const dx = Number(pullSource.x) - Number(target.x);
    const dy = Number(pullSource.y) - Number(target.y);
    if (Math.hypot(dx, dy) <= 0.001) return;
    displace(target, dx, dy, amount, world);
}

function applyTeleport(ctx) {
    const { effect, abilityId, stats, distance, owner, target, damageSource } = ctx;
    const destinationTarget = ctx.originalTarget ?? target;
    const teleportDistance = effect.distanceMode === TELEPORT_DISTANCE_MODES.CENTER_DISTANCE
        ? Math.hypot(Number(destinationTarget?.x ?? 0) - Number(damageSource?.x ?? 0), Number(destinationTarget?.y ?? 0) - Number(damageSource?.y ?? 0))
        : amountAtDistance(abilityId, distance, effect, stats);
    logCombat("effect", { source: botRef(damageSource), target: botRef(owner), effect: "teleport", amount: teleportDistance });
    if (!destinationTarget) return;
    const bearing = vectorToCompassDegrees(destinationTarget.x - owner.x, destinationTarget.y - owner.y);
    const radians = compassDegreesToRadians(bearing);
    const nextX = clamp(destinationTarget.x + Math.cos(radians) * teleportDistance, owner.size / 2, ARENA_WIDTH_UNITS - owner.size / 2);
    const nextY = clamp(destinationTarget.y + Math.sin(radians) * teleportDistance, owner.size / 2, ARENA_HEIGHT_UNITS - owner.size / 2);
    const relativeDirection = Number(owner.triggeredPhaseFacingMode ?? 0);
    const originalRotation = Number(owner.rotation ?? damageSource?.rotation ?? 0);
    owner.x = nextX;
    owner.y = nextY;
    owner.movementStartX = nextX;
    owner.movementStartY = nextY;
    owner.movementVelocityX = 0;
    owner.movementVelocityY = 0;
    owner.velocityX = 0;
    owner.velocityY = 0;
    owner.rotation = normalizeAngle(originalRotation + (Number.isFinite(relativeDirection) ? relativeDirection : 0));
}

function applyRestoreState({ effect, stats, owner, damageSource }) {
    logCombat("effect", { source: botRef(damageSource), target: botRef(owner), effect: "restore_state", amount: effect.delayMs ?? stats.delayMs ?? 0 });
    owner.temporalRewindX = damageSource.x;
    owner.temporalRewindY = damageSource.y;
    owner.temporalRewindVisualX = damageSource.x;
    owner.temporalRewindVisualY = damageSource.y;
    owner.temporalRewindHp = damageSource.hp;
    owner.temporalRewindMs = Number(effect.delayMs ?? stats.delayMs ?? 0);
    owner.temporalRewindPulseMs = 0;
}

function targetRefOf(target) {
    return isEntityShape(target) ? entityRef(target) : botRef(target);
}

function isExecutionBlocker(type) {
    return type === STATUS_EFFECT_APPLICATIONS.SILENCE || type === STATUS_EFFECT_APPLICATIONS.STUN;
}

/** A silenced or stunned summon starts its attack timer over. */
function resetEntityExecution(entity) {
    const intervalMs = Number(phaseForEntity(entity)?.execution?.intervalMs ?? 1000);
    entity.intervalTimerMs = Math.max(1, intervalMs);
}

/**
 * Applies the effects of one verb to one bot of `bots`, in place. `options.effects` lists them; `options` also
 * carries the arena (world) and directions, and may fix the collision distance.
 */
export function applyEffectsFromEntity(bots, targetIndex, source, abilityId, options = {}) {
    withCombatAbility(abilityId, () => applyEffectsFromEntityScoped(bots, targetIndex, source, abilityId, options));
}

function applyEffectsFromEntityScoped(bots, targetIndex, source, abilityId, {
    world = null,
    knockbackDirection = "source",
    pullDirection = "source",
    collisionDistance = undefined,
    statOverrides = null,
    effects = null,
} = {}) {
    const target = bots[targetIndex];
    if (!target || ignoresHostileEffects(target)) return;
    let landedOnEnemy = false;
    const owner = ownerBot(bots, source);

    for (const effect of effects ?? []) {
        if (!effectTargetsTarget(effect, [TARGET_KINDS.BOT])) continue;
        if (ENEMY_HIT_EFFECT_TYPES.has(effect.type) && isAliveBot(target)) landedOnEnemy = true;
        applyEffect(effect, {
            abilityId,
            stats: statOverrides,
            source,
            owner,
            target,
            distance: collisionDistance,
            world,
            damageMultiplier: Number(source.damageMultiplier ?? 1),
            fromEntity: true,
            knockbackDirection,
            pullDirection,
        });
    }
    if (landedOnEnemy) recordEntityHit(target, owner, source, abilityId);
}

/**
 * Applies the effects of a verb to one HP entity or summon, in place. `impact` carries the source (a bot or an
 * entity), its ability, the verb's `effects`, the distance, the stats and the damage multiplier.
 */
export function applyEffectsToEntity(target, impact, world) {
    const { source, abilityId, effects } = impact;
    withCombatAbility(abilityId, () => {
        for (const effect of effects ?? []) {
            if (!effect?.type || !effectTargetsTarget(effect, targetKindsForEntity(target))) continue;
            applyEffect(effect, {
                abilityId,
                stats: impact.stats,
                source,
                owner: null,
                target,
                distance: impact.distance,
                world,
                damageMultiplier: impact.damageMultiplier,
                fromEntity: true,
            });
        }
    });
}

/** Attributes a hit on an enemy bot to the entity's owner and ability. Allies never count. */
function recordEntityHit(target, owner, source, abilityId) {
    if (!owner || owner.id === target.id || !opposingBots(owner, target)) return;
    // The refund belongs to the activation that spawned this entity, not to the owner's latest one.
    recordAbilityHit(owner, abilityId, owner.entityActivations?.[source.id] ?? owner.activationSerial ?? 0);
}

function opposingBots(first, second) {
    const firstTeam = Number(first?.teamNumber);
    const secondTeam = Number(second?.teamNumber);
    if (Number.isFinite(firstTeam) && Number.isFinite(secondTeam) && firstTeam > 0 && secondTeam > 0) {
        return firstTeam !== secondTeam;
    }
    return Number(first?.slot) !== Number(second?.slot);
}

/** The phase numbers an entity's effects read for falloff: its stat overrides and its hitbox reach. */
export function entityEffectStats(phase) {
    return memoPhaseStats(ENTITY_STATS, phase, () => {
        const hitbox = phase?.hitbox;
        const reach = hitbox?.range ?? hitbox?.length ?? hitbox?.radius;
        return {
            ...(phase?.statOverrides ?? {}),
            ...(reach == null ? {} : { range: reach, radius: reach }),
        };
    });
}

// The stat records below depend only on the (frozen) phase or verb data, so each is built once per
// data object. Callers read them and never change them.
const ENTITY_STATS = new WeakMap();
const TRIGGER_STATS = new WeakMap();
const ABILITY_STATS = new WeakMap();

function memoPhaseStats(cache, key, build) {
    if (key == null || typeof key !== "object") return build();
    let stats = cache.get(key);
    if (stats === undefined) {
        stats = Object.freeze(build());
        cache.set(key, stats);
    }
    return stats;
}

/** The numbers a trigger verb's effects read for falloff: its hitbox reach and its damage. */
export function phaseStatsFor(phase) {
    return memoPhaseStats(TRIGGER_STATS, phase, () => buildPhaseStats(phase));
}

function buildPhaseStats(phase) {
    const hitbox = phase?.hitbox ?? {};
    const damageEffect = phase?.effects?.find((effect) => effect?.type === EFFECT_TYPES.DAMAGE);
    return {
        ...(phase?.statOverrides ?? {}),
        ...(damageEffect?.amount == null ? {} : { damage: Number(damageEffect.amount) }),
        ...(damageEffect?.falloff == null ? {} : { falloff: damageEffect.falloff }),
        ...(hitbox.range == null ? {} : { range: Number(hitbox.range) }),
        ...(hitbox.radius == null ? {} : { radius: Number(hitbox.radius) }),
        ...(hitbox.arc == null ? {} : { arc: Number(hitbox.arc) }),
        ...(hitbox.width == null ? {} : { hitboxWidth: Number(hitbox.width) }),
        ...(hitbox.length == null ? {} : { hitboxLength: Number(hitbox.length) }),
    };
}

/** Resolves a generic effect amount, optionally using the effect's falloff profile. */
export function amountAtDistance(abilityId, distance, effect = null, statsOverride = null) {
    const baseStats = statsOverride == null ? phaseStatsForAbility(abilityId) : {};
    const stats = { ...baseStats, ...(statsOverride ?? {}) };
    const profile = effect?.falloff && typeof effect.falloff === "object"
        ? effect.falloff : effect == null ? stats.falloff : null;
    if (!hasAmountFalloff(profile)) {
        return roundCombatValue(Number(effect?.amount ?? stats.amount ?? stats.damage ?? 0));
    }

    const maxAmount = Number(profile.maxAmount ?? effect?.amount ?? stats.amount ?? stats.damage ?? 0);
    const minAmount = Number(profile.minAmount ?? maxAmount);
    const falloffStart = Number(profile.falloffStart ?? 0);
    const falloffEnd = Number(profile.falloffEnd ?? falloffStart);
    const range = effectRange(stats, effect, profile);
    return resolveFalloffValue(distance, minAmount, maxAmount,
        falloffStart, falloffEnd, range);
}

/** Resolves a generic effect duration, optionally using distance-based falloff. */
export function durationAtDistance(abilityId, distance, effect, statsOverride = null) {
    const stats = { ...(statsOverride == null ? phaseStatsForAbility(abilityId) : {}), ...(statsOverride ?? {}) };
    const profile = effect?.falloff && typeof effect.falloff === "object"
        ? effect.falloff : null;
    if (!hasDurationFalloff(effect)) {
        return Math.max(0, Number(effect?.durationMs ?? stats.durationMs ?? 0));
    }
    const maxDurationMs = Number(profile.maxDurationMs ?? effect.durationMs ?? stats.durationMs ?? 0);
    const minDurationMs = Number(profile.minDurationMs ?? maxDurationMs);
    const falloffStart = Number(profile.falloffStart ?? 0);
    const falloffEnd = Number(profile.falloffEnd ?? falloffStart);
    const range = effectRange(stats, effect, profile);
    return Math.max(0, Math.round(resolveFalloffValue(distance, minDurationMs,
        maxDurationMs, falloffStart, falloffEnd, range)));
}

function hasAmountFalloff(profile) {
    return Boolean(profile && typeof profile === "object"
        && (profile.minAmount != null || profile.maxAmount != null)
        && profile.falloffStart != null && profile.falloffEnd != null);
}

function hasDurationFalloff(effect) {
    const profile = effect?.falloff;
    return Boolean(profile && typeof profile === "object"
        && (profile.minDurationMs != null || profile.maxDurationMs != null)
        && profile.falloffStart != null && profile.falloffEnd != null);
}

function effectRange(stats, effect, profile) {
    const explicit = Number(effect?.range ?? stats.range ?? stats.radius);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const end = Number(profile?.falloffEnd);
    return Number.isFinite(end) && end > 0 ? end : 0;
}

function phaseStatsForAbility(abilityId) {
    const contract = abilityContract(abilityId);
    return contract ? memoPhaseStats(ABILITY_STATS, contract, () => buildAbilityStats(abilityId)) : buildAbilityStats(abilityId);
}

function buildAbilityStats(abilityId) {
    const verbs = triggerVerbs(abilityId).filter((verb) => verb.effects?.length > 0);
    const direct = verbs.find((verb) => verb.effects.some((effect) => effect?.type === EFFECT_TYPES.DAMAGE))
        ?? verbs[0];
    if (direct) return phaseStatsFor(direct);
    const phases = entityContractForAbility(abilityId)?.phases ?? [];
    const withEffects = phases.map((phase) => ({ phase, effects: phaseEffects(phase) }));
    const entity = withEffects.find(({ effects }) => effects.some((effect) => effect?.type === EFFECT_TYPES.DAMAGE))
        ?? withEffects.find(({ effects }) => effects.length > 0)
        ?? withEffects[0];
    return entity ? phaseStatsFor({ hitbox: entity.phase.hitbox, effects: entity.effects }) : phaseStatsFor(null);
}

function resolveFalloffValue(distance, minValue, maxValue, start, end, range) {
    if (!Number.isFinite(distance) || !Number.isFinite(minValue) || !Number.isFinite(maxValue)
        || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
    const maxRange = Number.isFinite(range) && range > 0 ? range : Math.max(0, end);
    if (maxRange > 0 && distance > maxRange) return 0;

    // A profile cannot extend past the ability's actual range. Clamping the
    // end point means the minimum value is reached at the last valid unit.
    const clampedStart = Math.min(Math.max(0, start), maxRange);
    const clampedEnd = Math.min(Math.max(0, end), maxRange);
    if (clampedEnd > clampedStart && minValue !== maxValue) {
        return roundCombatValue(interpolate(distance, clampedStart, clampedEnd,
            maxValue, minValue));
    }
    return roundCombatValue(maxValue);
}

function sourceSlot(source) {
    const slot = Number(source?.slot ?? source?.ownerSlot);
    return Number.isFinite(slot) ? slot : null;
}

function interpolate(value, min, max, near, far) {
    const t = clamp((value - min) / (max - min), 0, 1);
    return near + (far - near) * t;
}

export function roundCombatValue(value) {
    return Math.round(Number(value) * 1000) / 1000;
}
