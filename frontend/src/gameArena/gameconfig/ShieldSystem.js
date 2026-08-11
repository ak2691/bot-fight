import { ABILITY_STATS } from "./Abilities.js";
import { angleDelta } from "./geometry.js";
import { SHIELD_CHARGE_COSTS, SHIELD_MODES } from "./AbilityContracts.js";
import { vectorToCompassDegrees } from "../botlogic/planner/arenaAngles.js";

export function isShieldBlockingSource(bot, source, halfArcDegrees = 95) {
    if (Number(bot?.abilityActiveMs?.[2] ?? 0) <= 0 || Number(bot?.blockCharges ?? 0) <= 0 || !source) return false;
    const sourceAngle = vectorToCompassDegrees(Number(source.x) - Number(bot.x), Number(source.y) - Number(bot.y));
    return Math.abs(angleDelta(Number(bot.rotation ?? 0), sourceAngle)) <= Number(halfArcDegrees);
}

export function consumeShieldCharges(bot, charges) {
    const nextCharges = Math.max(0, Number(bot.blockCharges ?? 0) - Math.max(0, Number(charges ?? 0)));
    const rechargeMs = nextCharges < ABILITY_STATS[2].maxCharges ? Number(bot.blockRechargeMs ?? 0) : 0;
    return {
        ...bot,
        blockCharges: nextCharges,
        blockRechargeMs: rechargeMs,
        abilityActiveMs: nextCharges > 0 ? { ...(bot.abilityActiveMs ?? {}) } : { ...(bot.abilityActiveMs ?? {}), [2]: 0 },
        blockCooldownMs: nextCharges > 0 ? Number(bot.blockCooldownMs ?? 0) : Math.max(Number(ABILITY_STATS[2].reuseCooldownMs ?? 2000), Number(bot.blockCooldownMs ?? 0)),
    };
}

export function blockFromSource(bot, source, { halfArcDegrees = 95, drainAll = false } = {}) {
    if (!isShieldBlockingSource(bot, source, halfArcDegrees)) return { bot, blocked: false };
    return {
        bot: consumeShieldCharges(bot, drainAll ? Number(bot.blockCharges ?? 0) : 1),
        blocked: true,
    };
}

/** Resolves an ability's declarative shield policy without applying its effects. */
export function resolveShieldInteraction(bot, source, shieldInteraction, { chargeCost } = {}) {
    const policy = shieldInteraction ?? { mode: SHIELD_MODES.IGNORE, prevents: [] };
    if (policy.mode === SHIELD_MODES.IGNORE) return { bot, blocked: false, preventedEffects: new Set() };
    const shieldActive = Number(bot?.abilityActiveMs?.[2] ?? 0) > 0 && Number(bot?.blockCharges ?? 0) > 0;
    if (!shieldActive) return { bot, blocked: false, preventedEffects: new Set() };
    const directional = policy.mode === SHIELD_MODES.BLOCK
        && isShieldBlockingSource(bot, source, Number(policy.halfArcDegrees ?? 95));
    if (policy.mode === SHIELD_MODES.BLOCK && !directional) return { bot, blocked: false, preventedEffects: new Set() };
    const configuredCost = chargeCost ?? policy.chargeCost ?? SHIELD_CHARGE_COSTS.ONE;
    const charges = configuredCost === SHIELD_CHARGE_COSTS.ALL
        ? Number(bot.blockCharges ?? 0)
        : Math.max(0, Number(configuredCost === SHIELD_CHARGE_COSTS.DISTANCE_SCALED ? 1 : configuredCost));
    return {
        bot: consumeShieldCharges(bot, charges),
        blocked: policy.mode === SHIELD_MODES.BLOCK,
        preventedEffects: new Set(policy.prevents ?? []),
    };
}
