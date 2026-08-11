import { Texture } from "pixi.js";
import { animationFrameAt } from "./abilityAnimationFrames.js";
import { preloadArenaPresentationAssets } from "./arenaPresentationAssets.js";

export function preloadArenaSprites() {
    return preloadArenaPresentationAssets();
}

export function spriteFrame(frames, elapsedMs, frameMs = 100, loop = true) {
    return animationFrameAt(frames, elapsedMs, frameMs, loop) ?? Texture.EMPTY;
}

export function spriteFrameAtProgress(frames, progress) {
    if (!frames?.length) return Texture.EMPTY;
    const index = Math.round(Math.max(0, Math.min(1, Number(progress ?? 0))) * (frames.length - 1));
    return frames[index];
}
