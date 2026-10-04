import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A dropdown for the config panels: a quiet trigger and a compact menu with a check on the current choice, optional
// group headings, and arrow-key navigation. Options: { value, label, group?, hint?, disabled? }.
export function MenuSelect({ value, options, onChange, disabled = false, ariaLabel, prefix = null, placeholder = "Choose", className = "" }) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [place, setPlace] = useState(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const selected = options.find((option) => option.value === value);
    const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);

    const close = (refocus = true) => {
        setOpen(false);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    const choose = (option) => {
        if (option.disabled) return;
        close();
        if (option.value !== value) onChange(option.value);
    };
    const openMenu = () => {
        if (disabled || !options.length) return;
        setActive(Math.max(0, options.findIndex((option) => option.value === value)));
        setOpen(true);
    };
    const step = (delta) => {
        const at = enabled.indexOf(active);
        setActive(enabled[Math.max(0, Math.min(enabled.length - 1, (at < 0 ? 0 : at) + delta))]);
    };

    // Below the trigger, or above it when the room underneath is short.
    useLayoutEffect(() => {
        if (!open) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const menuHeight = menuRef.current?.offsetHeight ?? 0;
        const below = window.innerHeight - rect.bottom - 8;
        const up = menuHeight > below && rect.top > below;
        const width = Math.max(rect.width, 160);
        setPlace({
            left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            top: up ? undefined : rect.bottom + 4,
            bottom: up ? window.innerHeight - rect.top + 4 : undefined,
            width,
            maxHeight: Math.max(120, Math.min(280, up ? rect.top - 12 : below)),
        });
    }, [open, options.length]);

    useEffect(() => {
        if (!open) return undefined;
        const outside = (event) => {
            if (!(event.target instanceof Element) || menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
            setOpen(false);
        };
        // Escape closes just the menu, not the panel that holds it.
        const escape = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            close();
        };
        const dismiss = () => setOpen(false);
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", escape, true);
        window.addEventListener("resize", dismiss);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("keydown", escape, true);
            window.removeEventListener("resize", dismiss);
        };
    }, [open]);

    useEffect(() => {
        if (open) menuRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
    }, [open, active]);

    const onKeyDown = (event) => {
        if (event.key === "Tab") { setOpen(false); return; }
        if (!open) {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openMenu(); }
            return;
        }
        if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
        else if (event.key === "Home") { event.preventDefault(); setActive(enabled[0]); }
        else if (event.key === "End") { event.preventDefault(); setActive(enabled.at(-1)); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (options[active]) choose(options[active]); }
    };

    return <>
        <button
            ref={triggerRef}
            type="button"
            className={`ms-trigger ${open ? "is-open" : ""} ${className}`.trim()}
            disabled={disabled}
            aria-label={ariaLabel}
            title={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
            data-node-drag-ignore="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => (open ? close(false) : openMenu())}
            onKeyDown={onKeyDown}
        >
            {prefix && <span className="ms-prefix">{prefix}</span>}
            <span className="ms-value">{selected?.label ?? placeholder}</span>
            <span className="ms-caret" aria-hidden="true">▾</span>
        </button>
        {open && createPortal(
            <div ref={menuRef} className="ms-menu" role="listbox" aria-label={ariaLabel} style={place ?? { visibility: "hidden" }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                {options.map((option, index) => {
                    const heading = option.group && option.group !== options[index - 1]?.group ? <div className="ms-group">{option.group}</div> : null;
                    const isSelected = option.value === value;
                    return <div key={option.value}>
                        {heading}
                        <div
                            role="option"
                            aria-selected={isSelected}
                            aria-disabled={option.disabled || undefined}
                            className={`ms-item ${index === active ? "is-active" : ""} ${isSelected ? "is-selected" : ""} ${option.disabled ? "is-disabled" : ""}`}
                            onMouseEnter={() => !option.disabled && setActive(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}
                        >
                            <span className="ms-check" aria-hidden="true">{isSelected ? "✓" : ""}</span>
                            <span className="ms-label">{option.label}</span>
                            {option.hint && <span className="ms-hint">{option.hint}</span>}
                        </div>
                    </div>;
                })}
            </div>,
            document.body,
        )}
    </>;
}
