import { abilityDefinition, VISUAL_INTERPOLATION } from "../loadout/BotLoadout.js";
import { abilityId } from "../gameconfig/AbilityRegistry.js";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { CLOSING_ZONE_TYPE } from "../gameconfig/ArenaHazardConfig.js";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";
import { compassDegreesToRadians } from "../botlogic/planner/arenaAngles.js";
import { statusIsActive } from "../ecs/contracts/StatusContracts.js";
import { entityContract, phaseForEntity } from "../ecs/contracts/EntityContracts.js";

const ZONE_TYPES = new Set([CLOSING_ZONE_TYPE, "grenadeExplosion", "mineExplosion", "gravityZone", "gravityExplosion", "nullZone", "orbitalMarker", "orbitalExplosion", "silenceWave", "temporalRewindZone", "singularityZone", "singularityExplosion", "staticSnareBurst"]);
const PROJECTILE_TYPES = new Set(["grenade", "fireball", "windburstProjectile"]);
// These names only occur in replay payloads written before phase visuals were
// authoritative. Keep their timer fallback so historical replays remain
// renderable; new payloads use phaseId and the normal renderer contract.
const LEGACY_REPLAY_PHASE_VISUAL_TYPES = new Set([
    "grenadeExplosion",
    "mineExplosion",
    "gravityExplosion",
    "orbitalExplosion",
    "singularityExplosion",
    "staticSnareBurst",
]);
// Authoritative replay entities expose the remaining lifetime as timerMs.
// Impact phases carry a visibleMs timer in the training arena, so normalize
// the replay timer back into that same renderer-facing field.
const PROJECTILE_TRAILS = Object.freeze({
    fireball: { color: 0xfb923c, length: 48, width: 10 },
    gravityZone: { color: 0xc4b5fd, length: 38, width: 7 },
});

export const ENTITY_PRESENTATION_DEFINITIONS = Object.freeze({
    hunterDrone: { texturePath: ["drone"], animation: "static" },
    // Keep previously recorded repeller replays on the shared drone art.
    repellerDrone: { texturePath: ["drone"], animation: "static" },
    windburstProjectile: { texturePath: ["windburst"], animation: "time", frameMs: 65 },
    fireball: { texturePath: ["fireball"], animation: "time", frameMs: 65 },
    grenadeExplosion: { texturePath: ["grenadeMineExplosion"], animation: "progress", durationMs: 200, remaining: "visible" },
    mineExplosion: { texturePath: ["grenadeMineExplosion"], animation: "progress", durationMs: 300, remaining: "visible" },
    gravityExplosion: { texturePath: ["grenadeMineExplosion"], animation: "progress", durationMs: 300, remaining: "visible" },
    gravityZone: { texturePath: ["gravityGrenade"], animation: "time", frameMs: 65 },
    silenceWave: { texturePath: ["silencePulse"], animation: "time", frameMs: 80 },
    nullZone: { texturePath: ["nullZone"], animation: "time", frameMs: 100 },
    temporalRewindZone: { texturePath: ["temporalRewind"], animation: "progress", durationMs: 3100, remaining: "remaining" },
    orbitalMarker: { texturePath: ["orbitalMarker"], animation: "static" },
    orbitalExplosion: { texturePath: ["orbitalExplosion"], animation: "progress", durationMs: 400, remaining: "orbital" },
});

export const LOCK_ON_PRESENTATION = Object.freeze({
    texturePath: ["lockOnCrosshair"],
    animation: "target",
    markerSize: ABILITY_STATS[20]?.visualSize ?? 48,
});

/** Resolves presentation metadata from the entity's current phase. */
export function visualForShape(shape) {
    const contract = entityContract(shape?.entityContractId ?? shape?.abilityId ?? shape?.type);
    if (!contract) return null;

    if (shape?.visualEventType && Number(shape.visualEventMs ?? 0) > 0) {
        const visualSize = Number(shape.visualEventSize ?? shape.size ?? 0);
        return {
            type: shape.visualEventType,
            ...(visualSize > 0 ? { visualSize } : {}),
            ...(shape.visualEventMs > 0 ? { visibleMs: shape.visualEventMs } : {}),
        };
    }

    const phaseVisual = phaseForEntity(shape)?.visual;
    if (phaseVisual) return phaseVisual;
    return contract.visual ?? null;
}

