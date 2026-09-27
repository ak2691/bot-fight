import { Assets } from "pixi.js";
import { loadAbilitySpriteCatalogue } from "./abilitySpriteAssets.js";
import { createArenaPresentationAssetOwner } from "./arenaPresentationAssetOwner.js";

const defaultOwner = createArenaPresentationAssetOwner({
    loadCatalogue: loadAbilitySpriteCatalogue,
    loadAsset: (url) => Assets.load(url),
});

export * from "./arenaPresentationAssetOwner.js";

export function preloadArenaPresentationAssets() {
    return defaultOwner.preload();
}

export function loadArenaPresentationAssets() {
    return defaultOwner.preload();
}

export function getArenaPresentationAssetsState() {
    return defaultOwner.getState();
}

export function subscribeToArenaPresentationAssets(listener) {
    return defaultOwner.subscribe(listener);
}
