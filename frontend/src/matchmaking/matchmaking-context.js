import { createContext, useContext } from "react";

export const MatchmakingContext = createContext(null);

export function useMatchmaking() {
    const value = useContext(MatchmakingContext);
    if (!value) throw new Error("useMatchmaking must be used inside MatchmakingProvider");
    return value;
}
