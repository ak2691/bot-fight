import { entityRendererForVisualType } from "./renderers/entityRenderers.js";
import { abilityDefinition, VISUAL_INTERPOLATION } from "../../../../shared/engine/loadout/BotLoadout.js";
import { abilityId } from "../../../../shared/engine/gameconfig/AbilityRegistry.js";
import { CLOSING_ZONE_TYPE } from "../../../../shared/engine/gameconfig/ArenaHazardConfig.js";
import { AUTO_STEP_MS } from "../../../../shared/engine/modelPayloads/arenaConstants.js";
import { isBotState } from "../../../../shared/engine/modelPayloads/botState.js";
import { compassDegreesToRadians } from "../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { statusIsActive } from "../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { entityContract, eventVerbs, phaseForEntity, phaseSpeed, activationView, VERBS } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { BOT_ABILITY_VISUAL_PRIORITY } from "./botAbilityPresentationDefinitions.js";
import { activeRemainingMs, windupRemainingMs } from "../../../../shared/engine/gameconfig/AbilityState.js";
import { DASH_CHANNEL, abilityChannel } from "../../../../shared/engine/gameconfig/AbilityChannels.js";

const ZONE_TYPES = new Set([CLOSING_ZONE_TYPE, "grenadeExplosion", "orbitalMarker", "orbitalExplosion", "silenceWave", "temporalRewindZone", "singularityZone", "singularityExplosion", "staticSnareBurst"]);
const PROJECTILE_TYPES = new Set(["grenade", "fireball", "windburstProjectile"]);
// These names only occur in replay payloads written before phase visuals were
// authoritative. Keep their timer fallback so historical replays remain
// renderable; new payloads use phaseId and the normal renderer contract.
const LEGACY_REPLAY_PHASE_VISUAL_TYPES = new Set([
    "grenadeExplosion",
    "orbitalExplosion",
    "singularityExplosion",
    "staticSnareBurst",
]);
// Authoritative replay entities expose gameplay lifetime and phase clocks.
// Presentation duration is resolved only from the browser contract below.
const PROJECTILE_TRAILS = Object.freeze({
    fireball: { color: 0xfb923c, length: 48, width: 10 },
});
const FROST_RING_FRAME_MS = 300 / 49;
const SINGULARITY_FRAME_MS = 100;

export const ENTITY_PRESENTATION_DEFINITIONS = Object.freeze({
    hunterDrone: {
        texturePath: ["drone"], animation: "static", rotationOffset: -Math.PI / 2,
    },
    windburstProjectile: { texturePath: ["windburst"], animation: "time", frameMs: 65 },
    fireball: { texturePath: ["fireball"], animation: "time", frameMs: 65 },
    grenadeExplosion: { texturePath: ["grenadeMineExplosion"], animation: "progress", durationMs: 200, remaining: "visible" },
    silenceWave: {
        texturePath: ["silencePulse"], animation: "time", frameMs: 80, rotationOffset: -Math.PI / 2,
    },
    // Rewind is a persistent phase visual. Its clock loops through
    // the clock frames for the entity's whole gameplay lifetime; the delayed
    // restore effect is not also used as a visual progress timer.
    temporalRewindZone: { texturePath: ["temporalRewind"], animation: "time", frameMs: 100 },
    orbitalExplosion: { texturePath: ["orbitalExplosion"], animation: "progress", durationMs: 400, remaining: "orbital" },
    singularityZone: { texturePath: ["singularity"], animation: "time", frameMs: SINGULARITY_FRAME_MS },
    singularityExplosion: { texturePath: ["orbitalExplosion"], animation: "progress", durationMs: 400, remaining: "orbital" },
    frostRing: { texturePath: ["frostRing"], animation: "progress", durationMs: 300 },
});

function semanticVisualEventActive(shape) {
    return Boolean(shape?.eventType)
        && Number(shape?.eventSequence ?? 0) > 0
        && (shape?.visualEventMs == null || Number(shape.visualEventMs) > 0);
}

function eventHandlerFor(phase, eventType) {
    return Object.entries(phase?.on ?? {})
        .find(([declaredType]) => declaredType.toLowerCase() === eventType)?.[1] ?? null;
}