/** Returns the asset/presentation type selected by the entity's phase metadata. */
export function presentationTypeForShape(shape) {
    return visualForShape(shape)?.type ?? shape?.type;
}

export const BOT_PRESENTATION_DEFINITIONS = Object.freeze({
    20: LOCK_ON_PRESENTATION,
    7: { texturePath: ["heavySlash"], animation: "progress" }, 8: { texturePath: ["repulsorBlast"], animation: "presentationClock" },
    3: { texturePath: ["rays", "gun"], animation: "alpha" }, 12: { texturePath: ["rays", "pistol"], animation: "alpha" },
    9: { texturePath: ["rays", "concussive_shot"], animation: "alpha" },
    13: { texturePath: ["rays", "rail_shot"], animation: "alpha" }, 25: { texturePath: ["phaseStrike"], animation: "progress" },
    16: { texturePath: ["shield"], animation: "progress" }, 23: { texturePath: ["shield"], animation: "progress" },
    10: { texturePath: ["basicHeal"], animation: "particles" },
    18: { texturePath: ["windburst"], animation: "entity" },
});

// The red Heavy Slash row is authored 90 degrees away from the arena-facing
// basis used by Pixi. Keep this correction in presentation math only.
export const HEAVY_SLASH_ART_ROTATION_OFFSET = Math.PI / 2;

export function heavySlashRotation(compassFacingDegrees, sweepDegrees = 0) {
    return compassDegreesToRadians(compassFacingDegrees)
        + HEAVY_SLASH_ART_ROTATION_OFFSET
        + Number(sweepDegrees ?? 0) * Math.PI / 180;
}

export function isBotShape(shape) {
    return shape?.id === "main"
        || shape?.type === "bot"
        || shape?.type === "opponentModel"
        || (shape?.userId != null && shape?.slot != null);
}

export function botColorRole(bot) {
    const teamNumber = Number(bot?.teamNumber);
    if (Number.isFinite(teamNumber) && teamNumber > 0) {
        return teamNumber === 2 ? "red" : "blue";
    }
    return Number(bot?.slot) === 2 ? "red" : "blue";
}

export function botSpritesOverlap(left, right, leftPosition = left, rightPosition = right) {
    if (!left || !right || left === right) return false;
    const leftRadius = Math.max(0, Number(left.size ?? 60)) / 2;
    const rightRadius = Math.max(0, Number(right.size ?? 60)) / 2;
    const dx = Number(leftPosition?.x ?? left.x ?? 0) - Number(rightPosition?.x ?? right.x ?? 0);
    const dy = Number(leftPosition?.y ?? left.y ?? 0) - Number(rightPosition?.y ?? right.y ?? 0);
    return dx * dx + dy * dy < (leftRadius + rightRadius) ** 2;
}

export function botInteriorAlpha(bot, overlapping = false) {
    const base = Number(bot?.hp ?? 0) <= 0
        ? 0.45
        : statusIsActive(bot, "slow") ? 0.7 : 1;
    return overlapping ? base * 0.55 : base;
}

export function closingZoneDamageOccurred(shape, previousShape) {
    return Number(shape?.closingZoneDamageCount ?? 0)
        > Number(previousShape?.closingZoneDamageCount ?? 0);
}

export function pixiLayerForShape(shape) {
    if (isBotShape(shape)) return "bots";
    const presentationType = presentationTypeForShape(shape);
    if (ZONE_TYPES.has(presentationType)) return "zones";
    if (PROJECTILE_TYPES.has(presentationType)) return "projectiles";
    if (ZONE_TYPES.has(shape?.type)) return "zones";
    if (PROJECTILE_TYPES.has(shape?.type)) return "projectiles";
    return "entities";
}

