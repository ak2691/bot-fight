import { abilityDefinition } from "../loadout/BotLoadout.js";
import { abilityChargeCount, abilityRechargeRemainingMs } from "../gameconfig/AbilityResourceSystem.js";

export const ABILITY_RING_COLORS = Object.freeze({
    active: "#7dd3fc",
    cooldown: "#22c55e",
    idle: "#64748b",
    preparing: "#facc15",
    ready: "#22c55e",
});

export const ABILITY_ACCENT_COLORS = Object.freeze({
    20: "#facc15",
});

export function abilityRingColorFor(abilityId, status) {
    const activeAccent = status?.state === "active" ? ABILITY_ACCENT_COLORS[abilityId] : null;
    return activeAccent
        ?? ABILITY_RING_COLORS[status?.state]
        ?? ABILITY_RING_COLORS.idle;
}

export function abilityStatusFor(bot, abilityId) {
    const definition = abilityDefinition(abilityId);
    const stats = definition?.stats ?? {};
    const abilityActiveMs = positiveNumber(bot?.abilityActiveMs?.[abilityId]);
    const activeMs = abilityActiveMs;
    const configuredActiveDurationMs = positiveNumber(stats.statusDurationMs ?? stats.durationMs ?? stats.activeMs ?? stats.visualMs);
    const activeDurationMs = configuredActiveDurationMs || (activeMs > 0 ? 300 : 0);
    const preparing = bot?.preparingAbility === abilityId
        && positiveNumber(bot?.preparingMs) > 0;
    const windupMs = positiveNumber(stats.windupMs);

    if (preparing && windupMs) {
        const remainingMs = Math.min(windupMs, positiveNumber(bot?.preparingMs));
        return timedStatus("preparing", remainingMs, windupMs, 1 - remainingMs / windupMs);
    }

    if (activeMs > 0) {
        const progress = activeDurationMs ? 1 - Math.min(1, activeMs / activeDurationMs) : 1;
        return timedStatus("active", activeMs, activeDurationMs, progress);
    }

    const cooldown = abilityCooldownFor(bot, abilityId, stats);
    if (cooldown.remainingMs > 0) {
        return timedStatus(
            "cooldown",
            cooldown.remainingMs,
            cooldown.durationMs,
            cooldown.durationMs ? 1 - Math.min(1, cooldown.remainingMs / cooldown.durationMs) : null,
        );
    }

    return {
        state: isReady(bot, abilityId) ? "ready" : "idle",
        remainingMs: null,
        durationMs: null,
        progress: isReady(bot, abilityId) ? 1 : 0,
    };
}

export function abilityChargeCountFor(bot, abilityId) {
    return abilityChargeCount(bot, abilityId);
}

export function abilityCooldownFor(bot, abilityId, stats = abilityDefinition(abilityId)?.stats ?? {}) {
    const configuredCooldownMs = positiveNumber(stats.cooldownMs ?? stats.reuseCooldownMs);
    const cooldownMs = positiveNumber(bot?.abilityCooldowns?.[abilityId]);
    // Cooldown is the recovery phase after active time; it is no longer a
    // parallel timer whose active portion needs to be subtracted for display.
    const cooldownDurationMs = Math.max(1, configuredCooldownMs);
    const rechargeMs = abilityRechargeRemainingMs(bot, abilityId);
    const rechargeDurationMs = positiveNumber(stats.rechargeMs ?? stats.reloadMs);
    const remainingMs = Math.max(cooldownMs, rechargeMs);
    return {
        remainingMs,
        durationMs: Math.max(
            cooldownMs > 0 ? cooldownDurationMs : 0,
            rechargeMs > 0 ? rechargeDurationMs : 0,
        ),
    };
}

export function abilityRingBackground(status) {
    const color = ABILITY_RING_COLORS[status?.state] ?? ABILITY_RING_COLORS.idle;
    const progress = ["active", "preparing", "ready"].includes(status?.state)
        ? 1
        : Math.max(0, Math.min(1, Number(status?.progress ?? 0)));
    const percentage = `${(progress * 100).toFixed(2)}%`;
    return `conic-gradient(from 0deg, ${color} 0 ${percentage}, ${ABILITY_RING_COLORS.idle} ${percentage} 100%)`;
}

export function abilityRingArcPath(progress, center = 18, radius = 15.5) {
    const normalizedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    if (normalizedProgress <= 0 || normalizedProgress >= 1) return null;

    const endAngle = normalizedProgress * Math.PI * 2 - Math.PI / 2;
    const endX = center + radius * Math.cos(endAngle);
    const endY = center + radius * Math.sin(endAngle);
    const largeArcFlag = normalizedProgress > 0.5 ? 1 : 0;
    return `M ${center} ${center - radius} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
}

export function formatAbilityTimer(remainingMs) {
    const milliseconds = positiveNumber(remainingMs);
    if (!milliseconds) return "";
    return `${(Math.ceil(milliseconds / 100) / 10).toFixed(1)}s`;
}

export function fallbackAbilityText(abilityId, label = "") {
    if (abilityId === 20) return "LO";
    const words = String(label || abilityId || "?").split(/[\s_-]+/).filter(Boolean);
    return words.map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function timedStatus(state, remainingMs, durationMs, progress) {
    return { state, remainingMs, durationMs, progress };
}

function isReady(bot, abilityId) {
    if (positiveNumber(bot?.abilityActiveMs?.[abilityId]) > 0
        || (bot?.preparingAbility != null && positiveNumber(bot?.preparingMs) > 0)) return false;
    const stats = abilityDefinition(abilityId)?.stats ?? {};
    const charges = abilityChargeCountFor(bot, abilityId);
    if (charges != null && Number(charges) <= 0) return false;
    return abilityCooldownFor(bot, abilityId, stats).remainingMs <= 0;
}

function positiveNumber(value) {
    return Math.max(0, Number(value) || 0);
}
