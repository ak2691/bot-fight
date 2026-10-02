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
