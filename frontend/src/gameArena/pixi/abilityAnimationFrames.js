/** Explicit frame contracts for multi-file presentation animations. */
export const FIREBALL_FRAME_NAMES = Object.freeze([
    "001.png",
    "002.png",
    "003.png",
    "004.png",
    "005.png",
]);

export const FIREBALL_FRAME_INTERVAL_MS = 65;

export function orderedAnimationFrames(frameMap, frameNames) {
    return frameNames.map((name) => {
        const frame = frameMap?.[name];
        if (frame == null) throw new Error(`Missing animation frame: ${name}`);
        return frame;
    });
}

export function animationFrameAt(frames, elapsedMs, frameMs = 100, loop = true) {
    if (!frames?.length) return null;
    const rawIndex = Math.max(0, Math.floor(Number(elapsedMs ?? 0) / frameMs));
    const index = loop ? rawIndex % frames.length : Math.min(rawIndex, frames.length - 1);
    return frames[index];
}