export function presentationDefinitionForShape(shape) {
    if (isBotShape(shape)) return { kind: "bot", layer: "bots", texturePath: ["bot"], animation: "static" };
    if (shape?.type === CLOSING_ZONE_TYPE) return { kind: "arenaHazard", layer: "zones", animation: "geometry" };
    if (["singularityZone", "singularityExplosion"].includes(shape?.type)) {
        return { kind: "generated", layer: "zones", fallback: "graphics" };
    }
    if (["tetherBolt", "staticSnare", "staticSnareBurst"].includes(shape?.type)) {
        return {
            kind: "generated",
            layer: shape.type === "staticSnareBurst" ? "zones" : shape.type === "tetherBolt" ? "projectiles" : "entities",
            fallback: "graphics",
        };
    }
    const presentationType = presentationTypeForShape(shape);
    if (presentationType === "grenade") {
        const state = visualForShape(shape)?.state ?? grenadeVisualState(shape);
        return {
            kind: "entity",
            layer: "projectiles",
            texturePath: ["grenade", state],
            animation: state === "detonate" ? "progress" : "time",
            frameMs: state === "detonate" ? null : 90,
            durationMs: state === "detonate" ? AUTO_STEP_MS * 2 : null,
            remaining: state === "detonate" ? "grenadeDetonate" : null,
        };
    }
    if (presentationType === "proximityMine") {
        const state = visualForShape(shape)?.state ?? (shape.armed ? "static" : "moving");
        return { kind: "entity", layer: "projectiles", texturePath: ["mine", state], animation: "time", frameMs: 90 };
    }
    const definition = ENTITY_PRESENTATION_DEFINITIONS[presentationType];
    return definition
        ? { kind: "entity", layer: pixiLayerForShape(shape), ...definition }
        : { kind: "fallback", fallback: "hidden" };
}

/**
 * Describes a visual instance without treating its timer as gameplay state.
 * The Pixi view consumes this once when a phase/event begins, then advances
 * the animation from its own presentation clock.
 */
