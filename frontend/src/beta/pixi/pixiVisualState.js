import { abilityDefinition, VISUAL_INTERPOLATION } from "../loadout/BotLoadout.js";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians } from "../../logic/arenaAngles.js";

const ZONE_TYPES = new Set(["gravityField", "gravityExplosion", "nullZone", "orbitalMarker", "orbitalExplosion", "silenceWave", "temporalRewindZone"]);
const PROJECTILE_TYPES = new Set(["grenade", "fireball"]);
const PROJECTILE_TRAILS = Object.freeze({
    grenade: { color: 0xbef264, length: 30, width: 6 },
    fireball: { color: 0xfb923c, length: 48, width: 10 },
    gravityField: { color: 0xc4b5fd, length: 38, width: 7 },
});

export function isFighterShape(shape) {
    return shape?.id === "main"
        || shape?.type === "opponentModel"
        || (shape?.userId != null && shape?.slot != null);
}

export function fighterColorRole(fighter) {
    return Number(fighter?.slot) === 2 ? "pink" : "blue";
}

export function pixiLayerForShape(shape) {
    if (isFighterShape(shape)) return "fighters";
    if (ZONE_TYPES.has(shape?.type)) return "zones";
    if (PROJECTILE_TYPES.has(shape?.type)) return "projectiles";
    return "entities";
}

export function shapeInterpolationMs(shape) {
    if (abilityDefinition(shape?.abilityId)?.visualInterpolation === VISUAL_INTERPOLATION.NONE) return 0;
    return Math.max(0, Number(shape?.interpolationMs ?? AUTO_STEP_MS));
}

export function projectileTrailStyle(shape) {
    const style = PROJECTILE_TRAILS[shape?.type];
    const speed = Math.hypot(Number(shape?.velocityX ?? 0), Number(shape?.velocityY ?? 0));
    return style && speed > 0.01 ? style : null;
}

export function fighterDashRotation(shape) {
    const microDashing = Number(shape?.microDashActiveMs ?? 0) > 0;
    const dashDirectionX = Number(microDashing ? shape?.microDashDirectionX : shape?.dashDirectionX);
    const dashDirectionY = Number(microDashing ? shape?.microDashDirectionY : shape?.dashDirectionY);
    const hasDashDirection = Math.hypot(dashDirectionX, dashDirectionY) > 0.001;
    const directionX = hasDashDirection ? dashDirectionX : Number(shape?.velocityX);
    const directionY = hasDashDirection ? dashDirectionY : Number(shape?.velocityY);
    return Math.hypot(directionX, directionY) > 0.001
        ? Math.atan2(directionY, directionX)
        : compassDegreesToRadians(shape?.rotation);
}

export function replayProjectileVelocity(shape, previousShape) {
    const derived = {
        velocityX: Number(shape?.x ?? 0) - Number(previousShape?.x ?? shape?.x ?? 0),
        velocityY: Number(shape?.y ?? 0) - Number(previousShape?.y ?? shape?.y ?? 0),
    };
    const hasProvidedVelocity = shape?.velocityX != null && shape?.velocityY != null
        && Number.isFinite(Number(shape.velocityX)) && Number.isFinite(Number(shape.velocityY));
    if (!hasProvidedVelocity) return derived;
    const provided = { velocityX: Number(shape.velocityX), velocityY: Number(shape.velocityY) };
    return Math.hypot(provided.velocityX, provided.velocityY) > 0.01
        || Math.hypot(derived.velocityX, derived.velocityY) <= 0.01
        ? provided : derived;
}

export function fighterStatusLabels(shape) {
    if (shape?.hp != null && Number(shape.hp) <= 0) return [];
    const labels = [];
    if (Number(shape?.abilityActiveMs?.reactive_armor ?? 0) > 0) labels.push("RA");
    if (Number(shape?.abilityActiveMs?.absolute_guard ?? 0) > 0) labels.push("AG");
    if (Number(shape?.burnRemainingMs ?? 0) > 0) labels.push("BURN");
    if (Number(shape?.bleedRemainingMs ?? 0) > 0) labels.push("BLEED");
    if (Number(shape?.slowedMs ?? 0) > 0) labels.push("SLOW");
    if (Number(shape?.silencedMs ?? 0) > 0 || shape?.nullZoneSilenced) labels.push("SIL");
    if (Number(shape?.shockRemainingMs ?? 0) > 0) labels.push("SHOCK");
    if (Number(shape?.stunnedMs ?? 0) > 0) labels.push("STUN");
    return labels;
}

export function activeFighterVisual(shape) {
    if (shape?.hp != null && Number(shape.hp) <= 0) return null;
    const prototypeVisual = Number(shape?.prototypeVisual?.ms ?? 0) > 0 ? shape.prototypeVisual.ability : null;
    if (prototypeVisual === "micro_dash") return null;
    const active = ["heavy_slash", "quick_jab", "thrust", "pistol_shot", "concussive_shot", "rail_shot", "repulsor_burst", "repair_pulse", "phase_strike"]
        .find((id) => Number(shape?.abilityActiveMs?.[id] ?? 0) > 0);
    return prototypeVisual ?? active ?? null;
}

export function entityCaption(shape) {
    if (shape?.type === "hunterDrone") return `${Math.max(0, Math.ceil(Number(shape.hp ?? 50)))} HP`;
    if (shape?.type === "orbitalMarker") return `${(Math.max(0, Number(shape.fuseMs ?? 0)) / 1000).toFixed(1)}s`;
    return "";
}
