import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    VARIABLE_OPERATOR_OPTIONS,
    nextVariableOperatorMenuIndex,
    variableOperatorMenuKeyAction,
    variableOperatorPresentation,
} from "./variableOperatorPresentation.js";

export function VariableOperatorGlyph({ operation, className = "" }) {
    const presentation = variableOperatorPresentation(operation);
    const glyphClass = `code-variable-operator-glyph code-variable-operator-glyph--${presentation.glyph} ${className}`.trim();
    return <span className={glyphClass} aria-hidden="true">{presentation.compactSymbol}</span>;
}

export function VariableOperatorPicker({
    value,
    operations = VARIABLE_OPERATOR_OPTIONS.map((option) => option.id),
    onChange,
    disabled = false,
    ariaLabel = "Variable action operator",
}) {
    const menuId = useId();
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const optionRefs = useRef([]);
    const options = VARIABLE_OPERATOR_OPTIONS
        .filter((option) => operations.includes(option.id) || option.id === value)
        .map((option) => ({ ...option, disabled: !operations.includes(option.id) }));
    const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
    const selected = options[selectedIndex] ?? variableOperatorPresentation(value);
    const firstEnabledIndex = Math.max(0, options.findIndex((option) => !option.disabled));
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(selectedIndex);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

    const updateMenuPosition = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger || typeof window === "undefined") return;
        const rect = trigger.getBoundingClientRect();
        const estimatedHeight = options.length * 34 + 10;
        const opensBelow = window.innerHeight - rect.bottom >= estimatedHeight + 8;
        setMenuPosition({
            top: opensBelow ? rect.bottom + 3 : Math.max(8, rect.top - estimatedHeight - 3),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 64)),
        });
    }, [options.length]);

    useEffect(() => {
        if (!open) return undefined;
        const updatePosition = () => updateMenuPosition();
        const closeOutside = (event) => {
            if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
        };
        updatePosition();
        window.addEventListener("resize", updatePosition);
        document.addEventListener("scroll", updatePosition, true);
        document.addEventListener("pointerdown", closeOutside, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            document.removeEventListener("scroll", updatePosition, true);
            document.removeEventListener("pointerdown", closeOutside, true);
        };
    }, [open, updateMenuPosition]);

    useEffect(() => {
        if (open) optionRefs.current[activeIndex]?.focus();
    }, [activeIndex, open]);

    const openMenu = (index = selectedIndex) => {
        const initialIndex = options[index]?.disabled ? firstEnabledIndex : index;
        updateMenuPosition();
        setActiveIndex(Math.max(0, Math.min(initialIndex, options.length - 1)));
        setOpen(true);
    };
    const closeMenu = (returnFocus = false) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    };
    const handleTriggerKeyDown = (event) => {
        const action = variableOperatorMenuKeyAction(event.key);
        if ((action === "ArrowDown" || action === "ArrowUp" || action === "Home" || action === "End") && open) {
            event.preventDefault();
            const disabledIndices = options.flatMap((option, index) => option.disabled ? [index] : []);
            const nextIndex = nextVariableOperatorMenuIndex(action, activeIndex, options.length, disabledIndices);
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (action === "close-and-return-focus" && open) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu(true);
            return;
        }
        if (action === "ArrowDown" || action === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) closeMenu();
            else openMenu(selectedIndex);
        }
    };
    const handleOptionKeyDown = (event, index) => {
        const action = variableOperatorMenuKeyAction(event.key);
        if (action === "ArrowDown" || action === "ArrowUp" || action === "Home" || action === "End") {
            event.preventDefault();
            const disabledIndices = options.flatMap((option, optionIndex) => option.disabled ? [optionIndex] : []);
            const nextIndex = nextVariableOperatorMenuIndex(action, index, options.length, disabledIndices);
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (action === "close-and-return-focus") {
            event.preventDefault();
            event.stopPropagation();
            closeMenu(true);
            return;
        }
        if (action === "close-and-continue-focus") {
            event.preventDefault();
            const direction = event.shiftKey ? -1 : 1;
            const focusable = [...document.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
                .filter((element) => !menuRef.current?.contains(element) && !element.closest("[hidden]"));
            const triggerIndex = focusable.indexOf(triggerRef.current);
            const next = focusable[triggerIndex + direction];
            closeMenu(false);
            next?.focus();
            return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const firstLetter = event.key.toLocaleLowerCase();
            const nextIndex = options.findIndex((option, optionIndex) => !option.disabled && optionIndex > index
                && option.label.toLocaleLowerCase().startsWith(firstLetter));
            const wrappedIndex = nextIndex >= 0 ? nextIndex : options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(firstLetter));
            if (wrappedIndex >= 0) {
                event.preventDefault();
                setActiveIndex(wrappedIndex);
                optionRefs.current[wrappedIndex]?.focus();
            }
        }
    };
    const choose = (option) => {
        if (option.disabled) return;
        if (option.id !== value) onChange(option.id);
        closeMenu(true);
    };

    const menu = <div
        ref={menuRef}
        id={menuId}
        className="code-variable-operator-menu"
        role="menu"
        aria-label={ariaLabel}
        hidden={!open}
        style={open ? { top: menuPosition.top, left: menuPosition.left } : undefined}
    >
        {options.map((option, index) => <button
            key={option.id}
            ref={(element) => { optionRefs.current[index] = element; }}
            type="button"
            role="menuitemradio"
            aria-label={option.label}
            aria-checked={option.id === value}
            aria-disabled={option.disabled || undefined}
            disabled={option.disabled}
            tabIndex={open && index === activeIndex ? 0 : -1}
            className="code-variable-operator-menu-item"
            onClick={() => choose(option)}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
        >
            <VariableOperatorGlyph operation={option.id} />
        </button>)}
    </div>;

    return <div ref={rootRef} className="code-variable-operator-picker" onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget) && !menuRef.current?.contains(event.relatedTarget)) setOpen(false);
    }}>
        <button
            ref={triggerRef}
            type="button"
            className="code-variable-action-operator-button"
            disabled={disabled}
            aria-label={`${ariaLabel}: ${selected.label}`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => open ? closeMenu() : openMenu()}
            onKeyDown={handleTriggerKeyDown}
        >
            <VariableOperatorGlyph operation={selected.id} />
            <span className="sr-only">{selected.label}</span>
            <span className="code-variable-operator-caret" aria-hidden="true">▾</span>
        </button>
        {open && typeof document !== "undefined" ? createPortal(menu, document.body) : menu}
    </div>;
}
