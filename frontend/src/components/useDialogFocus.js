import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export function useDialogFocus(dialogRef, { initialFocusRef = null, onClose = null, lockScroll = false, enabled = true } = {}) {
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!enabled) return undefined;
        const dialog = dialogRef.current;
        if (!dialog) return undefined;

        const previousActiveElement = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        if (lockScroll) document.body.style.overflow = "hidden";

        const initialFocus = initialFocusRef?.current ?? dialog.querySelector(FOCUSABLE_SELECTOR);
        initialFocus?.focus();

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current?.();
                return;
            }
            if (event.key !== "Tab") return;
            event.stopPropagation();

            const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
            if (!focusable.length) {
                event.preventDefault();
                event.stopPropagation();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                event.stopPropagation();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                event.stopPropagation();
                first.focus();
            }
        };

        dialog.addEventListener("keydown", handleKeyDown);
        return () => {
            dialog.removeEventListener("keydown", handleKeyDown);
            if (lockScroll) document.body.style.overflow = previousOverflow;
            if (previousActiveElement instanceof HTMLElement && previousActiveElement.isConnected) {
                previousActiveElement.focus();
            }
        };
    }, [dialogRef, initialFocusRef, lockScroll, enabled]);
}