/** The visual an event shows: its emitVisual verb, or the visual of a hit verb (a summon's shot). */
function eventVisualFor(handler) {
    const verbs = eventVerbs(handler);
    const emit = verbs.find((verb) => verb.do === VERBS.EMIT_VISUAL);
    if (emit) return { type: emit.visualType, visualSize: emit.visualSize, visibleMs: emit.visibleMs };
    const hit = verbs.find((verb) => verb.do === VERBS.HIT && verb.visual);
    return hit ? { type: hit.visual.type, visualSize: hit.visual.visualSize, visibleMs: hit.visual.visibleMs } : null;
}

export const VISUAL_LIFECYCLES = Object.freeze({
    PHASE: "phase",
    EVENT: "event",
});

export const VISUAL_SPAWN_MODES = Object.freeze({
    ENTITY: "entity",
    EVENT: "event",
});

const VISUAL_EVENT_FIELDS = Object.freeze([
    "eventType",
    "eventPhaseId",
    "eventSequence",
    "visualEvent",
    "visualEventType",
    "visualEventMs",
    "visualEventSize",
]);

/** Removes event-only presentation fields before resolving a phase visual. */
export function shapeWithoutVisualEvent(shape) {
    const phaseShape = { ...shape };
    for (const field of VISUAL_EVENT_FIELDS) delete phaseShape[field];
    return phaseShape;
}

function visualEventSequence(shape) {
    const sequence = Number(shape?.eventSequence ?? shape?.visualEvent ?? 0);
    return Number.isFinite(sequence) && sequence > 0 ? sequence : 0;
}

function visualStartForDescriptor(descriptor, now) {
    const durationMs = Math.max(0, Number(descriptor?.durationMs) || 0);
    const remainingMs = Number(descriptor?.remainingMs);
    const elapsedMs = durationMs > 0 && Number.isFinite(remainingMs)
        ? Math.min(durationMs, Math.max(0, durationMs - Math.max(0, remainingMs)))
        : 0;
    const spawnedAt = Number(now) - elapsedMs;
    return {
        durationMs,
        spawnedAt: Number.isFinite(spawnedAt) ? spawnedAt : Number(now),
    };
}

/**
 * Creates the common lifecycle record used by phase-bound and event visuals.
 * Phase visuals follow their source entity; event visuals are fixed at the
 * coordinates where the event was observed and expire on their own clock.
 */
export function visualInstanceForShape(shape, now, lifecycle = VISUAL_LIFECYCLES.EVENT) {
    const eventVisual = lifecycle === VISUAL_LIFECYCLES.EVENT;
    const sourceShape = eventVisual ? shape : shapeWithoutVisualEvent(shape);
    const descriptor = visualAnimationDescriptorForShape(sourceShape);
    const visual = visualForShape(sourceShape);
    if (!descriptor || !visual) return null;
    if (eventVisual && !descriptor.eventActive) return null;
    if (!eventVisual && descriptor.eventActive) return null;

    const sourceId = sourceShape?.id == null ? null : String(sourceShape.id);
    const sequence = visualEventSequence(sourceShape);
    const visualType = visual.type ?? sourceShape?.type;
    if (!sourceId || !visualType) return null;

    const { durationMs, spawnedAt } = visualStartForDescriptor(descriptor, now);
    if (eventVisual && durationMs <= 0) return null;
    const x = Number(sourceShape?.visualOriginX ?? sourceShape?.x ?? 0);
    const y = Number(sourceShape?.visualOriginY ?? sourceShape?.y ?? 0);
    const rotation = Number(sourceShape?.visualOriginRotation ?? sourceShape?.rotation ?? 0);
    const normalizedX = Number.isFinite(x) ? x : 0;
    const normalizedY = Number.isFinite(y) ? y : 0;
    const normalizedRotation = Number.isFinite(rotation) ? rotation : 0;
    const phaseId = sourceShape?.phaseId == null ? null : String(sourceShape.phaseId);
    const id = eventVisual
        ? `event:${sourceId}:${sequence}:${visualType}`
        : `phase:${sourceId}:${phaseId ?? "default"}:${visualType}`;
    const instanceShape = eventVisual
        ? {
            ...sourceShape,
            type: visualType,
            x: normalizedX,
            y: normalizedY,
            rotation: normalizedRotation,
            eventType: sourceShape.eventType ?? "visual",
            eventSequence: sequence,
            visualEvent: sourceShape.visualEvent ?? sequence,
            visualEventType: visualType,
            visualEventMs: descriptor.remainingMs ?? durationMs,
            visualEventSize: visual.visualSize,
        }
        : sourceShape;

    return {
        id,
        sourceId,
        lifecycle,
        spawnMode: eventVisual ? VISUAL_SPAWN_MODES.EVENT : VISUAL_SPAWN_MODES.ENTITY,
        followEntity: !eventVisual,
        key: descriptor.key,
        phaseId,
        eventType: eventVisual ? String(sourceShape.eventType ?? "visual") : null,
        eventSequence: eventVisual ? sequence : null,
        type: visualType,
        x: normalizedX,
        y: normalizedY,
        rotation: normalizedRotation,
        spawnedAt,
        expiresAt: durationMs > 0 ? spawnedAt + durationMs : null,
        durationMs,
        shape: instanceShape,
    };
}

