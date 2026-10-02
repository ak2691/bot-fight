import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../components/useDialogFocus.js";
import {
    acceptanceAnnouncementRemaining,
    acceptanceProgressFraction,
} from "./matchAcceptance.js";
import { monotonicEpochNowMs } from "./networkDelayEstimator.js";

const RING_RADIUS = 88;
const RING_CENTER = 100;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function modeChipLabel(mode) {
    const normalized = String(mode ?? "").toUpperCase();
    if (normalized === "ONES") return "RANKED 1V1";
    if (normalized === "TWOS") return "RANKED 2V2";
    return null;
}

export default function MatchAcceptanceModal({
    remaining,
    authoritativeRemaining = 0,
    deadlineMs = null,
    visibleStartMs = null,
    acceptanceState,
    otherPlayerAccepted,
    mode = null,
    connectionStatus = "CONNECTED",
    error,
    onAccept,
    onClose = null,
}) {
    const dialogRef = useRef(null);
    const acceptButtonRef = useRef(null);
    const [animationNowMs, setAnimationNowMs] = useState(() => monotonicEpochNowMs());
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
        typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ));
    const closing = remaining <= 0;
    const accepting = acceptanceState === "ACCEPTING";
    const waiting = acceptanceState === "WAITING";
    const connected = connectionStatus === "CONNECTED";
    const acceptanceOpen = Number(authoritativeRemaining) > 0;
    const canAccept = acceptanceOpen && connected && acceptanceState === "READY";
    const announcementRemaining = acceptanceAnnouncementRemaining(remaining);
    const urgency = remaining <= 5 ? "critical" : remaining <= 10 ? "warning" : "normal";
    const progress = acceptanceProgressFraction({
        nowMs: animationNowMs,
        deadlineMs,
        visibleStartMs,
    });
    const dashLength = progress * RING_CIRCUMFERENCE;
    const authoritativeSeconds = Math.max(0, Math.ceil(Number(authoritativeRemaining) || 0));
    const timerLabel = closing
        ? acceptanceOpen
            ? `Closing; ${authoritativeSeconds} seconds remain to accept`
            : "Match acceptance is closing"
        : `${remaining} seconds remaining`;
    // Starting the remaining dash at the top makes the missing segment advance
    // counterclockwise as the deadline approaches.
    const ringTransform = `rotate(-90 ${RING_CENTER} ${RING_CENTER})`;
    const statusMessage = !connected
        ? "Connection lost. Reconnecting..."
        : accepting
            ? "Accepting..."
            : null;
    const acceptedByMe = waiting;
    const ringColor = acceptedByMe ? "#34d399" : urgency === "critical" ? "#f87171" : "#fbbf24";
    const modeLabel = modeChipLabel(mode);
    // Only the 1v1 event carries a meaningful "other player accepted" flag.
    const showOpponentChip = String(mode ?? "").toUpperCase() !== "TWOS" && typeof otherPlayerAccepted === "boolean";

    useEffect(() => {
        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
        mediaQuery.addEventListener?.("change", updatePreference);
        return () => mediaQuery.removeEventListener?.("change", updatePreference);
    }, []);

    useEffect(() => {
        if (prefersReducedMotion) {
            const interval = window.setInterval(
                () => setAnimationNowMs(monotonicEpochNowMs()),
                1_000,
            );
            return () => window.clearInterval(interval);
        }

        let frameId = null;
        const update = () => {
            setAnimationNowMs(monotonicEpochNowMs());
            frameId = window.requestAnimationFrame(update);
        };
        update();
        return () => {
            if (frameId != null) window.cancelAnimationFrame(frameId);
        };
    }, [deadlineMs, prefersReducedMotion, visibleStartMs]);

    useDialogFocus(dialogRef, {
        initialFocusRef: canAccept ? acceptButtonRef : null,
        onClose,
        lockScroll: true,
    });

    return (
        <div
            className="pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-6"
            onClick={(event) => event.stopPropagation()}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="match-acceptance-title"
                aria-describedby="match-acceptance-status"
                tabIndex={-1}
                data-urgency={urgency}
                className="relative my-auto flex max-h-[94vh] w-full max-w-sm flex-col items-center overflow-y-auto rounded-2xl border border-[#262c33] bg-[#0f1418] px-5 py-6 text-center shadow-[0_24px_80px_rgba(0,0,0,.6)] sm:px-7"
            >
                {modeLabel && <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-display text-[10px] text-cyan-200">{modeLabel}</span>}
                <h1 id="match-acceptance-title" className={`mt-3 font-display text-3xl font-bold sm:text-4xl ${acceptedByMe ? "text-emerald-400" : "text-white"}`}>
                    {closing ? "CLOSING..." : acceptedByMe ? "ACCEPTED" : "MATCH FOUND"}
                </h1>

                <div
                    className="relative mx-auto mt-5 aspect-square w-[min(52vw,11rem)] shrink-0"
                    role="progressbar"
                    aria-label="Match acceptance time remaining"
                    aria-valuemin={0}
                    aria-valuemax={20}
                    aria-valuenow={Math.max(0, Math.min(20, remaining))}
                    aria-valuetext={timerLabel}
                >
                    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden="true">
                        <circle cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" stroke="#262c33" strokeWidth="9" />
                        <circle
                            cx={RING_CENTER}
                            cy={RING_CENTER}
                            r={RING_RADIUS}
                            fill="none"
                            stroke={ringColor}
                            strokeWidth="9"
                            strokeLinecap="round"
                            strokeDasharray={`${dashLength} ${RING_CIRCUMFERENCE}`}
                            strokeDashoffset="0"
                            transform={ringTransform}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-6xl font-bold leading-none tabular-nums" style={{ color: ringColor }} aria-hidden="true">
                            {closing ? "0" : remaining}
                        </span>
                        <span className="mt-1 text-[11px] text-slate-400" aria-hidden="true">{acceptedByMe ? "waiting for opponent" : "seconds to accept"}</span>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Ready check status">
                    <PlayerChip label="You" accepted={acceptedByMe} tone="you" />
                    {showOpponentChip && <PlayerChip label="Opponent" accepted={otherPlayerAccepted === true} tone="opponent" />}
                </div>

                <p id="match-acceptance-status" className="sr-only">
                    {acceptedByMe ? "Waiting for the other player." : otherPlayerAccepted ? "Your opponent is ready. Accept to enter the match." : "Accept to enter the match."}
                </p>
                <p className="sr-only" aria-live="polite" aria-atomic="true">
                    {closing
                        ? "Match acceptance is closing."
                        : `${announcementRemaining} seconds remaining.`}
                </p>
                {(statusMessage || error) && (
                    <p role={error ? "alert" : "status"} className="mt-3 text-xs text-amber-300">{error ?? statusMessage}</p>
                )}
                <button
                    ref={acceptButtonRef}
                    type="button"
                    onClick={onAccept}
                    disabled={!canAccept}
                    className={`mt-5 flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl border-b-[3px] font-display text-lg font-bold sm:min-h-12 ${acceptedByMe || accepting ? "cursor-default border-[#1a2026] bg-[#1b232a] text-slate-400" : "border-[#1f6b3f] bg-[#2fa866] text-white hover:bg-[#38bd74] disabled:cursor-not-allowed disabled:opacity-60"}`}
                >
                    {acceptedByMe || accepting ? "Waiting…" : (
                        <>
                            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                            ACCEPT
                        </>
                    )}
                </button>
                {acceptedByMe && <p className="mt-3 text-xs text-slate-500">The match starts when everyone accepts</p>}
                {onClose && (
                    <button type="button" onClick={onClose} className="mt-2 min-h-9 px-3 text-xs font-semibold text-slate-400 hover:text-slate-200">
                        {waiting ? "Cancel match" : "Decline"}
                    </button>
                )}
            </section>
        </div>
    );
}

function PlayerChip({ label, accepted, tone }) {
    return (
        <span className={`inline-flex items-center gap-2 rounded-lg border bg-[#12181d] px-2.5 py-1.5 text-xs font-semibold text-slate-200 ${accepted ? "border-emerald-400/60" : "border-[#262c33]"}`}>
            <span className={`h-4 w-4 rounded-full ${tone === "you" ? "bg-sky-600" : "bg-rose-700"}`} aria-hidden="true" />
            {label}
            {accepted ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-emerald-400" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Accepted"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-dashed border-slate-500" role="img" aria-label="Pending" />
            )}
        </span>
    );
}
