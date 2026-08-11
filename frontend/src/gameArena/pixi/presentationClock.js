const defaultNow = () => performance.now();

/**
 * Renderer-owned time that can be paused independently of the browser clock.
 * Gameplay timers stay in the model; this clock is only for presentation.
 */
export function createPresentationClock({ now = defaultNow, isPaused = false } = {}) {
    let presentationMs = 0;
    let lastWallMs = now();
    let paused = Boolean(isPaused);

    function advance() {
        const currentWallMs = now();
        const deltaMs = paused ? 0 : Math.max(0, currentWallMs - lastWallMs);
        if (!paused) presentationMs += deltaMs;
        lastWallMs = currentWallMs;
        return { timeMs: presentationMs, deltaMs };
    }

    function setPaused(nextPaused) {
        const nextValue = Boolean(nextPaused);
        if (nextValue === paused) return;
        const currentWallMs = now();
        paused = nextValue;
        lastWallMs = currentWallMs;
    }

    return {
        advance,
        current: () => presentationMs,
        setPaused,
        isPaused: () => paused,
    };
}