/** Returns whether a visual instance is still within its presentation life. */
export function visualInstanceIsActive(instance, now) {
    return Boolean(instance)
        && (instance.expiresAt == null || Number(now) < Number(instance.expiresAt));
}

/** Resolves presentation metadata from the entity's current phase. */
export function visualForShape(shape) {
    const contract = entityContract(shape?.entityContractId ?? shape?.abilityId ?? shape?.type);
    if (!contract) return null;

    const semanticEventType = String(shape?.eventType ?? "").toLowerCase();
    if (semanticVisualEventActive(shape)) {
        const phase = phaseForEntity(shape);
        // `interval` was the pre-collision-scheduler event name. Resolve it
        // through the current collision handler so old replays still render,
        // while new authoritative frames use `collision` directly.
        const contractEventType = semanticEventType === "interval"
            ? "collision" : semanticEventType;
        const declaredEventPhase = contract.phases?.find((candidate) =>
            candidate.id === shape.eventPhaseId);
        const eventPhaseCandidates = contract.phases?.filter((candidate) =>
            eventHandlerFor(candidate, contractEventType)) ?? [];
        const eventPhase = declaredEventPhase
            ?? (eventHandlerFor(phase, contractEventType) ? phase
                : eventPhaseCandidates.length === 1 ? eventPhaseCandidates[0] : phase);
        // Replays recorded before summons had a timer event name their shot `collision`.
        const handler = eventHandlerFor(eventPhase, contractEventType)
            ?? eventHandlerFor(phase, contractEventType)
            ?? (contractEventType === "collision" ? eventHandlerFor(phase, "schedule") : null)
            ?? null;
        const visual = eventVisualFor(handler);
        if (visual?.type) {
            return {
                type: visual.type,
                ...(visual.visualSize == null
                    ? {} : { visualSize: Number(visual.visualSize) }),
                ...(visual.visibleMs == null
                    ? {} : { visibleMs: Number(visual.visibleMs) }),
            };
        }
        return null;
    }

    return phaseForEntity(shape)?.visual ?? null;
}

/** Returns the phase/event visual diameter used by entity renderers. */
export function visualSizeForShape(shape, fallback = 0) {
    const visualSize = Number(visualForShape(shape)?.visualSize);
    return Number.isFinite(visualSize) && visualSize > 0 ? visualSize : fallback;
}

/** Returns the asset/presentation type selected by the entity's phase metadata. */
export function presentationTypeForShape(shape) {
    return visualForShape(shape)?.type ?? shape?.type;
}

/** Returns the canvas rotation for an entity's visual art. */
export function entityVisualRotation(shape) {
    const presentation = presentationDefinitionForShape(shape);
    const rotationOffset = Number(presentation?.rotationOffset ?? 0);
    return compassDegreesToRadians(shape?.rotation) + rotationOffset;
}

