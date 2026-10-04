import { useEffect, useRef, useState } from "react";
// Toolbar pieces shared by the code workspace and the puzzle rules workspace.

export function BudgetMeter({ label, value, max, compact = false, title }) {
    const ratio = max > 0 ? value / max : 0;
    const state = ratio >= 1 ? "is-full" : ratio >= 0.85 ? "is-near" : "";
    if (compact) {
        return (
            <span className={`code-tb-chip ${state}`} title={`${title ?? label} ${value}/${max}`}>
                <span className="code-tb-chip-label">{label}</span> <b>{value}/{max}</b>
            </span>
        );
    }
    return (
        <div className={`code-tb-meter ${state}`}>
            <span className="code-tb-meter-text">{label} <b>{value}/{max}</b></span>
            <span className="code-tb-meter-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></span>
        </div>
    );
}

export function ToolbarBracesIcon() {
    return <svg className="code-tb-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6 2.5C4.5 2.5 4.5 4 4.5 5.5S4.5 7.5 3 8c1.5.5 1.5 1.5 1.5 2.5S4.5 13.5 6 13.5M10 2.5c1.5 0 1.5 1.5 1.5 3S11.5 7.5 13 8c-1.5.5-1.5 1.5-1.5 2.5s0 3-1.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ToolbarCloseIcon() {
    return <svg className="code-tb-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export function ToolbarNodeIcon() {
    return <svg className="code-tb-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2.5" y="4.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M11.5 1.5v4M9.5 3.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

/** "⋯ More": the rarer tools at mid width. Items are { label, kbd, onClick, disabled, danger } or { divider: true }. */
export function ToolbarMoreMenu({ items }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
        const onKeyDown = (event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
        window.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [open]);
    return <div className="code-tb-more" ref={rootRef}>
        <button type="button" className="code-tb-btn" aria-haspopup="menu" aria-expanded={open} aria-label="More tools" title="More" onClick={() => setOpen((current) => !current)}>⋯</button>
        {open && <div className="code-tb-menu" role="menu">
            {items.map((item, index) => item.divider
                ? <div key={`divider-${index}`} className="code-tb-menu-divider" role="separator" />
                : <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : ""} disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }}>
                    <span>{item.label}</span>{item.kbd && <kbd className="code-tb-kbd">{item.kbd}</kbd>}
                </button>)}
        </div>}
    </div>;
}

/** A bottom sheet over the workspace (phones): a grip, then rows. Tapping outside or Escape closes it. */
export function WorkspaceSheet({ title, onClose, children }) {
    useEffect(() => {
        const onKeyDown = (event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [onClose]);
    return <div className="code-sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="code-sheet" role="dialog" aria-modal="true" aria-label={title}>
            <span className="code-sheet-grip" aria-hidden="true" />
            {children}
        </section>
    </div>;
}

export function SheetRow({ tag = null, tone = "", label, value = null, onClick, disabled = false, danger = false }) {
    const content = <>{tag && <span className={`code-sheet-tag is-${tone}`}>{tag}</span>}<span className="code-sheet-label">{label}</span>{value && <span className="code-sheet-value">{value}</span>}</>;
    return onClick
        ? <button type="button" className={`code-sheet-row ${danger ? "is-danger" : ""}`} disabled={disabled} onClick={onClick}>{content}</button>
        : <div className="code-sheet-row">{content}</div>;
}

/** Bottom action bar slot on phones: icon over a short label. */
export function PhoneBarButton({ icon, label, primary = false, ...props }) {
    return <button type="button" className={`code-pb-slot ${primary ? "is-add" : ""}`} {...props}><span className="code-pb-icon" aria-hidden="true">{icon}</span><span className="code-pb-label">{label}</span></button>;
}

/** The trash can used by the search menu: node and config "delete" controls are this icon, no words. */
export function TrashIcon() {
    return <svg className="code-trash-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M7 7v3.5M9 7v3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
