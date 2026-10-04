import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, AUTO_STEP_MS } from "../../modelPayloads/arenaConstants.js";
import { ABILITY_STATS } from "../../gameconfig/Abilities.js";
import { entityContractForAbility } from "../../ecs/contracts/AbilityContracts.js";
import { abilityIdFromBoundary } from "../../gameconfig/AbilityCompatibility.js";
import { AIM_MODES, MAX_LEAD_SECONDS } from "../code/configuration/constants.js";

/** Seconds per simulation tick: displacement divided by this is a velocity per second. */
export const AIM_TICK_SECONDS = AUTO_STEP_MS / 1000;

/**
 * The target's velocity in arena units per second, from its last-tick displacement.
 * Bots report displacement directly. Ability entities move by their per-tick velocity.
 * A direction change last tick therefore defeats the prediction by design.
 */
export function targetVelocityPerSecond(target) {
    const displacementX = Number(target?.displacementX);
    const displacementY = Number(target?.displacementY);
    if (Number.isFinite(displacementX) && Number.isFinite(displacementY)) {
        return { x: displacementX / AIM_TICK_SECONDS, y: displacementY / AIM_TICK_SECONDS };
    }
    if (target?.abilityId != null) {
        const x = Number(target.velocityX ?? 0);
        const y = Number(target.velocityY ?? 0);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x: x / AIM_TICK_SECONDS, y: y / AIM_TICK_SECONDS };
    }
    return { x: 0, y: 0 };
}

/** Projectile travel speed in arena units per second; 0 for hitscan, melee and non-projectiles. */
export function projectileSpeedPerSecond(abilityId) {
    const contract = entityContractForAbility(abilityId);
    if (contract?.category !== "projectile") return 0;
    const speedPerTick = Number(contract.phases?.[0]?.movement?.speed ?? 0);
    return Number.isFinite(speedPerTick) && speedPerTick > 0 ? speedPerTick / AIM_TICK_SECONDS : 0;
}

/** Remaining wind-up for `auto`: what is left if it already started, otherwise the full wind-up. */
export function windupRemainingSeconds(player, abilityId) {
    const windupMs = Number(ABILITY_STATS[abilityId]?.windupMs ?? 0);
    const preparing = Number(player?.preparingAbility) === abilityId && Number(player?.preparingMs) > 0;
    return (preparing ? Number(player.preparingMs) : windupMs) / 1000;
}

/** Lead time in seconds for an action block, or 0 for the default `current` aim. */
export function leadSecondsForBlock(block, player, target) {
    if (block?.aim === AIM_MODES.LEAD) {
        const seconds = Number(block.leadSeconds);
        return Number.isFinite(seconds) ? Math.max(0, Math.min(MAX_LEAD_SECONDS, seconds)) : 0;
    }
    if (block?.aim === AIM_MODES.AUTO) {
        const abilityId = abilityIdFromBoundary(block.leadAbilityId);
        if (abilityId == null || !player || !target) return 0;
        const speed = projectileSpeedPerSecond(abilityId);
        const distance = Math.hypot(Number(target.x) - Number(player.x), Number(target.y) - Number(player.y));
        const travel = speed > 0 && Number.isFinite(distance) ? distance / speed : 0;
        return windupRemainingSeconds(player, abilityId) + travel;
    }
    return 0;
}

/**
 * Applies lead aim: target position + target velocity x lead time, clamped to the arena.
 * Returns the original target for `current` aim, so existing brains aim exactly as before.
 */
export function leadAimTarget(target, block, player) {
    if (!target || !block || (block.aim !== AIM_MODES.LEAD && block.aim !== AIM_MODES.AUTO)) return target;
    const seconds = leadSecondsForBlock(block, player, target);
    if (!(seconds > 0)) return target;
    const velocity = targetVelocityPerSecond(target);
    return {
        ...target,
        x: Math.max(0, Math.min(ARENA_WIDTH_UNITS, Number(target.x) + velocity.x * seconds)),
        y: Math.max(0, Math.min(ARENA_HEIGHT_UNITS, Number(target.y) + velocity.y * seconds)),
    };
}
