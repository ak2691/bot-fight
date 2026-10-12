import {
    abilityContract,
    EFFECT_TYPES,
    effectTargetsTarget,
    entityContractForAbility,
    phaseEffects,
    phaseForEntity,
    targetKindsForEntity,
    TARGET_KINDS,
    activationVerbs,
    DISPLACE_DIRECTION,
    DISPLACE_FROM,
    DISPLACE_WHO,
} from "../contracts/AbilityContracts.js";
import { ignoresHostileEffects, isAliveBot, reactsToBlockedHits, withoutBotStatuses } from "../../gameconfig/DefensiveState.js";
import { clamp, normalizeAngle } from "../../gameconfig/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, BASE_BOT_HP } from "../../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians, vectorToCompassDegrees } from "../../botlogic/planner/arenaAngles.js";
import { interruptCurrentAbility } from "../../gameconfig/AbilityResourceSystem.js";
import { recordAbilityHit } from "../../gameconfig/AbilityHitRecord.js";
import { CLOSING_ZONE_TYPE } from "../../gameconfig/ArenaHazardConfig.js";
import { HIT_STAGGER_DURATION_MS } from "../../gameconfig/HitStagger.js";
import { botRef, entityRef, logCombat, targetRef, withCombatAbility } from "../combatLog.js";
import {
    modifierFor,
    normalizeStatusEffect,
    outgoingDamageMultiplier,
    STATUS_EFFECT_APPLICATIONS,
    statusEffectsFor,
} from "../contracts/StatusContracts.js";
import { HIT_AMOUNT_TOKEN, MODIFIER_STATS, REACTION_TARGETS, STATUS_REACTION_EVENTS } from "../../gameconfig/vocabulary.js";
import { statusPreset } from "../../gameconfig/StatusPresets.js";
import { isEntityShape, ownerBot } from "../entities/EntityCombat.js";
import { areEnemies } from "../contracts/teams.js";
import { effectConditionsHold } from "./effectConditions.js";


/**
 * Whether an effect lands on the enemy bot and so counts as a hit for Time Since Hit: damage, a status, and a displace
 * that moves its target. A displace that moves the owner is a self move, not a hit.
 */
function isEnemyHitEffect(effect) {
    if (effect.type === EFFECT_TYPES.DISPLACE) return effect.who === DISPLACE_WHO.TARGET;
    return effect.type === EFFECT_TYPES.DAMAGE || effect.type === EFFECT_TYPES.STATUS;
}

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
 * from (a bot, an entity, a status or the closing zone). `log: false` keeps the hit out of the combat log (status
 * damage on an entity, which is not an attack).
 */
export function dealDamage(target, amount, source = null, { log = true } = {}) {
    if (isEntityShape(target)) damageEntity(target, amount, source, log);
    else damageBot(target, amount, source);
    return target;
}

function damageBot(bot, damage, source) {
    if ((bot.hp ?? 0) <= 0) return;
    if (ignoresHostileEffects(bot)) return;
    const incomingDamage = modifierFor(bot, MODIFIER_STATS.INCOMING_DAMAGE, source);
    const baseDamage = Math.max(0, Number(damage) || 0);
    let remaining = baseDamage * incomingDamage.multiply;
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
    if (appliedDamage > 0 && hostile) applyStatus(bot, { subtype: "hit-stagger", durationMs: HIT_STAGGER_DURATION_MS });
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
    // A status tick and the closing zone name no slot or team, so they are never hostile (no stagger).
    const namesASide = Number.isFinite(Number(source?.slot ?? source?.ownerSlot))
        || Number.isFinite(Number(source?.teamNumber ?? source?.ownerTeam));
    return namesASide && areEnemies(source, target);
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
    const preset = statusPreset(effect.subtype);
    if (!preset) return target;
    const durationMs = Number(effect.durationMs ?? 0);
    const id = abilityId ?? effect.abilityId;
    const tokens = {
        $amount: hasAmountFalloff(effect.falloff)
            ? amountAtDistance(id, distance, effect, stats)
            : Number(effect.amount ?? 0),
        $damageMultiplier: Math.max(1, isEntityShape(source)
            ? Number(source.damageMultiplier ?? 1)
            : outgoingDamageMultiplier(source)),
        $movementLockMs: Number(effect.movementLockMs ?? 0),
    };
    const presence = preset.presenceWhenInside && Boolean(effect.whileInside);
    const scheduleMs = preset.on?.schedule?.intervalMs;
    const status = {
        type: effect.subtype,
        abilityId: id ?? null,
        mode: preset.presenceWhenInside && presence ? "presence" : "duration",
        remainingMs: presence ? 0 : durationMs,
        tickMs: scheduleMs == null ? 0 : Number(effect.intervalMs ?? scheduleMs),
        tickElapsedMs: 0,
        sourceSlot: preset.carriesSourceSlot ? sourceSlot(source) : null,
        source: preset.presenceWhenInside ? effect.presenceField ?? null : null,
        effects: resolveTokens(preset.effects, tokens),
        on: resolveStatusEvents(preset.on, tokens),
        snapshot: preset.captures ? captureSnapshot(target, preset.captures) : null,
        ...(preset.charges == null ? {} : { charges: Number(preset.charges) }),
    };
    // Only bots carry movement velocity.
    if (preset.clearsVelocity && !isEntityShape(target)) {
        target.movementVelocityX = 0;
        target.movementVelocityY = 0;
        target.velocityX = 0;
        target.velocityY = 0;
    }
    // A preset that interrupts (stun) stops what the target is doing first: a bot's wind-up and active abilities
    // are interrupted (their cooldowns start); a summon's attack timer starts over. Spawned entities keep running.
    if (preset.interrupts) {
        if (isEntityShape(target)) resetEntityExecution(target);
        else interruptCurrentAbility(target);
    }
    upsertStatus(target, status);
    return target;
}

