export const loadGameArena = () => import("./gameArena/Arena");
export const loadAbilityCatalogue = () => import("./pages/catalogue/AbilityCataloguePage");
export const loadAbilityTesting = () => import("./pages/testing/AbilityTestingPage");
export const loadAbilityTestingReplay = () => import("./pages/testing/AbilityTestingReplayPage");
export const loadConditionalCatalogue = () => import("./pages/catalogue/ConditionalCataloguePage");
export const loadMatchmaking = () => import("./pages/game/GamePage");
export const loadProfile = () => import("./pages/profile/ProfilePage");
export const loadProfileSearch = () => import("./pages/profile/ProfileSearchPage");

export function createBrowserPreloader(loader) {
    let inFlight = null;

    return () => {
        if (typeof window === "undefined") return Promise.resolve(null);
        if (inFlight) return inFlight;

        inFlight = Promise.resolve()
            .then(loader)
            .catch(() => {
                inFlight = null;
                return null;
            });
        return inFlight;
    };
}

export const preloadPixiAndArenaAssets = createBrowserPreloader(() => Promise.all([
    // Keep this bare specifier identical to PixiCanvas so the browser and
    // bundler can reuse the gameplay module cache entry.
    import("pixi.js"),
    import("./gameArena/pixi/arenaPresentationAssets.js"),
]).then(([, { preloadArenaPresentationAssets }]) => preloadArenaPresentationAssets()));
