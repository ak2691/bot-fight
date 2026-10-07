/** Whole seconds as m:ss, e.g. 300 -> "5:00". */
export function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds)));
    if (!Number.isFinite(total)) return "0:00";
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatClockSetting(baseClockSeconds, incrementSeconds) {
    return `${formatClock(baseClockSeconds)} + ${formatClock(incrementSeconds)}`;
}

export function clampClockSetting(value, min, max, fallback) {
    const seconds = Math.floor(Number(value));
    if (!Number.isFinite(seconds)) return fallback;
    return Math.min(max, Math.max(min, seconds));
}
