import {
    entityContractForAbility,
    PHASE_TYPES,
    phaseSpeed,
    activationView,
} from "../ecs/contracts/AbilityContracts.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";

function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/** Distance a projectile travels in its first phase: speed per tick x ticks of lifetime. */
function projectileBaseRange(entity) {
    const phase = entity?.phases?.[0];
    if (phase?.type !== PHASE_TYPES.PROJECTILE) return null;
    const speed = finitePositive(phaseSpeed(phase));
    const durationMs = finitePositive(phase.durationMs ?? entity.lifetime?.duration);
    return speed == null || durationMs == null ? null : speed * (durationMs / AUTO_STEP_MS);
}

/**
 * Base range of an ability in arena units, read from the real contract hitbox:
 * arc -> range, rectangle -> length, ray -> range, projectile -> speed x lifetime ticks.
 * The target radius is not added; this is a base range, not a hit check. Returns
 * null for abilities without a meaningful range.
 */
export function abilityBaseRange(abilityId) {
    const id = abilityIdFromBoundary(abilityId);
    if (id == null) return null;
    const hitbox = activationView(id)?.hitbox;
    switch (hitbox?.shape) {
        case "arc":
        case "ray":
            return finitePositive(hitbox.range);
        case "rectangle":
            return finitePositive(hitbox.length);
        default:
            return projectileBaseRange(entityContractForAbility(id));
    }
}
