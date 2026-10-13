import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LaneIcon } from "./laneIcons.jsx";
import { anchoredPosition, MENU_HEIGHT, menuKeyAction } from "./menuModel.js";
import { bottomBarHeight, useSheetLayout } from "./menuSheet.js";
import "./laneMenus.css";

const SHEET_HEIGHT = "min(62vh, 480px)";

/**
 * The shell both lanes menus use (the condition menu and the card menu). It renders into document.body, so no workspace
 * scroll container clips it. On a desktop it sits under `anchor` (see anchoredPosition) with a fixed height; under 600
 * px it is a bottom sheet: search on top, the rail as a chip row (CSS), the list filling the rest.
 *
 * The search row is the first row, with no box of its own. ↑ ↓ Enter are passed to `onKey(action)`; Escape and an
 * outside press call `onClose`. The anchor is not an outside press, so its own click can toggle the menu.
 */
export default function LaneMenuShell({
    label,
    anchor = null,
    width = 430,
    query,
    onQuery,
    placeholder,
    onKey,
    onClose,
    rail = null,
    footer = null,
    children,
}) {
    const sheet = useSheetLayout();
    const rootRef = useRef(null);
    const [position, setPosition] = useState(null);

    const place = useCallback(() => {
        if (sheet) {
            setPosition({ bottom: bottomBarHeight() });
            return;
        }
        const rect = anchor?.getBoundingClientRect?.();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        setPosition(rect ? anchoredPosition(rect, { width, viewport }) : { left: 8, top: 8, width: Math.min(width, viewport.width - 16), height: MENU_HEIGHT });
    }, [anchor, sheet, width]);

    // The first position is measured on the next frame (a DOM read), then kept current on resize and scroll.
    useLayoutEffect(() => {
        const frame = requestAnimationFrame(place);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [place]);

    useEffect(() => {
        const onPointerDown = (event) => {
            // A details popover opened from the menu belongs to it (data-lane-popover), so a press there keeps the menu open.
            const onPopover = event.target instanceof Element && event.target.closest("[data-lane-popover]");
            if (rootRef.current?.contains(event.target) || anchor?.contains?.(event.target) || onPopover) return;
            onClose();
        };
        const onEscape = (event) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onEscape);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onEscape);
        };
    }, [anchor, onClose]);

    if (!position) return null;
    const style = sheet
        ? { position: "fixed", left: 0, right: 0, bottom: position.bottom, height: SHEET_HEIGHT }
        : { position: "fixed", left: position.left, top: position.top, width: position.width, height: position.height };

    const onKeyDown = (event) => {
        const action = menuKeyAction(event.key);
        if (!action || action === "close") return;
        event.preventDefault();
        event.stopPropagation();
        onKey?.(action);
    };

    return createPortal(
        <div
            ref={rootRef}
            className={`lane-menu2${sheet ? " is-sheet" : ""}`}
            role="dialog"
            aria-label={label}
            style={style}
            onKeyDown={onKeyDown}
        >
            <div className="lane-menu2__search">
                <LaneIcon name="search" size={16} className="lane-menu2__search-icon" />
                <input
                    type="search"
                    autoFocus
                    autoComplete="off"
                    aria-label={`${label}: search`}
                    placeholder={placeholder}
                    value={query}
                    onChange={(event) => onQuery(event.target.value)}
                />
            </div>
            <div className="lane-menu2__body">
                {rail && <nav className="lane-menu2__rail" aria-label={`${label}: categories`}>{rail}</nav>}
                <div className="lane-menu2__main">{children}</div>
            </div>
            {footer && <div className="lane-menu2__foot">{footer}</div>}
        </div>,
        document.body,
    );
}

/** One category in the rail: a coloured dot, the name, and the count (faded at 0). */
export function MenuRailItem({ label, tone, count, on = false, onSelect }) {
    return (
        <button
            type="button"
            className={`lane-menu2__cat${on ? " is-on" : ""}${count === 0 ? " is-faded" : ""}`}
            aria-pressed={on}
            onClick={onSelect}
        >
            <span className="lane-menu2__dot" style={{ background: tone }} aria-hidden="true" />
            <span className="lane-menu2__cat-name">{label}</span>
            <span className="lane-menu2__cnt">{count}</span>
        </button>
    );
}
