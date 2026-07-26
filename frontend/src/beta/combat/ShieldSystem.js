import { BLOCK_MAX_CHARGES } from "./Moves.js";
import { angleDelta } from "./geometry.js";
import { SHIELD_CHARGE_COSTS, SHIELD_MODES } from "./AbilityContracts.js";
import { vectorToCompassDegrees } from "../../logic/arenaAngles.js";

export const BLOCK_REUSE_COOLDOWN_MS = 2000;

export function isShieldBlockingSource(fighter, source, halfArcDegrees = 95) {
    if (Number(fighter?.blockActiveMs ?? 0) <= 0 || Number(fighter?.blockCharges ?? 0) <= 0 || !source) return false;
    const sourceAngle = vectorToCompassDegrees(Number(source.x) - Number(fighter.x), Number(source.y) - Number(fighter.y));
    return Math.abs(angleDelta(Number(fighter.rotation ?? 0), sourceAngle)) <= Number(halfArcDegrees);
}

export function consumeShieldCharges(fighter, charges) {
    const nextCharges = Math.max(0, Number(fighter.blockCharges ?? 0) - Math.max(0, Number(charges ?? 0)));
    const rechargeMs = nextCharges < BLOCK_MAX_CHARGES ? Number(fighter.blockRechargeMs ?? 0) : 0;
    return {
        ...fighter,
        blockCharges: nextCharges,
        blockRechargeMs: rechargeMs,
        blockActiveMs: nextCharges > 0 ? fighter.blockActiveMs : 0,
        blockCooldownMs: nextCharges > 0 ? Number(fighter.blockCooldownMs ?? 0) : Math.max(BLOCK_REUSE_COOLDOWN_MS, Number(fighter.blockCooldownMs ?? 0)),
    };
}

export function blockFromSource(fighter, source, { halfArcDegrees = 95, drainAll = false } = {}) {
    if (!isShieldBlockingSource(fighter, source, halfArcDegrees)) return { fighter, blocked: false };
    return {
        fighter: consumeShieldCharges(fighter, drainAll ? Number(fighter.blockCharges ?? 0) : 1),
        blocked: true,
    };
}

/** Resolves an ability's declarative shield policy without applying its effects. */
export function resolveShieldInteraction(fighter, source, shieldInteraction, { chargeCost } = {}) {
    const policy = shieldInteraction ?? { mode: SHIELD_MODES.IGNORE, prevents: [] };
    if (policy.mode === SHIELD_MODES.IGNORE) return { fighter, blocked: false, preventedEffects: new Set() };
    const shieldActive = Number(fighter?.blockActiveMs ?? 0) > 0 && Number(fighter?.blockCharges ?? 0) > 0;
    if (!shieldActive) return { fighter, blocked: false, preventedEffects: new Set() };
    const directional = policy.mode === SHIELD_MODES.BLOCK
        && isShieldBlockingSource(fighter, source, Number(policy.halfArcDegrees ?? 95));
    if (policy.mode === SHIELD_MODES.BLOCK && !directional) return { fighter, blocked: false, preventedEffects: new Set() };
    const configuredCost = chargeCost ?? policy.chargeCost ?? SHIELD_CHARGE_COSTS.ONE;
    const charges = configuredCost === SHIELD_CHARGE_COSTS.ALL
        ? Number(fighter.blockCharges ?? 0)
        : Math.max(0, Number(configuredCost === SHIELD_CHARGE_COSTS.DISTANCE_SCALED ? 1 : configuredCost));
    return {
        fighter: consumeShieldCharges(fighter, charges),
        blocked: policy.mode === SHIELD_MODES.BLOCK,
        preventedEffects: new Set(policy.prevents ?? []),
    };
}
