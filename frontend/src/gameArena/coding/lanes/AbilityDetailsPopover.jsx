import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { abilityDetails } from "./abilityDetails.js";
import { ActionGlyph } from "./laneIcons.jsx";
import { bottomBarHeight, useSheetLayout } from "./menuSheet.js";
import { anchoredPosition, MENU_HEIGHT } from "./menuModel.js";
import "./laneMenus.css";

const POPOVER_WIDTH = 300;
const POPOVER_HEIGHT = 230;
const SHEET_HEIGHT = "min(56vh, 420px)";

/**
 * The ability details panel (mockup section 7): the ability's icon and name, one line of description, and the stats it
 * has, in mono numbers with units. Read-only. It sits under `anchor` in the menu colours, or is a bottom sheet under 600
 * px. Escape (captured, so an open card menu under it stays) and an outside press call `onClose`; so does an anchor that
 * has left the page. Its own root carries `data-lane-popover`, which the card menu treats as part of itself.
 */
export default function AbilityDetailsPopover({ abilityId, anchor, onClose }) {
    const details = abilityDetails(abilityId);
    const sheet = useSheetLayout();
    const rootRef = useRef(null);
    const [position, setPosition] = useState(null);

    const place = useCallback(() => {
        if (anchor && anchor.isConnected === false) {
            onClose();
            return;
        }
        if (sheet) {
            setPosition({ bottom: bottomBarHeight() });
            return;
        }
        const rect = anchor?.getBoundingClientRect?.();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        setPosition(rect ? anchoredPosition(rect, { width: POPOVER_WIDTH, height: POPOVER_HEIGHT, viewport }) : { left: 8, top: 8, width: Math.min(POPOVER_WIDTH, viewport.width - 16), height: MENU_HEIGHT });
    }, [anchor, onClose, sheet]);

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
            if (rootRef.current?.contains(event.target) || anchor?.contains?.(event.target)) return;
            onClose();
        };
        // Capture on the window, so the Escape stops here and does not also close the menu or editor beneath it.
        const onEscape = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onEscape, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onEscape, true);
        };
    }, [anchor, onClose]);

    if (!details || !position) return null;
    const style = sheet
        ? { position: "fixed", left: 0, right: 0, bottom: position.bottom, maxHeight: SHEET_HEIGHT }
        : { position: "fixed", left: position.left, top: position.top, width: position.width };

    return createPortal(
        <div ref={rootRef} className={`lane-details${sheet ? " is-sheet" : ""}`} data-lane-popover role="dialog" aria-label={`${details.name} details`} style={style}>
            <div className="lane-details__head">
                <ActionGlyph abilityId={abilityId} size={30} />
                <span className="lane-details__name">{details.name}</span>
            </div>
            {details.description && <p className="lane-details__text">{details.description}</p>}
            {details.stats.length > 0 && (
                <dl className="lane-details__stats">
                    {details.stats.map((stat) => (
                        <div key={stat.key} className="lane-details__stat">
                            <dt>{stat.label}</dt>
                            <dd>{stat.value}{stat.unit && <span className="lane-details__unit">{` ${stat.unit}`}</span>}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>,
        document.body,
    );
}
