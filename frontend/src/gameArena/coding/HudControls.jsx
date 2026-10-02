import ToolIcon from "./controls/MatchToolIcon.jsx";

// Game-HUD controls for the match and practice rooms. Styles: `.hud-*` in index.css.

export function HudButton({ children, icon, label, onClick, disabled, variant = "regular", className = "" }) {
    const accessibleLabel = label ?? (typeof children === "string" ? children : undefined);
    return (
        <button
            type="button"
            className={`hud-btn hud-btn--${variant} ${className}`}
            onClick={onClick}
            disabled={disabled}
            aria-label={accessibleLabel}
            title={accessibleLabel}
        >
            {icon && <ToolIcon name={icon} className="h-4 w-4" />}
            {children != null && <span>{children}</span>}
        </button>
    );
}

export function HudSwitchRow({ icon, label, checked, onChange, disabled }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            className="hud-switch-row"
            onClick={onChange}
            disabled={disabled}
        >
            <span className="hud-switch-row__label">
                {icon && <ToolIcon name={icon} className="h-4 w-4" />}
                {label}
            </span>
            <span className="hud-switch" aria-hidden="true"><span className="hud-switch__knob" /></span>
        </button>
    );
}

export function HudScoreboard({ blueScore, redScore, roundLabel, clock }) {
    return (
        <div className="hud-scoreboard" role="group" aria-label="Match score">
            <div className="hud-score hud-score--blue">
                <span className="hud-score__team">BLUE</span>
                <strong className="hud-score__value">{blueScore}</strong>
            </div>
            <div className="hud-score-mid">
                <span className="hud-score-mid__round">ROUND {roundLabel}</span>
                <strong className="hud-score-mid__clock">{clock}</strong>
            </div>
            <div className="hud-score hud-score--red">
                <span className="hud-score__team">RED</span>
                <strong className="hud-score__value">{redScore}</strong>
            </div>
        </div>
    );
}

export function HudBudget({ actions, maxActions, conditions, maxConditions }) {
    const tone = (value, max) => (max > 0 && value / max >= 1 ? "is-full" : max > 0 && value / max >= 0.8 ? "is-near" : "");
    return (
        <dl className="hud-budget">
            <div className={tone(actions, maxActions)}>
                <dt>Actions</dt>
                <dd><b>{actions}</b>/{maxActions}</dd>
            </div>
            <div className={tone(conditions, maxConditions)}>
                <dt>Conditions</dt>
                <dd><b>{conditions}</b>/{maxConditions}</dd>
            </div>
        </dl>
    );
}