/**
 * Resolves the "$" tokens of a list of effect entries; a null field is left out. "$hitAmount" is set by each attack, so
 * it stays a token here.
 */
function resolveTokens(entries, tokens) {
    return entries.map((entry) => Object.fromEntries(Object.entries(entry)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => [key, typeof value === "string" && value.startsWith("$") && value !== HIT_AMOUNT_TOKEN
            ? tokens[value] : value])));
}

/**
 * A preset's `on` events with their effects resolved, or null when the preset has none. A reaction event keeps its
 * `target`, `consume` and `from` (see runReactions).
 */
function resolveStatusEvents(events, tokens) {
    if (!events) return null;
    return Object.fromEntries(Object.entries(events).map(([name, event]) => [name, {
        ...(event.intervalMs == null ? {} : { intervalMs: Number(event.intervalMs) }),
        ...(event.target == null ? {} : { target: event.target }),
        ...(event.consume == null ? {} : { consume: Number(event.consume) }),
        ...(event.from == null ? {} : { from: [...event.from] }),
        effects: resolveTokens(event.effects ?? [], tokens),
    }]));
}

/** The fields a `captures` preset keeps from its target when it is applied (Rewind keeps x, y and hp). */
function captureSnapshot(target, fields) {
    return Object.fromEntries(fields.map((field) => [field, Number(target[field] ?? 0)]));
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
        // A modifier is one effect per stat (slow has a moveSpeed and a turnSpeed one), so the stat is part of its identity.
        const index = merged.findIndex((effect) => effect.type === incoming.type && effect.mode === incoming.mode
            && effect.stat === incoming.stat);
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
            ...mergeNumericMaximum(current, incoming, "multiply"),
        };
    }
    return merged;
}

function mergeNumericMaximum(current, incoming, field) {
    if (current[field] == null || incoming[field] == null) return {};
    return { [field]: Math.max(Number(current[field]), Number(incoming[field])) };
}

/**
 * Moves a bot or entity, in place, inside the arena. Every displacement goes through here. `move` is either a push or
 * a pull, `{ dx, dy, distance }` (the mover goes `distance` along (dx, dy)), or a mirror, `{ across }` (the mover lands
 * as far past the point `across` as it stood from it, on the line from the mover through that point).
 * `landing` marks a bot's own move, such as a blink: its velocities stop, its movement starts from the new spot, and
 * it turns by its phase facing.
 */
