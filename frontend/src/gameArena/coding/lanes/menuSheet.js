// The phone layout shared by the lanes menus and the details popover: under 600 px they are bottom sheets. Kept out of the
// component files so Fast Refresh keeps working there.
import { useEffect, useState } from "react";

export const SHEET_QUERY = "(max-width: 599px)";

/** True under 600 px wide: the menus then render as a bottom sheet. */
export function useSheetLayout() {
    const [sheet, setSheet] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(SHEET_QUERY).matches));
    useEffect(() => {
        const query = window.matchMedia?.(SHEET_QUERY);
        if (!query) return undefined;
        const update = () => setSheet(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return sheet;
}

/** The space the phone's bottom bar takes, so a sheet sits above it. */
export function bottomBarHeight() {
    return document.querySelector(".code-phone-bar")?.getBoundingClientRect().height ?? 0;
}
