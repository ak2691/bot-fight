import {
    CLOSING_ZONE_CONFIG,
    CLOSING_ZONE_ID,
    CLOSING_ZONE_TYPE,
} from "../../gameconfig/ArenaHazardConfig.js";
import { dealDamage } from "../abilities/effects.js";

/**
 * The closing zone is a world hazard rather than a bot-visible ability
 * entity. Its replay shape is still entity-like so the renderer and replay
 * pipeline can reuse the existing arena shape architecture.
 */
export function isClosingZone(shape) {
    return shape?.type === CLOSING_ZONE_TYPE || shape?.id === CLOSING_ZONE_ID;
}

export function createClosingZone(width, height, config = CLOSING_ZONE_CONFIG) {
    const safeRadius = isSteppedZone(config)
        ? Number(config.startDiameterUnits) / 2
        : fullArenaCircleRadius(width, height, config);
    return zoneShape(width, height, safeRadius, 0, 0);
}

export function closingZoneSafeRadius(elapsedMs, width, height, config = CLOSING_ZONE_CONFIG) {
    const activeElapsedMs = Math.max(0, Number(elapsedMs) - Number(config.startDelayMs));
    if (Number(elapsedMs) < Number(config.startDelayMs)) return null;
    if (isSteppedZone(config)) return steppedSafeRadius(Number(elapsedMs), config);

    const fullRadius = fullArenaCircleRadius(width, height, config);
    const phaseCount = Math.max(1, Math.floor(Number(config.phaseCount) || 1));
    const approachMs = Math.max(0, Number(config.approachDurationMs) || 0);
    const phaseMs = Math.max(1, Number(config.phaseDurationMs) || 1);
    const completionElapsedMs = approachMs + Math.max(0, phaseCount - 1) * phaseMs;
    const phaseElapsedMs = activeElapsedMs % phaseMs;
    if (activeElapsedMs >= completionElapsedMs) return 0;
    if (phaseElapsedMs <= approachMs) {
        const phaseIndex = Math.floor(activeElapsedMs / phaseMs);
        const progress = approachMs > 0 ? phaseElapsedMs / approachMs : 1;
        const startFraction = Math.max(0, 1 - phaseIndex / phaseCount);
        const endFraction = Math.max(0, startFraction - 1 / phaseCount);
        return fullRadius * lerp(startFraction, endFraction, progress);
    }

    // The remaining portion of each configured phase is a hold: the safe
    // radius and hitbox stay cached while damage continues for bots outside it.
    const phaseIndex = Math.floor(activeElapsedMs / phaseMs);
    const startFraction = Math.max(0, 1 - phaseIndex / phaseCount);
    if (phaseIndex >= phaseCount) return 0;
    return fullRadius * Math.max(0, startFraction - 1 / phaseCount);
}

/** A stepped config starts at a fixed diameter and contracts through its steps; see the server's ClosingZoneConfig. */
function isSteppedZone(config) {
    return Array.isArray(config?.steps) && config.steps.length > 0;
}

function steppedSafeRadius(elapsedMs, config) {
    let radius = Number(config.startDiameterUnits) / 2;
    for (const step of config.steps) {
        const target = Number(step.toDiameterUnits) / 2;
        if (elapsedMs <= Number(step.startMs)) return radius;
        const contractMs = Math.max(0, Number(step.contractMs) || 0);
        if (elapsedMs < Number(step.startMs) + contractMs) {
            return lerp(radius, target, (elapsedMs - Number(step.startMs)) / contractMs);
        }
        radius = target;
    }
    return radius;
}

/**
 * The warning ring: for `warningLeadMs` before each step starts, the diameter that step contracts to.
 * Null when no ring is shown.
 */
export function closingZoneWarningDiameter(elapsedMs, config = CLOSING_ZONE_CONFIG) {
    if (!isSteppedZone(config)) return null;
    for (const step of config.steps) {
        const start = Number(step.startMs);
        if (elapsedMs >= start - Number(config.warningLeadMs ?? 0) && elapsedMs < start) {
            return Number(step.toDiameterUnits);
        }
    }
    return null;
}

export function closingZoneTouchesBot(zone, bot) {
    if (!zone || !bot || bot.hp <= 0) return false;
    const safeRadius = Number(zone.safeRadius ?? Number(zone.size ?? 0) / 2);
    const botRadius = Math.max(0, bot.size) / 2;
    const distance = Math.hypot(
        bot.x - Number(zone.x ?? 0),
        bot.y - Number(zone.y ?? 0),
    );
    return distance + botRadius >= safeRadius;
}

