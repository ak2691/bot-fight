import { useAuth } from "../../auth/auth-context";
import { useArenaPresentationAssets } from "./useArenaPresentationAssets.js";
import { ArenaPresentationAssetsContext } from "./ArenaPresentationAssetsContext.js";

export default function ArenaPresentationAssetsProvider({ children }) {
    const { isAuthenticated, isGuest, isLoading } = useAuth();
    const assets = useArenaPresentationAssets({
        enabled: (isAuthenticated || isGuest) && !isLoading,
    });

    return (
        <ArenaPresentationAssetsContext.Provider value={assets}>
            {children}
        </ArenaPresentationAssetsContext.Provider>
    );
}
