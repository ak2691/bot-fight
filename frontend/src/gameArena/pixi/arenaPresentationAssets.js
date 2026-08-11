import { Assets } from "pixi.js";
import { loadAbilitySpriteCatalogue } from "./abilitySpriteAssets.js";
import { ARENA_ASSET_STATUS, createArenaPresentationAssetOwner } from "./arenaPresentationAssetOwner.js";

const defaultOwner = createArenaPresentationAssetOwner({
    loadCatalogue: loadAbilitySpriteCatalogue,
    loadAsset: (url) => Assets.load(url),
});

export * from "./arenaPresentationAssetOwner.js";

export function preloadArenaPresentationAssets() {
    return defaultOwner.preload();
}

export function loadArenaPresentationAssets() {
    const state = defaultOwner.getState();
    return state.status === ARENA_ASSET_STATUS.FAILED
        ? defaultOwner.retry()
        : defaultOwner.preload();
}

export function retryArenaPresentationAssets() {
    return defaultOwner.retry();
}

export function getArenaPresentationAssetsState() {
    return defaultOwner.getState();
}

export function subscribeToArenaPresentationAssets(listener) {
    return defaultOwner.subscribe(listener);
}
