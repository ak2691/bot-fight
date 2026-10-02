import { useEffect } from "react";
import { Link } from "react-router-dom";

const TONES = Object.freeze({
    error: { box: "border-rose-500/50 bg-[#2a1517] text-rose-100", icon: "text-rose-300", role: "alert" },
    warning: { box: "border-amber-500/50 bg-[#2a2210] text-amber-100", icon: "text-amber-300", role: "alert" },
    success: { box: "border-emerald-500/50 bg-[#10261a] text-emerald-100", icon: "text-emerald-300", role: "status" },
    info: { box: "border-cyan-500/50 bg-[#0e2028] text-cyan-100", icon: "text-cyan-300", role: "status" },
});

const ICON_PATHS = Object.freeze({
    error: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5m0 3.2h.01" /></>,
    warning: <><path d="M12 3 2.5 20h19Z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
    success: <><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.6 2.6L16 9.5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8.2h.01" /></>,
});

export const TOAST_AUTO_DISMISS_MS = 4000;

/** Fixed region for toasts: bottom-centre on desktop (above any action bar), top on phones. */
export function ToastStack({ children }) {
    return <div className="toast-stack" data-testid="toast-stack">{children}</div>;
}

/**
 * One alert component for the whole app. Errors and warnings use role="alert" and stay until dismissed or
 * replaced; success and info use role="status" and auto-dismiss when `onDismiss` is provided.
 */
export default function Toast({ tone = "info", children, actionLabel = null, actionTo = null, onAction = null, onDismiss = null, autoDismissMs = TOAST_AUTO_DISMISS_MS }) {
    const style = TONES[tone] ?? TONES.info;
    const autoDismiss = (tone === "success" || tone === "info") && typeof onDismiss === "function";

    useEffect(() => {
        if (!autoDismiss) return undefined;
        const timeoutId = window.setTimeout(onDismiss, autoDismissMs);
        return () => window.clearTimeout(timeoutId);
    }, [autoDismiss, autoDismissMs, onDismiss, children]);

    const actionClass = "shrink-0 text-xs font-semibold text-white/90 underline underline-offset-2 hover:text-white";
    return (
        <div role={style.role} className={`toast pointer-events-auto flex w-full max-w-[28rem] items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-5 shadow-[0_10px_30px_rgba(0,0,0,.45)] ${style.box}`}>
            <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current ${style.icon}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[tone] ?? ICON_PATHS.info}</svg>
            <span className="min-w-0 flex-1">{children}</span>
            {actionLabel && (actionTo
                ? <Link to={actionTo} className={actionClass}>{actionLabel}</Link>
                : <button type="button" onClick={onAction} className={actionClass}>{actionLabel}</button>)}
            {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 px-1 text-base leading-none text-white/60 hover:text-white">&times;</button>}
        </div>
    );
}
