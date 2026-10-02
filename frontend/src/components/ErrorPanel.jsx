import { useState } from "react";
import { Link } from "react-router-dom";

const ICONS = Object.freeze({
    connection: <><path d="M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-8.3-3.6" /><path d="M5.6 12.5a10 10 0 0 1 3-1.8M18.4 12.5a10 10 0 0 0-3.2-2" /><path d="M9 16.2a5 5 0 0 1 6 0" /><path d="M12 20h.01" /><path d="m3 3 18 18" /></>,
    renderer: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="m9 8 6 4M15 8l-6 4" /></>,
    generic: <><path d="M12 3 2.5 20h19Z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
});

export function ErrorIcon({ kind = "generic", className = "h-6 w-6" }) {
    return (
        <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[kind] ?? ICONS.generic}
        </svg>
    );
}

function ErrorRef({ value }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(String(value));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Copying is a convenience; the reference stays visible either way.
        }
    };
    return (
        <p className="font-mono text-[11px] text-slate-500">
            Error ref {value}{" · "}
            <button type="button" onClick={copy} className="text-slate-400 underline hover:text-slate-200">{copied ? "copied" : "copy"}</button>
        </p>
    );
}

/**
 * Shared layout for fatal errors and 404s: icon tile, title, muted message, a primary action,
 * a secondary link and an optional error reference.
 */
export default function ErrorPanel({
    kind = "generic",
    title,
    message,
    primaryLabel = null,
    onPrimary = null,
    secondaryLabel,
    secondaryTo,
    errorRef = null,
    compact = false,
    tone = "error",
    children = null,
}) {
    const tile = tone === "error"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
        : "border-slate-500/40 bg-slate-500/10 text-slate-300";
    return (
        <main className={`${compact ? "h-full min-h-0" : "min-h-screen"} flex flex-col items-center justify-center gap-3 bg-arena-deep px-5 text-center`}>
            <span className={`grid h-14 w-14 place-items-center rounded-2xl border ${tile}`}>
                <ErrorIcon kind={kind} className="h-7 w-7" />
            </span>
            <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
            {message && <p role="alert" className="max-w-[340px] text-sm leading-6 text-slate-400">{message}</p>}
            {children}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {primaryLabel && (
                    <button
                        type="button"
                        onClick={onPrimary}
                        className="min-h-11 rounded-xl border-b-[3px] border-[#0f5f78] bg-[#2088ac] px-5 font-display text-sm font-bold text-white hover:brightness-110"
                    >
                        {primaryLabel}
                    </button>
                )}
                <Link
                    to={secondaryTo}
                    className="inline-flex min-h-11 items-center rounded-xl border border-[#2d353c] bg-[#12181d] px-5 text-sm font-semibold text-slate-200 hover:border-slate-500"
                >
                    {secondaryLabel}
                </Link>
            </div>
            {errorRef != null && errorRef !== "" && <ErrorRef value={errorRef} />}
        </main>
    );
}
