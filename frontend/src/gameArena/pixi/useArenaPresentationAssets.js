import { useCallback, useEffect, useState } from "react";
import {
    getArenaPresentationAssetsState,
    preloadArenaPresentationAssets,
    retryArenaPresentationAssets,
    subscribeToArenaPresentationAssets,
} from "./arenaPresentationAssets.js";

export function useArenaPresentationAssets() {
    const [state, setState] = useState(getArenaPresentationAssetsState);

    useEffect(() => {
        let active = true;
        const update = (nextState = getArenaPresentationAssetsState()) => {
            if (active) setState(nextState);
        };
        const unsubscribe = subscribeToArenaPresentationAssets(update);
        void preloadArenaPresentationAssets().then(() => update(), () => update());
        update();
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    const retry = useCallback(() => {
        void retryArenaPresentationAssets().then(() => {
            setState(getArenaPresentationAssetsState());
        }, () => {
            setState(getArenaPresentationAssetsState());
        });
    }, []);

    return { ...state, retry };
}

