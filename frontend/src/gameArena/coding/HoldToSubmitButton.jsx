import { useCallback, useEffect, useId, useRef, useState } from "react";
import ToolIcon from "./controls/MatchToolIcon.jsx";
import { HOLD_TO_SUBMIT_MS, holdProgress } from "./holdToSubmit.js";

/**
 * The match's primary action: press and hold for about 600 ms, with a fill showing the hold, so a
 * stray tap cannot submit the brain. When `blockedReason` is set the button is inert and says why.
 */
export default function HoldToSubmitButton({ onSubmit, disabled = false, blockedReason = null, label = "Hold to submit", busyLabel = null, holdMs = HOLD_TO_SUBMIT_MS }) {
    const [progress, setProgress] = useState(0);
    const startRef = useRef(null);
    const frameRef = useRef(null);
    const firedRef = useRef(false);
    const inert = disabled || Boolean(blockedReason);

    const onSubmitRef = useRef(onSubmit);
    useEffect(() => { onSubmitRef.current = onSubmit; });

    const cancel = useCallback(() => {
        startRef.current = null;
        if (frameRef.current != null) clearInterval(frameRef.current);
        frameRef.current = null;
        setProgress(0);
    }, []);
    const start = useCallback(() => {
        if (inert || startRef.current != null) return;
        firedRef.current = false;
        startRef.current = performance.now();
        frameRef.current = setInterval(() => {
            const next = holdProgress(startRef.current, performance.now(), holdMs);
            setProgress(next);
            if (next < 1 || firedRef.current) return;
            firedRef.current = true;
            clearInterval(frameRef.current);
            frameRef.current = null;
            startRef.current = null;
            onSubmitRef.current?.();
        }, 30);
    }, [holdMs, inert]);
    useEffect(() => cancel, [cancel]);

    const reasonId = useId();
    return (
        <div className="hud-hold">
            <button
                type="button"
                className="hud-btn hud-btn--primary hud-btn--lg hud-hold__button"
                disabled={inert}
                aria-describedby={blockedReason ? reasonId : undefined}
                onPointerDown={(event) => { if (event.button === 0) start(); }}
                onPointerUp={cancel}
                onPointerLeave={cancel}
                onPointerCancel={cancel}
                onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); start(); } }}
                onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") cancel(); }}
                onBlur={cancel}
            >
                <span className="hud-hold__fill" style={{ width: `${inert ? 0 : Math.round(progress * 100)}%` }} aria-hidden="true" />
                <span className="hud-hold__label"><ToolIcon name="check" className="h-4 w-4" />{busyLabel ?? label}</span>
            </button>
            {blockedReason && <p id={reasonId} className="hud-message hud-message--error" role="status">Can't submit yet: {blockedReason}</p>}
        </div>
    );
}
