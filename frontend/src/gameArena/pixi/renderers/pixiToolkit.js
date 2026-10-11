import { Container, Sprite } from "pixi.js";
import { spriteFrame, spriteFrameAtProgress } from "../arenaSpriteAssets.js";
import { textureMuzzleAnchor } from "../abilitySpriteAssets.js";

/** Pixi-facing half of the renderer contract. Renderers receive this as `ctx.kit`; tests pass a fake. */

export function hideCachedEffects(view) {
    for (const sprite of view.cachedEffects.values()) sprite.visible = false;
}

export function showCachedEffect(view, slot, texture, { x = 0, y = 0, rotation = 0, alpha = 1, width = null, height = null, tint = 0xffffff, anchorX = 0.5, anchorY = 0.5, blendMode = null } = {}) {
    let sprite = view.cachedEffects.get(slot);
    if (!sprite) {
        sprite = new Sprite({ anchor: 0.5 });
        sprite.eventMode = "none";
        view.cachedEffects.set(slot, sprite);
        view.container.addChildAt(sprite, view.baseSprite ? view.container.getChildIndex(view.baseSprite) + 1 : 1);
    }
    sprite.texture = texture;
    sprite.anchor.set(anchorX, anchorY);
    sprite.position.set(x, y);
    sprite.rotation = rotation;
    sprite.alpha = alpha;
    sprite.tint = tint;
    sprite.blendMode = blendMode ?? "normal";
    if (width != null) sprite.width = width;
    if (height != null) sprite.height = height;
    sprite.visible = true;
    return sprite;
}

export const rendererKit = Object.freeze({
    showEffect: showCachedEffect,
    hideEffects: hideCachedEffects,
    frameAtProgress: spriteFrameAtProgress,
    frameAt: spriteFrame,
    muzzleAnchor: textureMuzzleAnchor,
});
