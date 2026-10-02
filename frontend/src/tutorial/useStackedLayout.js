import { useEffect, useState } from "react";

export const STACKED_QUERY = "(max-width: 1180px)";

/** True at and below the breakpoint where the arena switches to its stacked strip layout. */
export function useStackedLayout() {
    const [stacked, setStacked] = useState(() => typeof window !== "undefined" && window.matchMedia?.(STACKED_QUERY).matches === true);
    useEffect(() => {
        const query = window.matchMedia?.(STACKED_QUERY);
        if (!query) return undefined;
        const update = () => setStacked(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return stacked;
}
