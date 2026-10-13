import { useEffect, useRef, useState } from "react";
import { LaneIcon } from "./laneIcons.jsx";

/**
 * A ⋯ button and its menu. `items` are `{ label, onSelect, disabled?, danger?, icon? }` (icon: a laneIcons name) or `{ divider: true }`. The menu
 * closes after a choice, on an outside press, and on Escape.
 */
export default function LaneMenu({ label, items, triggerClassName = "lanes-icon", className = "" }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div ref={rootRef} className={`lane-menu-wrap ${className}`.trim()}>
            <button
                type="button"
                className={triggerClassName}
                aria-label={label}
                title={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                ⋯
            </button>
            {open && (
                <div role="menu" className="lane-menu" aria-label={label}>
                    {items.map((item, index) => (item.divider
                        ? <hr key={`divider-${index}`} className="lane-menu__rule" role="separator" />
                        : (
                            <button
                                key={item.label}
                                type="button"
                                role="menuitem"
                                className={`lane-menu__item${item.danger ? " is-danger" : ""}`}
                                disabled={item.disabled}
                                onClick={() => {
                                    setOpen(false);
                                    item.onSelect();
                                }}
                            >
                                {item.icon && <LaneIcon name={item.icon} size={14} />}
                                <span>{item.label}</span>
                            </button>
                        )))}
                </div>
            )}
        </div>
    );
}
