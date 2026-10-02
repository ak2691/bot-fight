import { useEffect, useRef, useState } from "react";

/**
 * "- value +" stepper with a typeable centre. Commits on blur/Enter; always clamps to min/max.
 * `unit` is appended in the display only (for example " s").
 */
export default function Stepper({ value, onChange, min = 0, max = 100, step = 1, unit = "", ariaLabel, disabled = false, className = "" }) {
    const inputRef = useRef(null);
    const display = `${value}${unit}`;
    const [text, setText] = useState(display);
    const lastExternalRef = useRef(display);

    useEffect(() => {
        if (display === lastExternalRef.current) return;
        lastExternalRef.current = display;
        // Keep an in-progress edit; otherwise follow the committed value.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (document.activeElement !== inputRef.current) setText(display);
    }, [display]);

    const clamp = (next) => Math.min(max, Math.max(min, next));
    const commitNumber = (next) => {
        const bounded = clamp(Math.round(next));
        lastExternalRef.current = `${bounded}${unit}`;
        setText(`${bounded}${unit}`);
        if (bounded !== value) onChange(bounded);
    };
    const commitText = () => {
        const parsed = Number.parseFloat(text.replace(unit, "").trim());
        commitNumber(Number.isFinite(parsed) ? parsed : value);
    };

    const buttonClass = "grid h-8 w-8 place-items-center border border-[#262c33] bg-[#12181d] text-base leading-none text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
    return (
        <div className={`inline-flex items-center ${className}`} role="group" aria-label={ariaLabel}>
            <button type="button" className={`${buttonClass} rounded-l-md`} onClick={() => commitNumber(value - step)} disabled={disabled || value <= min} aria-label={`Decrease ${ariaLabel ?? "value"}`}>&minus;</button>
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={text}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={(event) => setText(event.target.value)}
                onBlur={commitText}
                onClick={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    commitText();
                    event.currentTarget.blur();
                }}
                className="h-8 w-14 border-y border-[#262c33] bg-[#0b0f12] text-center font-display text-sm font-bold text-white outline-none focus:border-cyan-400"
            />
            <button type="button" className={`${buttonClass} rounded-r-md`} onClick={() => commitNumber(value + step)} disabled={disabled || value >= max} aria-label={`Increase ${ariaLabel ?? "value"}`}>+</button>
        </div>
    );
}
