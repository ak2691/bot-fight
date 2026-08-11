import { useEffect, useRef } from "react";

const SEARCH_MENU_OPENED_EVENT = "machiner:code-search-menu-opened";
const OPEN_SEARCH_MENUS = [];

export function useExclusiveSearchMenu(menuRef, enabled, onClose) {
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!enabled) return undefined;
        const menu = menuRef.current;
        const returnFocusTarget = menu?.parentElement?.closest?.('[role="dialog"]');
        const menuEntry = { menu, close: () => onCloseRef.current?.() };
        const closeOnEscape = (event) => {
            if (event.key !== "Escape" || OPEN_SEARCH_MENUS.at(-1) !== menuEntry) return;
            event.preventDefault();
            event.stopPropagation();
            menuEntry.close();
        };
        const closeOtherMenu = (event) => {
            if (event.detail !== menuRef.current) onCloseRef.current?.();
        };
        OPEN_SEARCH_MENUS.push(menuEntry);
        window.addEventListener("keydown", closeOnEscape, true);
        window.addEventListener(SEARCH_MENU_OPENED_EVENT, closeOtherMenu);
        window.dispatchEvent(new CustomEvent(SEARCH_MENU_OPENED_EVENT, { detail: menuRef.current }));
        return () => {
            window.removeEventListener("keydown", closeOnEscape, true);
            window.removeEventListener(SEARCH_MENU_OPENED_EVENT, closeOtherMenu);
            const entryIndex = OPEN_SEARCH_MENUS.indexOf(menuEntry);
            if (entryIndex >= 0) OPEN_SEARCH_MENUS.splice(entryIndex, 1);
            const activeElement = document.activeElement;
            if (returnFocusTarget instanceof HTMLElement
                && returnFocusTarget.isConnected
                && (!activeElement || activeElement === document.body || !activeElement.isConnected || menu?.contains(activeElement))) {
                returnFocusTarget.focus({ preventScroll: true });
            }
        };
    }, [enabled, menuRef]);
}
