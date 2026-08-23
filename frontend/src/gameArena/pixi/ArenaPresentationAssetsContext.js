import { createContext, useContext } from "react";

export const ArenaPresentationAssetsContext = createContext(null);

export function useArenaPresentationAssetsContext() {
    const assets = useContext(ArenaPresentationAssetsContext);
    if (!assets) {
        throw new Error("useArenaPresentationAssetsContext must be used inside ArenaPresentationAssetsProvider");
    }
    return assets;
}
