export const loadAbilityCatalogue = () => import("./pages/catalogue/AbilityCataloguePage");
export const loadConditionalCatalogue = () => import("./pages/catalogue/ConditionalCataloguePage");
export const loadMatch = () => import("./pages/game/GamePage");
export const loadProfile = () => import("./pages/profile/ProfilePage");
export const loadProfileSearch = () => import("./pages/profile/ProfileSearchPage");
export const loadTutorial = () => import("./tutorial/TutorialPage");
export const loadPuzzles = () => import("./pages/puzzles/PuzzleListPage.jsx");
export const loadPuzzlePlay = () => import("./pages/puzzles/PuzzlePlayPage.jsx");
export const loadPuzzleBuilder = () => import("./pages/puzzles/PuzzleBuilderPage.jsx");

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

export const preloadPixiRoutes = createBrowserPreloader(() => Promise.all([
    // These routes mount PixiCanvas directly or through SimulationReplay and
    // should be warm before the protected home surface becomes interactive.
    loadMatch(),
    loadTutorial(),
]));
