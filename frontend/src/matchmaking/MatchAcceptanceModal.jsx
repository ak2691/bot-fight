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

export default function MatchAcceptanceModal({
    remaining,
    authoritativeRemaining = 0,
    deadlineMs = null,
    visibleStartMs = null,
    acceptanceState,
    otherPlayerAccepted,
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
        : waiting
            ? "Waiting for the other player."
            : accepting
                ? "Accepting..."
                : otherPlayerAccepted
                    ? "Your opponent accepted. Accept to enter the match."
                    : "Accept to enter the match.";
    const buttonLabel = waiting
        ? "WAITING FOR PLAYER"
        : accepting
            ? "ACCEPTING..."
            : "Accept";

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
            className="pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-[#02070de8] p-3 sm:p-6"
            onClick={(event) => event.stopPropagation()}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="match-acceptance-title"
                aria-describedby="match-acceptance-status"
                tabIndex={-1}
                className="relative my-auto flex max-h-[94vh] w-full max-w-2xl flex-col overflow-y-auto rounded border border-slate-500/70 bg-[#081522] px-5 py-7 text-center sm:px-10 sm:py-10"
            >
                <h1 id="match-acceptance-title" className="font-display-action text-4xl tracking-wide text-white sm:text-6xl">
                    {closing ? "Closing..." : "Match Found"}
                </h1>

                <div
                    className="relative mx-auto mt-7 aspect-square w-[min(74vw,21rem)] shrink-0"
                    role="progressbar"
                    aria-label="Match acceptance time remaining"
                    aria-valuemin={0}
                    aria-valuemax={20}
                    aria-valuenow={Math.max(0, Math.min(20, remaining))}
                    aria-valuetext={timerLabel}
                >
                    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden="true">
                        <circle
                            cx={RING_CENTER}
                            cy={RING_CENTER}
                            r={RING_RADIUS}
                            fill="none"
                            stroke="rgb(30 64 175 / 0.45)"
                            strokeWidth="7"
                        />
                        <circle
                            cx={RING_CENTER}
                            cy={RING_CENTER}
                            r={RING_RADIUS}
                            fill="none"
                            stroke="rgb(56 189 248)"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeDasharray={`${dashLength} ${RING_CIRCUMFERENCE}`}
                            strokeDashoffset="0"
                            transform={ringTransform}
                        />
                    </svg>
                    <div className="absolute inset-0 grid place-items-center">
                        <span className="font-display-action text-7xl font-bold leading-none text-white sm:text-8xl" aria-hidden="true">
                            {closing ? "0" : remaining}
                        </span>
                    </div>
                </div>

                <p className="mt-5 font-display-action text-2xl text-white sm:text-3xl">Opponent Found</p>
                <p id="match-acceptance-status" className="mt-2 text-base text-slate-300 sm:text-lg">{statusMessage}</p>
                <p className="sr-only" aria-live="polite" aria-atomic="true">
                    {closing
                        ? "Match acceptance is closing."
                        : `${announcementRemaining} seconds remaining.`}
                </p>
                {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
                <button
                    ref={acceptButtonRef}
                    type="button"
                    onClick={onAccept}
                    disabled={!canAccept}
                    className="mt-7 min-h-20 w-full rounded border border-cyan-300/90 bg-cyan-950/35 px-6 py-4 font-display-action text-2xl tracking-wider text-white transition hover:border-cyan-100 hover:bg-cyan-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none sm:text-3xl"
                >
                    {buttonLabel}
                </button>
            </section>
        </div>
    );
}