export function displace(target, move, world, { landing = false } = {}) {
    const width = Number(world?.width ?? ARENA_WIDTH_UNITS);
    const height = Number(world?.height ?? ARENA_HEIGHT_UNITS);
    const radius = Number(target.size ?? 0) / 2;
    let x;
    let y;
    if (move.across) {
        // The bearing and distance are the ones the old teleport used, so a mirror lands exactly where it did.
        const acrossX = Number(move.across.x);
        const acrossY = Number(move.across.y);
        const bearing = compassDegreesToRadians(vectorToCompassDegrees(acrossX - target.x, acrossY - target.y));
        const mirrorDistance = Math.hypot(acrossX - target.x, acrossY - target.y);
        x = clamp(acrossX + Math.cos(bearing) * mirrorDistance, radius, width - radius);
        y = clamp(acrossY + Math.sin(bearing) * mirrorDistance, radius, height - radius);
    } else {
        const magnitude = Math.max(0.001, Math.hypot(move.dx, move.dy));
        x = clamp(Number(target.x) + move.dx / magnitude * Number(move.distance || 0), radius, width - radius);
        y = clamp(Number(target.y) + move.dy / magnitude * Number(move.distance || 0), radius, height - radius);
    }
    target.x = x;
    target.y = y;
    if (landing) {
        target.movementStartX = x;
        target.movementStartY = y;
        target.movementVelocityX = 0;
        target.movementVelocityY = 0;
        target.velocityX = 0;
        target.velocityY = 0;
        const phaseFacing = Number(target.triggeredPhaseFacingMode ?? 0);
        target.rotation = normalizeAngle(Number(target.rotation ?? 0) + (Number.isFinite(phaseFacing) ? phaseFacing : 0));
    }
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
 *   distance              source-to-target distance for falloff; computed from positions when omitted
 *   world                 arena size and bots
 *   damageMultiplier      the source's damage multiplier
 *   fromEntity            true when the source is an arena entity (self effects do not apply)
 *   damageConfirmed / damageConfirmedAmount
 *   log                   false keeps an entity's damage out of the combat log (status damage on a summon)
 *   snapshot              the x, y and hp a status captured when applied (restore_state reads it)
 *
 * `apply` changes the owner and the target in place.
 */
export const EFFECTS = Object.freeze({
    [EFFECT_TYPES.DAMAGE]: { apply: applyDamage },
    [EFFECT_TYPES.HEALING]: { self: true, apply: applyHealing },
    [EFFECT_TYPES.STATUS]: { apply: applyStatusEffect },
    [EFFECT_TYPES.REMOVE_STATUS]: { apply: applyRemoveStatus },
    [EFFECT_TYPES.DISPLACE]: { apply: applyDisplace },
    [EFFECT_TYPES.RESTORE_STATE]: { self: true, apply: applyRestoreState },
});

/**
 * Applies a list of effects to one target, in order: the one loop every verb and entity event runs its effects
 * through. `targetKinds` keeps only the effects that name the target's kind. `ctx` is what `applyEffect` takes. Each
 * damage that lands confirms the damage for the effects after it (a `damageConfirmed` check reads it). An effect whose
 * `when` checks fail is skipped and counts as no hit. Returns whether an effect reached a living enemy bot (Time Since
 * Hit), and the confirmed damage.
 */
export function applyEffectList(effects, ctx, { targetKinds = null } = {}) {
    let landedOnEnemy = false;
    let damageConfirmed = ctx.damageConfirmed ?? false;
    let damageConfirmedAmount = ctx.damageConfirmedAmount ?? 0;
    withCombatAbility(ctx.abilityId, () => {
        for (const effect of effects ?? []) {
            if (!effect?.type) continue;
            if (targetKinds && !effectTargetsTarget(effect, targetKinds)) continue;
            const live = { ...ctx, damageConfirmed, damageConfirmedAmount };
            if (!effectConditionsHold(effect, live)) continue;
            if (isEnemyHitEffect(effect) && isAliveBot(ctx.target) && !isEntityShape(ctx.target)) {
                landedOnEnemy = true;
            }
            // A damage by an attack on another bot triggers that bot's hit reactions and its owner's hitDealt ones, right
            // after the damage. The holder's statuses are read just before it (an immune or dying holder still reacts).
            const attacksOther = effect.type === EFFECT_TYPES.DAMAGE && isAttackOnOtherBot(ctx);
            const holderStatuses = attacksOther ? statusEffectsFor(ctx.target) : null;
            const hpBefore = Number(ctx.target?.hp ?? 0);
            const raw = applyEffect(effect, live);
            if (attacksOther) dispatchAttackReactions(ctx, holderStatuses, Number(raw ?? 0));
            if (effect.type === EFFECT_TYPES.DAMAGE) {
                const appliedDamage = Math.max(0, hpBefore - Number(ctx.target?.hp ?? 0));
                if (appliedDamage > 0) {
                    damageConfirmed = true;
                    damageConfirmedAmount = roundCombatValue(damageConfirmedAmount + appliedDamage);
                    // A `when`-gated damage that landed is the hit's bonus (Execute's finisher, Backstab's from-behind hit).
                    if (effect.when?.length) live.onConditionalHit?.();
                }
            }
        }
    });
    return { landedOnEnemy, damageConfirmed, damageConfirmedAmount };
}

/** Whether a damage of this context is an attack by a bot (or an entity's owner) on another bot. */
function isAttackOnOtherBot(ctx) {
    return Boolean(ctx.owner) && !isEntityShape(ctx.target) && ctx.target != null && ctx.owner.id !== ctx.target.id;
}

/**
 * Runs the reactions of one damage by an attack: the holder's `hit` events (the holder is the bot the damage reached),
 * then the attacker's `hitDealt` events, if the attack landed on an enemy. `amount` is the raw damage. A reaction's
 * effects run through runStatusEffects only, so a reaction never starts another reaction.
 */
function dispatchAttackReactions(ctx, holderStatuses, amount) {
    const holder = ctx.target;
    const attacker = ctx.owner;
    runReactions(holder, holderStatuses, STATUS_REACTION_EVENTS.HIT, { amount, attacker, abilityId: ctx.abilityId });
    if (isAliveBot(attacker) && areEnemies(attacker, holder)) {
        runReactions(attacker, statusEffectsFor(attacker), STATUS_REACTION_EVENTS.HIT_DEALT, {
            amount, attacker, abilityId: ctx.abilityId,
        });
    }
}

/**
 * Runs one reaction event of each status in `statuses`, in their order, on `holder`. An event with `from: ["weapon"]`
 * runs only for an attack by a weapon ability. A `consume` event needs its status to be live with a charge left, and
 * spends charges before its effects run. A status with no charges left still applies its effects for the rest of the
 * tick (so every hit landing in the same tick as the spending one meets it too) and ends when the tick settles
 * (`settleSpentStatuses`; its lifetimeEnd does not run).
 */
function runReactions(holder, statuses, eventName, { amount, attacker, abilityId }) {
    const weapon = abilityContract(abilityId)?.weapon === true;
    for (const status of statuses) {
        const event = status.on?.[eventName];
        if (!event) continue;
        if (Array.isArray(event.from) && event.from.includes("weapon") && !weapon) continue;
        if (event.consume) {
            const live = statusEffectsFor(holder).find((candidate) => sameStatus(candidate, status));
            if (!live || Number(live.charges ?? 0) <= 0) continue;
            spendCharges(holder, live, Number(event.consume));
        }
        const target = event.target === REACTION_TARGETS.ATTACKER ? attacker : holder;
        runStatusEffects(holder, status, withHitAmount(event.effects ?? [], amount), { source: holder, target, abilityId });
    }
}

function sameStatus(first, second) {
    return first.type === second.type && first.mode === second.mode;
}

/** Takes `amount` off a live status's charges, down to 0; a spent status ends when the tick settles. */
function spendCharges(holder, status, amount) {
    const remaining = Math.max(0, Number(status.charges ?? 0) - amount);
    holder.statusEffects = statusEffectsFor(holder)
        .map((candidate) => (sameStatus(candidate, status) ? { ...candidate, charges: remaining } : candidate));
}

/** Ends the statuses whose charges ran out this tick. */
export function settleSpentStatuses(holder) {
    const statuses = statusEffectsFor(holder);
    if (!statuses.some((status) => status.charges != null && Number(status.charges) <= 0)) return holder;
    holder.statusEffects = statuses.filter((status) => status.charges == null || Number(status.charges) > 0);
    return holder;
}

/** The effects of a reaction with its `$hitAmount` tokens set to the attack's raw damage. */
function withHitAmount(effects, amount) {
    return effects.map((effect) => ({
        ...effect,
        ...(effect.amount === HIT_AMOUNT_TOKEN ? { amount } : {}),
        ...(effect.multiplier === HIT_AMOUNT_TOKEN ? { multiplier: amount } : {}),
    }));
}

/**
 * Runs the effects of one status event (a schedule, a lifetimeEnd or a reaction) on `holder`, in order. `source` is
 * what the effects come from and `target` what they land on (the holder, unless a reaction names the attacker). Damage
 * confirms the damage for the effects after it. An effect that reads the source's position (a displace from the source,
 * or a distance check) is skipped when the source has none, as when its bot is dead. Status damage on an entity is not
 * an attack and stays out of the combat log.
 */
export function runStatusEffects(holder, status, effects, { source, target = holder, abilityId = status.abilityId }) {
    const entity = isEntityShape(holder);
    const hasSourcePosition = Number.isFinite(Number(source?.x)) && Number.isFinite(Number(source?.y));
    let damageConfirmed = false;
    let damageConfirmedAmount = 0;
    withCombatAbility(abilityId, () => {
        for (const effect of effects) {
            if (needsSourcePosition(effect) && !hasSourcePosition) continue;
            const ctx = {
                abilityId,
                stats: {},
                source,
                owner: null,
                target,
                distance: 0,
                damageMultiplier: Number(effect.multiplier ?? 1),
                snapshot: status.snapshot,
                log: !entity,
                damageConfirmed,
                damageConfirmedAmount,
            };
            if (!effectConditionsHold(effect, ctx)) continue;
            const hpBefore = Number(target.hp ?? 0);
            applyEffect(effect, ctx);
            if (effect.type === EFFECT_TYPES.DAMAGE && hpBefore > Number(target.hp ?? 0)) {
                damageConfirmed = true;
                damageConfirmedAmount = roundCombatValue(damageConfirmedAmount + hpBefore - Number(target.hp ?? 0));
            }
        }
    });
}

/** Whether an effect reads where its source is: a displace from the source, or a `when` distance check. */
function needsSourcePosition(effect) {
    return (effect.type === EFFECT_TYPES.DISPLACE && effect.from === DISPLACE_FROM.SOURCE)
        || (effect.when ?? []).some((check) => check.measure === "distance");
}

/** Applies one effect through the registry. Returns what the effect's apply step returns (a damage's raw amount). */
export function applyEffect(effect, ctx) {
    const entry = EFFECTS[effect?.type];
    if (!entry || entry.self && ctx.fromEntity) return undefined;
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
    return entry.apply({
        ...ctx,
        stats,
        distance,
        damageSource,
        effect: resolved,
        world: ctx.world ?? {},
        damageMultiplier: ctx.damageMultiplier ?? 1,
    });
}

/** A damage effect hurts its target and returns the raw amount it dealt (before the target's modifiers). */
function applyDamage(ctx) {
    const { effect, abilityId, stats, distance, owner, target, damageSource } = ctx;
    if (!target) return undefined;
    const amount = amountAtDistance(abilityId, distance, effect, stats) * ctx.damageMultiplier;
    if (isEntityShape(target)) {
        dealDamage(target, amount, damageSource, { log: ctx.log });
    } else {
        // An attack by another bot is attributed to the attack's source; a bot's own effect to its owner.
        dealDamage(target, amount, owner && owner.id !== target.id ? damageSource : owner ?? damageSource);
    }
    return amount;
}

function applyHealing(ctx) {
    const { effect, abilityId, stats, distance, owner, target, damageSource } = ctx;
    const toTarget = ["target", "defender"].includes(effect.recipient);
    const recipient = toTarget ? target : owner;
    if (!recipient) return;
    const healingAmount = effect.mirrorsDamage
        ? ctx.damageConfirmedAmount
        : amountAtDistance(abilityId, distance, effect, stats);
    heal(recipient, healingAmount, damageSource);
}

function applyStatusEffect(ctx) {
    const { effect, abilityId, stats, distance, target, damageSource } = ctx;
    const entityTarget = isEntityShape(target);
    if (!target || !entityTarget && !isAliveBot(target)) return;
    const durationMs = durationAtDistance(abilityId, distance, effect, stats);
    const preset = statusPreset(effect.subtype);
    if (!preset) return;
    const presence = preset.presenceWhenInside && Boolean(effect.whileInside);
    // A timed status that is already over lands nothing on an entity.
    if (entityTarget && durationMs <= 0 && !presence) return;
    applyStatus(target, { ...effect, durationMs }, { stats, source: damageSource, abilityId, distance });
    if (entityTarget && preset.effects.some(isExecutionBlocker)) resetEntityExecution(target);
}

/**
 * A removeStatus effect: takes the status named by its `subtype` off the target, in every mode. It is a cleanse, not
 * an expiry, so the status's lifetimeEnd event does not run.
 */
function applyRemoveStatus({ effect, target }) {
    if (!target) return;
    const current = statusEffectsFor(target);
    const kept = current.filter((status) => status.type !== effect.subtype);
    if (kept.length < current.length) target.statusEffects = kept;
}

/**
 * A displace effect: moves its `who` relative to its `from`. `away` pushes the mover from that point, `toward` pulls
 * it to the point, and `mirror` lands it past the point. The distance (a falloff reads it too) is the effect's
 * `distance`. A displace of the owner is a self move: it is skipped for an entity source, as other self effects are.
 */
function applyDisplace(ctx) {
    const { effect, abilityId, stats, distance, owner, target, damageSource, world } = ctx;
    const ownerMoves = effect.who === DISPLACE_WHO.OWNER;
    if (ownerMoves && ctx.fromEntity) return;
    const mover = ownerMoves ? owner : target;
    if (!mover) return;
    const anchor = effect.from === DISPLACE_FROM.TARGET ? target
        : effect.from === DISPLACE_FROM.OWNER ? owner ?? damageSource
            : damageSource;
    const mirror = effect.direction === DISPLACE_DIRECTION.MIRROR;
    // A mirror's distance is the mover's distance from the point it lands past; a push or pull reads the effect's distance.
    const amount = mirror
        ? Math.hypot(Number(anchor.x) - Number(mover.x), Number(anchor.y) - Number(mover.y))
        : amountAtDistance(abilityId, distance, { ...effect, amount: effect.distance }, stats);
    logCombat("effect", { source: botRef(damageSource), target: targetRefOf(mover), effect: "displace", amount });
    const landing = { landing: ownerMoves };
    if (mirror) {
        displace(mover, { across: anchor }, world, landing);
    } else if (effect.direction === DISPLACE_DIRECTION.TOWARD) {
        const dx = Number(anchor.x) - Number(mover.x);
        const dy = Number(anchor.y) - Number(mover.y);
        if (Math.hypot(dx, dy) <= 0.001) return;
        displace(mover, { dx, dy, distance: amount }, world, landing);
    } else {
        const dx = Number(mover.x) - Number(anchor.x);
        const dy = Number(mover.y) - Number(anchor.y);
        displace(mover, { dx, dy, distance: amount }, world, landing);
    }
}

/** The presentation pulse after a rewind snaps back. It is a bot field only so the renderer can read it. */
const REWIND_PULSE_MS = 400;

/**
 * Rewind's snap-back, run by the rewind status's lifetimeEnd event on the bot that holds it: the bot returns to the
 * x, y and hp it had when the status was applied (hp capped at its maximum).
 */
function applyRestoreState({ target, snapshot }) {
    if (!target || !snapshot) return;
    const distance = Math.hypot(snapshot.x - target.x, snapshot.y - target.y);
    logCombat("effect", { source: botRef(target), target: botRef(target), effect: "restore_state", amount: roundCombatValue(distance) });
    target.x = snapshot.x;
    target.y = snapshot.y;
    target.movementStartX = snapshot.x;
    target.movementStartY = snapshot.y;
    target.movementVelocityX = 0;
    target.movementVelocityY = 0;
    target.velocityX = 0;
    target.velocityY = 0;
    target.hp = Math.min(Number(target.maxHp ?? Number.POSITIVE_INFINITY), snapshot.hp);
    target.rewindPulseMs = REWIND_PULSE_MS;
}

function targetRefOf(target) {
    return isEntityShape(target) ? entityRef(target) : botRef(target);
}

/** A status effect that stops a summon from executing its timer: a stun, or a block on abilities. */
function isExecutionBlocker(entry) {
    return entry.type === STATUS_EFFECT_APPLICATIONS.STUN
        || entry.type === STATUS_EFFECT_APPLICATIONS.BLOCK && entry.actions?.includes("ability");
}

/** A silenced or stunned summon starts its attack timer over. */
function resetEntityExecution(entity) {
    const intervalMs = Number(phaseForEntity(entity)?.execution?.intervalMs ?? 1000);
    entity.intervalTimerMs = Math.max(1, intervalMs);
}

/**
 * Applies the effects of one verb to one bot of `bots`, in place: an entity's collision or hit on a bot. `options.effects`
 * lists them; `options` also carries the arena (world), and may fix the collision distance.
 */
export function applyEffectsFromEntity(bots, targetIndex, source, abilityId, options = {}) {
    const target = bots[targetIndex];
    if (!target) return;
    withCombatAbility(abilityId, () => applyEffectsToBot(target, {
        source,
        owner: ownerBot(bots, source),
        abilityId,
        effects: options.effects,
        stats: options.stats,
        distance: options.collisionDistance,
        world: options.world,
        damageMultiplier: Number(source.damageMultiplier ?? 1),
        onConditionalHit: options.onConditionalHit,
    }));
}

/**
 * The one apply of a hit's effects to a bot, from a bot or an entity source, in place. An immune bot takes only the
 * damage, and only when it holds a hit reaction (see reactsToBlockedHits), so a parry sees the hit and the immunity
 * blocks the damage. A landed hit on an enemy counts for Time Since Hit and the hit refund. Returns whether the hit
 * landed: false for an immune bot, which is not a landed hit.
 */
export function applyEffectsToBot(target, {
    source,
    owner,
    abilityId,
    effects = null,
    stats = null,
    distance = undefined,
    world = null,
    damageMultiplier = 1,
    onConditionalHit = null,
}) {
    const immune = ignoresHostileEffects(target);
    if (immune && !reactsToBlockedHits(target)) return false;
    const listed = immune ? (effects ?? []).filter((effect) => effect.type === EFFECT_TYPES.DAMAGE) : effects;
    const { landedOnEnemy } = applyEffectList(listed, {
        abilityId,
        stats,
        source,
        owner,
        target,
        distance,
        world,
        damageMultiplier,
        fromEntity: isEntityShape(source),
        onConditionalHit,
    }, { targetKinds: [TARGET_KINDS.BOT] });
    if (landedOnEnemy && !immune) recordLandedHit(owner, source, target, abilityId);
    return !immune;
}

/**
 * Applies the effects of a verb to one HP entity or summon, in place. `impact` carries the source (a bot or an
 * entity), its ability, the verb's `effects`, the distance, the stats and the damage multiplier.
 */
export function applyEffectsToEntity(target, impact, world) {
    const { source, abilityId, effects } = impact;
    applyEffectList(effects, {
        abilityId,
        stats: impact.stats,
        source,
        owner: null,
        target,
        distance: impact.distance,
        world,
        damageMultiplier: impact.damageMultiplier,
        fromEntity: true,
    }, { targetKinds: targetKindsForEntity(target) });
}

/**
 * Attributes a landed hit on an enemy bot to the source's owner and ability. Allies never count. An entity's hit refunds
 * the activation that spawned it, not the owner's latest one; a bot's hit refunds its own current activation.
 */
function recordLandedHit(owner, source, target, abilityId) {
    if (!owner || owner.id === target.id || !areEnemies(owner, target)) return;
    const activationSerial = isEntityShape(source)
        ? owner.entityActivations?.[source.id] ?? owner.activationSerial ?? 0
        : undefined;
    recordAbilityHit(owner, abilityId, activationSerial);
}

/** The phase numbers an entity's effects read for falloff: its hitbox reach. */
export function entityEffectStats(phase) {
    return memoPhaseStats(ENTITY_STATS, phase, () => {
        const hitbox = phase?.hitbox;
        const reach = hitbox?.range ?? hitbox?.length ?? hitbox?.radius;
        return {
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

/** The numbers an activation verb's effects read for falloff: its hitbox reach and its damage. */
export function phaseStatsFor(phase) {
    return memoPhaseStats(TRIGGER_STATS, phase, () => buildPhaseStats(phase));
}

function buildPhaseStats(phase) {
    const hitbox = phase?.hitbox ?? {};
    const damageEffect = phase?.effects?.find(isBaseDamage);
    return {
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

/** A damage effect that is the ability's own damage: a conditional bonus (one with `when`) is not. */
function isBaseDamage(effect) {
    return effect?.type === EFFECT_TYPES.DAMAGE && !effect.when;
}

function buildAbilityStats(abilityId) {
    const verbs = activationVerbs(abilityId).filter((verb) => verb.effects?.length > 0);
    const direct = verbs.find((verb) => verb.effects.some(isBaseDamage))
        ?? verbs[0];
    if (direct) return phaseStatsFor(direct);
    const phases = entityContractForAbility(abilityId)?.phases ?? [];
    const withEffects = phases.map((phase) => ({ phase, effects: phaseEffects(phase) }));
    const entity = withEffects.find(({ effects }) => effects.some(isBaseDamage))
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