/**
 * Shrinks the zone and hurts the bots outside it, changing the bots in place. Returns { bots, zone }; the zone
 * is a new object when its geometry changed, otherwise the one passed in.
 */
export function tickClosingZoneWorld({
    zone,
    bots,
    elapsedMs,
    stepMs = 100,
    width,
    height,
    config = CLOSING_ZONE_CONFIG,
} = {}) {
    const currentElapsedMs = Math.max(0, Number(elapsedMs) || 0);
    if (currentElapsedMs < Number(config.startDelayMs)) {
        return { bots, zone: null };
    }

    const activeElapsedMs = Math.max(0, currentElapsedMs - config.startDelayMs);
    const currentZone = zone ?? createClosingZone(width, height, config);
    const updateIntervalMs = Math.max(1, Number(config.geometryUpdateMs) || 1);
    const geometryElapsedMs = Math.floor(activeElapsedMs / updateIntervalMs) * updateIntervalMs;
    const candidateSafeRadius = closingZoneSafeRadius(
        Number(config.startDelayMs) + geometryElapsedMs,
        width,
        height,
        config,
    );
    const geometryChanged = Math.abs(candidateSafeRadius - Number(currentZone.safeRadius ?? 0)) > 1e-9;
    const nextZone = geometryChanged
        ? updateZoneGeometry(currentZone, width, height, geometryElapsedMs, candidateSafeRadius)
        : currentZone;

    const hurtBots = bots ?? [];
    const previousElapsedMs = Math.max(0, currentElapsedMs - Math.max(1, Number(stepMs) || 1));
    const damageTickCount = completedDamageTicks(previousElapsedMs, currentElapsedMs, config);
    if (damageTickCount > 0) {
        const damageSource = { id: CLOSING_ZONE_ID, type: CLOSING_ZONE_TYPE };
        for (let tick = 0; tick < damageTickCount; tick += 1) {
            for (const bot of hurtBots) {
                if (!closingZoneTouchesBot(nextZone, bot)) continue;
                const damage = Math.max(0, roundCombatValue(
                    bot.maxHp * Number(config.damagePercentMaxHp),
                ));
                dealDamage(bot, damage, damageSource);
            }
        }
    }

    return { bots: hurtBots, zone: nextZone };
}

function roundCombatValue(value) {
    return Math.round(Number(value) * 1000) / 1000;
}

function updateZoneGeometry(zone, width, height, geometryElapsedMs, safeRadius) {
    return {
        ...zone,
        ...zoneShape(width, height, safeRadius ?? 0, geometryElapsedMs, geometryElapsedMs),
        activeElapsedMs: geometryElapsedMs,
    };
}

export const CLOSING_ZONE_WARNING_ID = "closing-zone-warning";

/**
 * The ring that previews the diameter the zone contracts to next. Presentation only: the replay shows
 * it from the server's `zoneNextDiameterUnits`, and it never touches a bot.
 */
export function closingZoneWarningShape(diameterUnits, width, height) {
    const diameter = Number(diameterUnits);
    if (!(diameter > 0)) return null;
    return {
        ...zoneShape(width, height, diameter / 2, 0, 0),
        id: CLOSING_ZONE_WARNING_ID,
        warningOnly: true,
    };
}

function zoneShape(width, height, safeRadius, activeElapsedMs, geometryElapsedMs) {
    return {
        id: CLOSING_ZONE_ID,
        type: CLOSING_ZONE_TYPE,
        x: Number(width) / 2,
        y: Number(height) / 2,
        size: Math.max(0, Math.round(Number(safeRadius) * 2)),
        safeRadius: Math.max(0, Number(safeRadius) || 0),
        activeElapsedMs,
        geometryElapsedMs,
        visibility: "renderer-only",
        locked: true,
    };
}

function completedDamageTicks(previousElapsedMs, currentElapsedMs, config = CLOSING_ZONE_CONFIG) {
    const start = Number(config.startDelayMs);
    const interval = Math.max(1, Number(config.damageIntervalMs) || 1);
    const previousActive = Math.max(0, previousElapsedMs - start);
    const currentActive = Math.max(0, currentElapsedMs - start);
    return Math.max(0, Math.floor(currentActive / interval) - Math.floor(previousActive / interval));
}

function fullArenaCircleRadius(width, height, config = CLOSING_ZONE_CONFIG) {
    return Math.hypot(Number(width) || 0, Number(height) || 0) / 2
        + Math.max(0, Number(config.initialSafeRadiusPaddingUnits) || 0);
}

function lerp(from, to, progress) {
    return from + (to - from) * Math.max(0, Math.min(1, progress));
}
