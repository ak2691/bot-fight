import { relativeLocalDeadlineMs } from "./relativeMatchTiming.js";

/** The client auto-submits the current brain this long before its own clock reaches zero. */
export const AUTO_SUBMIT_LEAD_MS = 1_500;
export const CLOCK_AMBER_MS = 30_000;
export const CLOCK_RED_MS = 10_000;
export const CLOCK_TICK_MS = 250;
export const TIMEOUT_FALLBACKS = Object.freeze({ CURRENT: "CURRENT", PREVIOUS: "PREVIOUS" });

export function normalizeTimeoutFallback(value) {
    return String(value ?? "").toUpperCase() === TIMEOUT_FALLBACKS.PREVIOUS
        ? TIMEOUT_FALLBACKS.PREVIOUS
        : TIMEOUT_FALLBACKS.CURRENT;
}

/**
 * Adds `buildEndsAtMs` (a monotonic local deadline, docs/MATCH_TIMING.md normalization) to every player
 * of an event. A player whose absolute `buildEndsAt` is unchanged keeps the deadline already computed,
 * so repeated events do not jitter a running clock. Submitted players have no deadline.
 */
export function withPlayerClockDeadlines(event, previousEvent, estimatedOneWayDelayMs, localNowMs) {
    if (!Array.isArray(event?.players)) return event;
    const previousByUser = new Map((previousEvent?.players ?? [])
        .filter((player) => player?.userId != null)
        .map((player) => [String(player.userId), player]));
    const players = event.players.map((player) => {
        if (!player) return player;
        const previous = previousByUser.get(String(player.userId));
        const previousMs = Number(previous?.buildEndsAtMs);
        const reuse = player.buildEndsAt != null
            && player.buildEndsAt === previous?.buildEndsAt
            && Number.isFinite(previousMs);
        return {
            ...player,
            buildEndsAtMs: player.buildEndsAt == null
                ? null
                : reuse
                    ? previousMs
                    : relativeLocalDeadlineMs({
                        deadlineServerTime: player.buildEndsAt,
                        serverTransmitTime: event.serverNow,
                        localReceiveTimeMs: localNowMs,
                        estimatedOneWayDelayMs,
                    }),
        };
    });
    return { ...event, players };
}

/**
 * What one player's chess clock shows right now. A player who has submitted (or has no running
 * deadline) is frozen at the clock the server reported; everyone else counts down to their deadline.
 */
export function playerClockView(player, nowMs) {
    const frozenMs = Math.max(0, Number(player?.clockRemainingMs) || 0);
    const deadlineMs = Number(player?.buildEndsAtMs);
    const submitted = Boolean(player?.finished);
    const running = !submitted && Number.isFinite(deadlineMs);
    return {
        submitted,
        running,
        remainingMs: running ? Math.max(0, deadlineMs - Number(nowMs)) : frozenMs,
    };
}

export function clockTone(remainingMs) {
    if (remainingMs < CLOCK_RED_MS) return "red";
    if (remainingMs < CLOCK_AMBER_MS) return "amber";
    return "normal";
}

/** m:ss, rounded up to whole seconds so the display never reaches 0:00 early. */
export function formatClockMs(remainingMs) {
    const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000)) || 0;
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/** True once an unsubmitted player is inside the auto-submit window of their own deadline. */
export function inAutoSubmitWindow(view) {
    return view.running && view.remainingMs <= AUTO_SUBMIT_LEAD_MS;
}
