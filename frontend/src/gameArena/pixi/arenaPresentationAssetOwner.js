export const ARENA_ASSET_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    READY: "ready",
    FAILED: "failed",
});

export const REQUIRED_ARENA_PRESENTATION_PATHS = Object.freeze([
    "bot",
    "drone",
    "rays.gun",
    "rays.pistol",
    "rays.fire_gun",
    "rays.pistol_shot",
    "rays.concussive_shot",
    "rays.rail_shot",
    "muzzleFlash",
    "stun",
    "dashSmoke",
    "windburst",
    "fireball",
    "grenade.moving",
    "grenade.static",
    "grenade.detonate",
    "mine.moving",
    "mine.static",
    "mine.detonate",
    "grenadeMineExplosion",
    "gravityGrenade",
    "silencePulse",
    "nullZone",
    "temporalRewind",
    "basicHeal",
    "lockOnCrosshair",
    "repulsorBlast",
    "shield",
    "orbitalMarker",
    "orbitalExplosion",
    "meleeSlash",
    "heavySlash",
    "phaseStrike",
]);

export class ArenaAssetLoadError extends Error {
    constructor(assetId, url, cause) {
        const suffix = url ? ` (${url})` : "";
        const detail = cause?.message ? ` ${cause.message}` : "";
        super(`Unable to load required arena asset ${assetId}${suffix}.${detail}`);
        this.name = "ArenaAssetLoadError";
        this.assetId = assetId;
        this.url = url;
        this.cause = cause;
    }
}

export function createArenaPresentationAssetOwner({
    loadCatalogue,
    loadAsset = async () => { throw new Error("No arena asset loader was configured."); },
} = {}) {
    let status = ARENA_ASSET_STATUS.IDLE;
    let catalogue = null;
    let error = null;
    let inFlight = null;
    let cataloguePromise = null;
    const assetPromises = new Map();
    const listeners = new Set();
    let progress = emptyProgress();
    let attemptAssetKeys = new Set();
    let completedAttemptAssetKeys = new Set();

    function snapshot() {
        return {
            status,
            catalogue,
            error,
            loadedCount: progress.loadedCount,
            totalCount: progress.totalCount,
            currentAsset: progress.currentAsset,
        };
    }

    function notify() {
        const current = snapshot();
        listeners.forEach((listener) => listener(current));
    }

    function loadRequiredAsset(url, assetId) {
        const cacheKey = String(url);
        if (attemptAssetKeys.has(cacheKey)) return assetPromises.get(cacheKey);

        attemptAssetKeys.add(cacheKey);
        progress = {
            ...progress,
            totalCount: progress.totalCount + 1,
            currentAsset: assetId,
        };
        notify();

        let request = assetPromises.get(cacheKey);
        if (!request) {
            request = Promise.resolve()
                .then(() => loadAsset(url, assetId))
                .then((value) => {
                    if (value == null) throw new Error("The asset loader returned no resource.");
                    return value;
                })
                .catch((cause) => {
                    assetPromises.delete(cacheKey);
                    if (cause instanceof ArenaAssetLoadError) throw cause;
                    throw new ArenaAssetLoadError(assetId, url, cause);
                });
        }

        request = request.then((value) => {
            if (!completedAttemptAssetKeys.has(cacheKey)) {
                completedAttemptAssetKeys.add(cacheKey);
                progress = {
                    ...progress,
                    loadedCount: progress.loadedCount + 1,
                    currentAsset: progress.loadedCount + 1 >= progress.totalCount
                        ? null
                        : progress.currentAsset,
                };
                notify();
            }
            return value;
        });
        assetPromises.set(cacheKey, request);
        return request;
    }

    function preload() {
        if (status === ARENA_ASSET_STATUS.READY) return cataloguePromise ?? Promise.resolve(catalogue);
        if (status === ARENA_ASSET_STATUS.FAILED) return Promise.reject(error);
        if (inFlight) return inFlight;
        if (typeof loadCatalogue !== "function") return Promise.reject(new Error("No arena asset catalogue loader was configured."));

        status = ARENA_ASSET_STATUS.LOADING;
        error = null;
        progress = emptyProgress();
        attemptAssetKeys = new Set();
        completedAttemptAssetKeys = new Set();
        notify();
        inFlight = Promise.resolve()
            .then(() => loadCatalogue(loadRequiredAsset))
            .then((nextCatalogue) => {
                const normalizedCatalogue = nextCatalogue?.abilities
                    ? nextCatalogue
                    : { abilities: nextCatalogue };
                validateCatalogue(normalizedCatalogue);
                catalogue = freezeCatalogue(normalizedCatalogue);
                status = ARENA_ASSET_STATUS.READY;
                inFlight = null;
                notify();
                return catalogue;
            })
            .catch((cause) => {
                error = cause instanceof ArenaAssetLoadError
                    ? cause
                    : new ArenaAssetLoadError("arena-catalogue", null, cause);
                catalogue = null;
                status = ARENA_ASSET_STATUS.FAILED;
                inFlight = null;
                cataloguePromise = null;
                notify();
                throw error;
            });
        cataloguePromise = inFlight;
        return inFlight;
    }

    function retry() {
        if (status === ARENA_ASSET_STATUS.FAILED) {
            status = ARENA_ASSET_STATUS.IDLE;
            error = null;
            notify();
        }
        return preload();
    }

    return {
        getState: snapshot,
        preload,
        retry,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

function emptyProgress() {
    return { loadedCount: 0, totalCount: 0, currentAsset: null };
}

export function isArenaPresentationReady(state) {
    return state?.status === ARENA_ASSET_STATUS.READY && state.catalogue != null;
}

function validateCatalogue(nextCatalogue) {
    const abilities = nextCatalogue?.abilities ?? nextCatalogue;
    if (!abilities || typeof abilities !== "object") {
        throw new Error("Arena asset catalogue did not return an abilities catalogue.");
    }
    REQUIRED_ARENA_PRESENTATION_PATHS.forEach((path) => {
        const value = path.split(".").reduce((current, key) => current?.[key], abilities);
        const valid = Array.isArray(value) ? value.length > 0 : value != null;
        if (!valid) throw new Error(`Arena asset catalogue is missing ${path}.`);
    });
}

function freezeCatalogue(value) {
    if (Array.isArray(value)) {
        value.forEach(freezeCatalogue);
        return Object.freeze(value);
    }
    if (!value || typeof value !== "object" || "source" in value || "baseTexture" in value) return value;
    Object.keys(value).forEach((key) => freezeCatalogue(value[key]));
    return Object.freeze(value);
}
