import { useLayoutEffect, useRef, useState } from "react";

const INFO_ICON_SRC = "/assets/arena-toolbar/info-circle-icon.png";

// The one info icon used across the config menus: the blue circled "i" image.
export function InfoIconButton({ label, onClick, expanded, className = "" }) {
    return <button type="button" className={`code-info-hint-button ${className}`.trim()} aria-label={label} aria-expanded={expanded} title={label} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClick(event); }}>
        <img src={INFO_ICON_SRC} alt="" aria-hidden="true" className="info-circle-icon code-info-hint-icon" />
    </button>;
}

// The info icon with an explanatory popover that opens on click, keeping paragraphs out of the way until asked for.
export function InfoHint({ text, label = "About this setting" }) {
    const [open, setOpen] = useState(false);
    const popoverRef = useRef(null);
    // Keep the popover inside the window: slide it left when it would cross the right edge (small gap), and right if it would cross the left.
    useLayoutEffect(() => {
        const popover = popoverRef.current;
        if (!open || !popover) return;
        popover.style.transform = "";
        const rect = popover.getBoundingClientRect();
        const gap = 8;
        const shift = rect.right > window.innerWidth - gap ? window.innerWidth - gap - rect.right : rect.left < gap ? gap - rect.left : 0;
        if (shift) popover.style.transform = `translateX(${Math.round(shift)}px)`;
    }, [open, text]);
    if (!text) return null;
    return <span className="code-info-hint">
        <InfoIconButton label={label} expanded={open} onClick={() => setOpen((current) => !current)} />
        {open && <small ref={popoverRef} className="code-info-hint-text">{text}</small>}
    </span>;
}