export function visualAnimationDescriptorForShape(shape) {
    const visual = visualForShape(shape);
    const presentation = presentationDefinitionForShape(shape);
    if (!visual && presentation.fallback === "hidden") return null;

    const type = visual?.type ?? presentationTypeForShape(shape);
    const state = visual?.state ?? "";
    const size = Number(visual?.visualSize ?? shape?.size ?? 0);
    const eventMs = Number(shape?.visualEventMs ?? 0);
    const eventActive = Boolean(shape?.visualEventType) && eventMs > 0;
    const legacyVisual = !visual && LEGACY_REPLAY_PHASE_VISUAL_TYPES.has(type);
    const configuredVisibleMs = eventActive
        ? Number(presentation.durationMs ?? visual?.visibleMs ?? eventMs)
        : Number(visual?.visibleMs
            ?? (legacyVisual
                ? shape?.visibleMs ?? shape?.timerMs ?? presentation.durationMs
                : 0));
    const durationMs = Number.isFinite(configuredVisibleMs) && configuredVisibleMs > 0
        ? configuredVisibleMs
        : 0;
    const remainingMs = eventActive
        ? eventMs
        : shape?.visibleMs != null && Number.isFinite(Number(shape.visibleMs))
            ? Math.max(0, Number(shape.visibleMs))
            : durationMs > 0 ? durationMs : null;
    const eventSequence = shape?.visualEvent == null ? "" : `:${shape.visualEvent}`;
    const phase = shape?.phaseId == null ? "" : `:${shape.phaseId}`;
    const key = `${eventActive ? "event" : "phase"}${eventSequence}${phase}:${type}:${state}:${size}`;
    return { key, durationMs, remainingMs, eventActive };
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

export function grenadeVisualState(shape, stepMs = AUTO_STEP_MS) {
    const speed = Math.hypot(Number(shape?.velocityX ?? 0), Number(shape?.velocityY ?? 0));
    if (speed > 0.01) return "moving";
    const detonateLeadMs = Math.max(0, Number(stepMs) || AUTO_STEP_MS) * 2;
    return Number(shape?.stoppedMs ?? 0) >= ABILITY_STATS[4].fuseMs - detonateLeadMs ? "detonate" : "static";
}

export function grenadeDetonateProgress(shape, stepMs = AUTO_STEP_MS) {
    const detonateLeadMs = Math.max(0, Number(stepMs) || AUTO_STEP_MS) * 2;
    const detonateStartMs = Math.max(0, ABILITY_STATS[4].fuseMs - detonateLeadMs);
    return Math.min(1, Math.max(0, (Number(shape?.stoppedMs ?? 0) - detonateStartMs) / detonateLeadMs));
}

export function botMovementRotation(shape) {
    const directionX = Number(shape?.dashDirectionX ?? shape?.velocityX);
    const directionY = Number(shape?.dashDirectionY ?? shape?.velocityY);
    return Math.hypot(directionX, directionY) > 0.001
        ? Math.atan2(directionY, directionX)
        : compassDegreesToRadians(shape?.rotation);
}

export function replayProjectileVelocity(shape, previousShape, nextShape) {
    const previousVelocity = {
        velocityX: Number(shape?.x ?? 0) - Number(previousShape?.x ?? shape?.x ?? 0),
        velocityY: Number(shape?.y ?? 0) - Number(previousShape?.y ?? shape?.y ?? 0),
    };
    const nextVelocity = {
        velocityX: Number(nextShape?.x ?? shape?.x ?? 0) - Number(shape?.x ?? 0),
        velocityY: Number(nextShape?.y ?? shape?.y ?? 0) - Number(shape?.y ?? 0),
    };
    const hasProvidedVelocity = shape?.velocityX != null && shape?.velocityY != null
        && Number.isFinite(Number(shape.velocityX)) && Number.isFinite(Number(shape.velocityY));
    if (!hasProvidedVelocity) {
        return Math.hypot(previousVelocity.velocityX, previousVelocity.velocityY) > 0.01
            ? previousVelocity
            : nextVelocity;
    }
    const provided = { velocityX: Number(shape.velocityX), velocityY: Number(shape.velocityY) };
    if (Math.hypot(provided.velocityX, provided.velocityY) > 0.01) return provided;
    if (Math.hypot(previousVelocity.velocityX, previousVelocity.velocityY) > 0.01) return previousVelocity;
    if (Math.hypot(nextVelocity.velocityX, nextVelocity.velocityY) > 0.01) return nextVelocity;
    return provided;
}

/**
 * Converts an authoritative replay obstacle into the same shape contract used
 * by the building/testing arena. This is data normalization only; texture,
 * frame, layer, transform, and timer presentation remain centralized below.
 */
export function normalizeReplayObstacleShape(obstacle, previousObstacle, {
    interpolationMs = AUTO_STEP_MS,
    hitFlashMs = 0,
    hitParticleEvent = null,
    replayFrameIndex = null,
    replayPhase = null,
    nextObstacle = null,
} = {}) {
    const normalizedAbilityId = obstacle?.abilityId == null ? null : abilityId(Number(obstacle.abilityId));
    const phaseLocked = obstacle?.phaseId == null
        ? obstacle?.phaseLocked
        : true;
    const phaseShape = {
        ...obstacle,
        ...(normalizedAbilityId == null ? {} : { abilityId: normalizedAbilityId }),
        ...(phaseLocked == null ? {} : { phaseLocked }),
    };
    const velocity = obstacle?.type === "grenade"
        ? { velocityX: Number(obstacle.velocityX ?? 0), velocityY: Number(obstacle.velocityY ?? 0) }
        : replayProjectileVelocity(obstacle, previousObstacle, nextObstacle);
    const phaseVisual = visualForShape(phaseShape);
    const visualEventMs = Number(obstacle?.visualEventMs);
    const replayVisibleMs = Number.isFinite(visualEventMs) && visualEventMs > 0
        ? visualEventMs
        : obstacle?.visibleMs != null
            ? Math.max(0, Number(obstacle.visibleMs))
            : Number.isFinite(Number(phaseVisual?.visibleMs)) && Number(phaseVisual.visibleMs) > 0
                ? Number(phaseVisual.visibleMs)
                : LEGACY_REPLAY_PHASE_VISUAL_TYPES.has(obstacle?.type)
                    ? Math.max(0, Number(obstacle?.timerMs ?? 0))
                : null;
    return {
        ...obstacle,
        ...(normalizedAbilityId == null ? {} : { abilityId: normalizedAbilityId }),
        ...velocity,
        ...(phaseLocked == null ? {} : { phaseLocked }),
        size: obstacle?.size ?? 60,
        rotation: obstacle?.rotation ?? 0,
        stoppedMs: obstacle?.type === "grenade" ? Number(obstacle.timerMs ?? 0) : undefined,
        armed: obstacle?.armed,
        fuseMs: obstacle?.timerMs,
        remainingMs: obstacle?.timerMs,
        ...(replayVisibleMs == null ? {} : { visibleMs: replayVisibleMs }),
        captureBySlot: { 1: obstacle?.slotOneCaptureMs ?? 0, 2: obstacle?.slotTwoCaptureMs ?? 0 },
        ...(obstacle?.type === CLOSING_ZONE_TYPE
            ? {
                safeRadius: Number(obstacle.safeRadius ?? Number(obstacle.size ?? 0) / 2),
                visibility: "renderer-only",
            }
            : {}),
        locked: true,
        interpolationMs: obstacle?.type === CLOSING_ZONE_TYPE ? 0 : interpolationMs,
        hitFlashMs,
        hitParticleEvent,
        replayFrameIndex,
        replayPhase,
    };
}

export function botStatusLabels(shape) {
    if (shape?.hp != null && Number(shape.hp) <= 0) return [];
    const labels = [];
    if (statusIsActive(shape, "reactive-armor")) labels.push("RA");
    if (statusIsActive(shape, "absolute-guard")) labels.push("AG");
    if (statusIsActive(shape, "burn")) labels.push("BURN");
    if (statusIsActive(shape, "bleed")) labels.push("BLEED");
    if (statusIsActive(shape, "slow")) labels.push("SLOW");
    if (statusIsActive(shape, "silence")) labels.push("SIL");
    if (statusIsActive(shape, "shock")) labels.push("SHOCK");
    if (statusIsActive(shape, "stun")) labels.push("STUN");
    if (statusIsActive(shape, "overclock")) labels.push("OVERCLOCK");
    return labels;
}

export function activeBotVisual(shape) {
    if (shape?.hp != null && Number(shape.hp) <= 0) return null;
    const abilityVisual = Number(shape?.abilityVisual?.ms ?? 0) > 0 ? shape.abilityVisual.ability : null;
    if (abilityVisual === 19) return null;
    const active = [1, 3, 5, 6, 20, 7, 18, 12, 9, 13, 8, 10, 16, 23, 25, 26, 30, 32, 33, 34]
        .find((id) => Number(shape?.abilityActiveMs?.[id] ?? 0) > 0);
    return abilityVisual ?? active ?? null;
}

export function lockOnTargetPoint(shape) {
    const x = Number(shape?.abilityTargetX);
    const y = Number(shape?.abilityTargetY);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function entityCaption(shape) {
    if (["hunterDrone", "repellerDrone"].includes(shape?.type)) return `${formatEntityHp(shape.hp ?? 50)} HP`;
    if (shape?.type === "staticSnare") return `${formatEntityHp(shape.hp ?? 20)} HP`;
    if (shape?.type === "orbitalMarker") return `${(Math.max(0, Number(shape.remainingMs ?? shape.fuseMs ?? 0)) / 1000).toFixed(1)}s`;
    return "";
}

function formatEntityHp(value) {
    return Math.max(0, Number(value)).toFixed(1);
}
