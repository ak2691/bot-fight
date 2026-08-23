import { useCallback, useEffect, useRef, useState } from "react";
import { preloadPixiRoutes } from "../../routeLoaders.js";

const INITIAL_PIXI_PRELOAD_STATE = Object.freeze({
    rendererReady: false,
    gpuWarmupReady: false,
    routesReady: false,
    rendererError: null,
    backgroundError: null,
});
const INITIAL_ASSET_STATE = Object.freeze({
    status: "idle",
    catalogue: null,
    error: null,
    loadedCount: 0,
    totalCount: 0,
    currentAsset: null,
});

export function useArenaPresentationAssets({ enabled = true } = {}) {
    const [state, setState] = useState(INITIAL_ASSET_STATE);
    const [pixiPreloadState, setPixiPreloadState] = useState(INITIAL_PIXI_PRELOAD_STATE);
    const assetsApiRef = useRef(null);
    const pixiApiRef = useRef(null);

    useEffect(() => {
        if (!enabled) return undefined;

        let active = true;
        let unsubscribe = () => { };
        const update = (nextState) => {
            if (active) setState(nextState);
        };

        async function beginPreload() {
            const [assetsApi, pixiApi] = await Promise.all([
                import("./arenaPresentationAssets.js"),
                import("./pixiApplication.js"),
            ]);
            if (!active) return;

            assetsApiRef.current = assetsApi;
            pixiApiRef.current = pixiApi;
            unsubscribe = assetsApi.subscribeToArenaPresentationAssets(update);
            update(assetsApi.getArenaPresentationAssetsState());
            const assetsPromise = assetsApi.preloadArenaPresentationAssets();
            // The owner notifies synchronously when loading starts, but keep
            // the hook state explicit so the protected route cannot remain on
            // its initial 0/... placeholder during that transition.
            update(assetsApi.getArenaPresentationAssetsState());
            // The preload promise resolves to the texture catalogue, while the
            // hook state must always retain the owner's progress snapshot.
            // Passing `update` directly here replaces status/count fields with
            // catalogue fields and leaves the protected route stuck at 0/....
            void assetsPromise.then(
                () => update(assetsApi.getArenaPresentationAssetsState()),
                () => update(assetsApi.getArenaPresentationAssetsState()),
            );
            void startPixiPreload(assetsPromise, active, setPixiPreloadState, pixiApi).catch((error) => {
                if (active) setPixiPreloadState((current) => ({ ...current, backgroundError: error }));
            });
        }

        void beginPreload().catch((error) => {
            if (active) setState((current) => ({ ...current, status: "failed", error }));
        });

        return () => {
            active = false;
            unsubscribe();
            assetsApiRef.current = null;
            pixiApiRef.current = null;
        };
    }, [enabled]);

    const retry = useCallback(() => {
        const assetsApi = assetsApiRef.current;
        const pixiApi = pixiApiRef.current;
        if (!assetsApi || !pixiApi) return;

        setPixiPreloadState(INITIAL_PIXI_PRELOAD_STATE);
        const assetsPromise = assetsApi.retryArenaPresentationAssets();
        setState(assetsApi.getArenaPresentationAssetsState());
        void assetsPromise.then(() => {
            setState(assetsApi.getArenaPresentationAssetsState());
        }, () => {
            setState(assetsApi.getArenaPresentationAssetsState());
        });
        void startPixiPreload(assetsPromise, true, setPixiPreloadState, pixiApi).catch((error) => {
            setPixiPreloadState((current) => ({ ...current, backgroundError: error }));
        });
    }, []);

    const error = pixiPreloadState.rendererError;
    return {
        ...state,
        ...pixiPreloadState,
        arenaAssetError: state.error,
        error,
        retry,
    };
}

export function isArenaPresentationGateReady(state) {
    return state?.rendererReady === true;
}

function waitForBrowserFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(resolve);
        } else {
            setTimeout(resolve, 0);
        }
    });
}

async function startPixiPreload(cataloguePromise, active, setPreloadState, pixiApi) {
    const pixiPromise = withTimeout(
        pixiApi.preloadPixiApplication(),
        15000,
        "Pixi renderer initialization timed out.",
    ).then((application) => {
        if (active) setPreloadState((current) => ({ ...current, rendererReady: true }));
        return application;
    }, (error) => {
        if (active) setPreloadState((current) => ({ ...current, rendererError: error }));
        throw error;
    });
    const routesPromise = preloadPixiRoutes().then(() => {
        if (active) setPreloadState((current) => ({ ...current, routesReady: true }));
    }, (error) => {
        if (active) setPreloadState((current) => ({ ...current, backgroundError: error }));
        throw error;
    });
    // Asset decoding, renderer creation, and route downloads are independent.
    // Start them together, then warm the renderer when the catalogue arrives.
    // Renderer initialization, GPU warmup, and route downloads remain background
    // work after the protected asset gate is allowed to render the application.
    const [catalogue, application] = await Promise.all([cataloguePromise, pixiPromise]);
    await waitForBrowserFrame();
    pixiApi.warmPixiApplicationTextures(application, catalogue);
    if (active) setPreloadState((current) => ({ ...current, gpuWarmupReady: true }));
    await routesPromise;
}

function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        Promise.resolve(promise).then((value) => {
            clearTimeout(timeoutId);
            resolve(value);
        }, (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });
    });
}