export const BOT_PRESENTATION_DEFINITIONS = Object.freeze({
    8: { texturePath: ["repulsorBlast"], animation: "presentationClock" },
    3: { texturePath: ["rays", "rail_shot"], animation: "alpha" },
    25: { texturePath: ["phaseStrike"], animation: "progress" },
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

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

/**
 * Wind-up progress (0..1) for a weapon telegraph. The ability's wind-up record holds the remaining
 * wind-up reported by simulation and replay; null when the bot is not winding
 * up that ability. Presentation only.
 */
export function weaponWindupProgress(shape, abilityIdValue, windupMs) {
    const remainingMs = windupRemainingMs(shape, Number(abilityIdValue));
    if (remainingMs <= 0) return null;
    const total = Number(windupMs);
    if (!Number.isFinite(total) || total <= 0) return null;
    return clamp01(1 - remainingMs / total);
}

/** Active progress (0..1) from the ability's remaining active time. */
export function weaponActiveProgress(activeMs, durationMs) {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return 1;
    return clamp01(1 - Number(activeMs ?? 0) / duration);
}

/** Thrust extends, holds, then retracts; returns the fraction of hitbox length. */
export function thrustLengthFraction(progress, extendFraction = 0.35, holdFraction = 0.3) {
    const p = clamp01(progress);
    if (p < extendFraction) return p / extendFraction;
    if (p < extendFraction + holdFraction) return 1;
    const retract = 1 - extendFraction - holdFraction;
    return retract <= 0 ? 0 : clamp01(1 - (p - extendFraction - holdFraction) / retract);
}

/** Linear alpha ramp used by the Cleave and Smash telegraphs. */
export function weaponWindupAlpha(progress, alphaStart, alphaEnd) {
    return alphaStart + (alphaEnd - alphaStart) * clamp01(progress);
}

/** Sniper sight alpha pulses between min and max, driven by wind-up progress so replays match live play. */
export function sniperSightAlpha(progress, alphaMin = 0.35, alphaMax = 0.8, pulses = 3) {
    const wave = (1 - Math.cos(clamp01(progress) * pulses * Math.PI * 2)) / 2;
    return alphaMin + (alphaMax - alphaMin) * wave;
}

/**
 * Length of the Sniper aim line: the full range, or the distance to the first
 * bot the ray (with its width) would touch. Presentation only.
 */
export function sniperSightLength(origin, rotationDegrees, range, rayWidth, targets = []) {
    const radians = compassDegreesToRadians(rotationDegrees);
    const dirX = Math.cos(radians);
    const dirY = Math.sin(radians);
    let nearest = Number(range);
    for (const target of targets) {
        const dx = Number(target.x) - Number(origin.x);
        const dy = Number(target.y) - Number(origin.y);
        const along = dx * dirX + dy * dirY;
        const perpendicular = Math.abs(dx * dirY - dy * dirX);
        const reach = Number(target.size ?? 60) / 2 + Number(rayWidth ?? 0) / 2;
        if (along <= 0 || perpendicular > reach) continue;
        nearest = Math.min(nearest, Math.max(0, along - Math.sqrt(reach * reach - perpendicular * perpendicular)));
    }
    return nearest;
}

/** Smash flash fades from `fillAlpha` to zero across the active phase. */
export function smashFlashAlpha(progress, fillAlpha = 0.5) {
    return fillAlpha * (1 - clamp01(progress));
}

/** Smash cracks grow from the impact point and are fully grown after `growFraction` of the active phase. */
export function smashCrackGrowth(progress, growFraction = 0.12) {
    return growFraction <= 0 ? 1 : Math.min(1, clamp01(progress) / growFraction);
}

/** 1 -> 0 over `durationMs` of presentation-clock time; used by effects that linger after their ability ends. */
export function lingerFade(elapsedMs, durationMs) {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return 1 - clamp01(Number(elapsedMs) / duration);
}

/**
 * How many sprint-trail particles are due on the presentation clock. A null or
 * far-future `nextSpawnAt` (first frame, clock rewound) spawns one now; a long gap
 * spawns one instead of a burst. Returns `{ count, nextSpawnAt }`.
 */
export function sprintSpawnPlan(nextSpawnAt, now, intervalMs, maxCatchUp = 3) {
    const interval = Math.max(1, Number(intervalMs) || 50);
    if (nextSpawnAt == null || nextSpawnAt - now > interval) return { count: 1, nextSpawnAt: now + interval };
    if (now < nextSpawnAt) return { count: 0, nextSpawnAt };
    const due = Math.floor((now - nextSpawnAt) / interval) + 1;
    if (due > maxCatchUp) return { count: 1, nextSpawnAt: now + interval };
    return { count: due, nextSpawnAt: nextSpawnAt + due * interval };
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
    if (isBotState(shape)) return "bots";
    const presentationType = presentationTypeForShape(shape);
    if (ZONE_TYPES.has(presentationType)) return "zones";
    if (PROJECTILE_TYPES.has(presentationType)) return "projectiles";
    if (ZONE_TYPES.has(shape?.type)) return "zones";
    if (PROJECTILE_TYPES.has(shape?.type)) return "projectiles";
    return "entities";
}

export function presentationDefinitionForShape(shape) {
    if (isBotState(shape)) return { kind: "bot", layer: "bots", texturePath: ["bot"], animation: "static" };
    if (shape?.type === CLOSING_ZONE_TYPE) return { kind: "arenaHazard", layer: "zones", animation: "geometry" };
    const phase = phaseForEntity(shape);
    const phaseVisual = phase?.visual;
    const eventActive = semanticVisualEventActive(shape);
    if (phase && Object.prototype.hasOwnProperty.call(phase, "visual")
        && phaseVisual == null && !eventActive) {
        return { kind: "fallback", fallback: "hidden" };
    }
    const presentationType = presentationTypeForShape(shape);
    if ((shape?.type === "tetherBolt" && phaseVisual?.type === "tetherBolt")
        || (["snareBomb", "staticSnare"].includes(shape?.type)
            && ["snareBomb", "staticSnare"].includes(phaseVisual?.type))
        || shape?.type === "staticSnareBurst") {
        return {
            kind: "generated",
            layer: shape.type === "staticSnareBurst" ? "zones" : shape.type === "tetherBolt" ? "projectiles" : "entities",
            fallback: "graphics",
        };
    }
    if (entityRendererForVisualType(phaseVisual?.type)) {
        return { kind: "procedural", layer: "zones", visualType: phaseVisual.type };
    }
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
    const semanticEventActive = semanticVisualEventActive(shape);
    const eventActive = semanticEventActive;
    if (eventActive && !visual) return null;
    const legacyVisual = !visual && LEGACY_REPLAY_PHASE_VISUAL_TYPES.has(type);
    const configuredVisibleMs = eventActive
        ? Number(visual?.visibleMs ?? 0)
        : Number(visual?.visibleMs
            ?? (legacyVisual
                ? shape?.visibleMs ?? shape?.timerMs ?? presentation.durationMs
                : 0));
    const durationMs = Number.isFinite(configuredVisibleMs) && configuredVisibleMs > 0
        ? configuredVisibleMs
        : 0;
    const currentPhase = phaseForEntity(shape);
    const phaseCount = entityContract(shape)?.phases?.length ?? 0;
    const entityLifetimeMs = phaseCount === 1
        ? Number(entityContract(shape)?.lifetime?.duration ?? 0)
        : 0;
    // A phase clock describes gameplay existence. A visual's visibleMs is an
    // event/animation duration and must not extend or shorten that phase.
    const phaseDurationMs = Number(currentPhase?.durationMs ?? entityLifetimeMs ?? 0);
    const hasPhaseClock = shape?.phaseTimerMs != null;
    const phaseElapsedMs = Number(shape?.phaseTimerMs ?? 0);
    const phaseRemainingMs = hasPhaseClock && phaseDurationMs > 0
        ? Math.max(0, phaseDurationMs - Math.max(0, phaseElapsedMs))
        : null;
    const remainingMs = eventActive
        ? (eventMs > 0 ? Math.min(eventMs, durationMs) : durationMs)
        : phaseRemainingMs ?? (shape?.visibleMs != null && Number.isFinite(Number(shape.visibleMs))
            ? Math.max(0, Number(shape.visibleMs))
            : durationMs > 0 ? durationMs : null);
    const eventSequence = shape?.eventSequence != null
        ? `:${shape.eventSequence}`
        : shape?.visualEvent == null ? "" : `:${shape.visualEvent}`;
    const phase = shape?.phaseId == null ? "" : `:${shape.phaseId}`;
    const key = `${eventActive ? "event" : "phase"}${eventSequence}${phase}:${type}:${state}:${size}`;
    return { key, durationMs, remainingMs, eventActive };
}

export function shapeInterpolationMs(shape, from = null, to = null) {
    if (abilityDefinition(shape?.abilityId)?.visualInterpolation === VISUAL_INTERPOLATION.NONE) return 0;
    if (shape?.type === "tetherBolt"
        && shape?.phaseId === "return"
        && Number(shape?.phaseTimerMs ?? 0) > 0
        && from && to) {
        const speed = phaseSpeed(phaseForEntity(shape));
        const distance = Math.hypot(
            Number(to.x ?? 0) - Number(from.x ?? 0),
            Number(to.y ?? 0) - Number(from.y ?? 0),
        );
        if (speed > 0.001 && distance > 0.001) return AUTO_STEP_MS * distance / speed;
    }
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
    const travelDurationMs = Number(entityContract(4)?.phases
        ?.find((phase) => phase.id === "travel")?.durationMs ?? 1000);
    return Number(shape?.stoppedMs ?? 0) >= travelDurationMs - detonateLeadMs ? "detonate" : "static";
}

export function grenadeDetonateProgress(shape, stepMs = AUTO_STEP_MS) {
    const detonateLeadMs = Math.max(0, Number(stepMs) || AUTO_STEP_MS) * 2;
    const travelDurationMs = Number(entityContract(4)?.phases
        ?.find((phase) => phase.id === "travel")?.durationMs ?? 1000);
    const detonateStartMs = Math.max(0, travelDurationMs - detonateLeadMs);
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
    const obstaclePhase = phaseForEntity(obstacle);
    const hasProvidedVelocity = Math.hypot(
        Number(obstacle?.velocityX ?? 0), Number(obstacle?.velocityY ?? 0),
    ) > 0.01;
    const velocity = obstacle?.type === "grenade"
        ? { velocityX: Number(obstacle.velocityX ?? 0), velocityY: Number(obstacle.velocityY ?? 0) }
        : obstaclePhase?.movement != null
            && phaseSpeed(obstaclePhase) <= 0 && !hasProvidedVelocity
            ? { velocityX: 0, velocityY: 0 }
        : replayProjectileVelocity(obstacle, previousObstacle, nextObstacle);
    const legacyVisibleMs = obstacle?.visibleMs != null
        ? Math.max(0, Number(obstacle.visibleMs))
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
        ...(legacyVisibleMs == null ? {} : { visibleMs: legacyVisibleMs }),
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
    if (statusIsActive(shape, "burn")) labels.push("BURN");
    if (statusIsActive(shape, "bleed")) labels.push("BLEED");
    if (statusIsActive(shape, "slow")) labels.push("SLOW");
    if (statusIsActive(shape, "silence")) labels.push("SIL");
    if (statusIsActive(shape, "shock")) labels.push("SHOCK");
    if (statusIsActive(shape, "stun")) labels.push("STUN");
    if (statusIsActive(shape, "overdrive")) labels.push("OVERDRIVE");
    if (statusIsActive(shape, "parry")) labels.push("PARRY");
    if (statusIsActive(shape, "overcharge")) labels.push("OVERCHARGE");
    if (statusIsActive(shape, "tethered")) labels.push("TETHERED");
    return labels;
}

export function activeBotVisual(shape) {
    if (shape?.hp != null && Number(shape.hp) <= 0) return null;
    const abilityVisual = Number(shape?.abilityVisual?.ms ?? 0) > 0 ? shape.abilityVisual.ability : null;
    // A dash-channel ability runs alongside other abilities, so its bot visual never takes the single slot.
    const slotAbility = abilityVisual != null && abilityChannel(abilityVisual) !== DASH_CHANNEL ? abilityVisual : null;
    if (slotAbility != null) {
        return activationView(slotAbility)?.visual?.type
            ? slotAbility : null;
    }
    const active = BOT_ABILITY_VISUAL_PRIORITY
        .find((id) => activeRemainingMs(shape, id) > 0
            && Boolean(activationView(id)?.visual?.type));
    return active ?? null;
}

export function entityCaption(shape) {
    if (shape?.type === "hunterDrone") return `${formatEntityHp(shape.hp ?? 50)} HP`;
    if (["snareBomb", "staticSnare"].includes(shape?.type)) return `${formatEntityHp(shape.hp ?? 20)} HP`;
    return "";
}

function formatEntityHp(value) {
    return Math.max(0, Number(value)).toFixed(1);
}
