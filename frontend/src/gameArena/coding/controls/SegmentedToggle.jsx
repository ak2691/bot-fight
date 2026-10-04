/** Two or three mutually exclusive options as one joined control. */
export function SegmentedToggle({ options, value, onChange, disabled, ariaLabel, className = "" }) {
    return <div className={`code-va-segmented ${className}`.trim()} role="group" aria-label={ariaLabel} data-node-drag-ignore="true" onPointerDown={(event) => event.stopPropagation()}>
        {options.map((option) => <button key={option.id} type="button" disabled={disabled} title={option.title} aria-pressed={value === option.id} className={value === option.id ? "is-active" : ""} onClick={() => onChange(option.id)}>{option.label}</button>)}
    </div>;
}
