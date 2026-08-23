import {
    CLOSING_ZONE_CONFIG,
    CLOSING_ZONE_ID,
    CLOSING_ZONE_TYPE,
} from "../../gameconfig/ArenaHazardConfig.js";

/**
 * The closing zone is a world hazard rather than a bot-visible ability
 * entity. Its replay shape is still entity-like so the renderer and replay
 * pipeline can reuse the existing arena shape architecture.
 */
export function isClosingZone(shape) {
    return shape?.type === CLOSING_ZONE_TYPE || shape?.id === CLOSING_ZONE_ID;
}

export function createClosingZone(width, height) {
    const safeRadius = fullArenaCircleRadius(width, height);
    return zoneShape(width, height, safeRadius, 0, 0);
}

export function closingZoneSafeRadius(elapsedMs, width, height, config = CLOSING_ZONE_CONFIG) {
    const activeElapsedMs = Math.max(0, Number(elapsedMs) - Number(config.startDelayMs));
    if (Number(elapsedMs) < Number(config.startDelayMs)) return null;

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

export function closingZoneTouchesBot(zone, bot) {
    if (!zone || !bot || Number(bot.hp ?? 0) <= 0) return false;
    const safeRadius = Number(zone.safeRadius ?? Number(zone.size ?? 0) / 2);
    const botRadius = Math.max(0, Number(bot.size ?? 0)) / 2;
    const distance = Math.hypot(
        Number(bot.x ?? 0) - Number(zone.x ?? 0),
        Number(bot.y ?? 0) - Number(zone.y ?? 0),
    );
    return distance + botRadius >= safeRadius;
}

export function tickClosingZoneWorld({
    zone,
    bots,
    elapsedMs,
    stepMs = 100,
    width,
    height,
} = {}, { applyDamageToShape } = {}) {
    const currentElapsedMs = Math.max(0, Number(elapsedMs) || 0);
    if (currentElapsedMs < Number(CLOSING_ZONE_CONFIG.startDelayMs)) {
        return { bots, zone: null };
    }

    const activeElapsedMs = Math.max(0, currentElapsedMs - CLOSING_ZONE_CONFIG.startDelayMs);
    const currentZone = zone ?? createClosingZone(width, height);
    const updateIntervalMs = Math.max(1, Number(CLOSING_ZONE_CONFIG.geometryUpdateMs) || 1);
    const geometryElapsedMs = Math.floor(activeElapsedMs / updateIntervalMs) * updateIntervalMs;
    const candidateSafeRadius = closingZoneSafeRadius(
        Number(CLOSING_ZONE_CONFIG.startDelayMs) + geometryElapsedMs,
        width,
        height,
    );
    const geometryChanged = Math.abs(candidateSafeRadius - Number(currentZone.safeRadius ?? 0)) > 1e-9;
    const nextZone = geometryChanged
        ? updateZoneGeometry(currentZone, width, height, geometryElapsedMs, candidateSafeRadius)
        : currentZone;

    let nextBots = bots ?? [];
    const previousElapsedMs = Math.max(0, currentElapsedMs - Math.max(1, Number(stepMs) || 1));
    const damageTickCount = completedDamageTicks(previousElapsedMs, currentElapsedMs);
    if (damageTickCount > 0 && typeof applyDamageToShape === "function") {
        const damageSource = { id: CLOSING_ZONE_ID, type: CLOSING_ZONE_TYPE };
        for (let tick = 0; tick < damageTickCount; tick += 1) {
            nextBots = nextBots.map((bot) => {
                if (!closingZoneTouchesBot(nextZone, bot)) return bot;
                const damage = Math.max(0, roundCombatValue(
                    Number(bot.maxHp ?? bot.hp ?? 0) * Number(CLOSING_ZONE_CONFIG.damagePercentMaxHp),
                ));
                return applyDamageToShape(bot, damage, damageSource);
            });
        }
    }

    return { bots: nextBots, zone: nextZone };
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

function completedDamageTicks(previousElapsedMs, currentElapsedMs) {
    const start = Number(CLOSING_ZONE_CONFIG.startDelayMs);
    const interval = Math.max(1, Number(CLOSING_ZONE_CONFIG.damageIntervalMs) || 1);
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
