import { useEffect, useState } from "react";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import SpinningBotFace from "./SpinningBotFace.jsx";

const TIP_DELAY_MS = 1000;
// Short, accurate gameplay tips (each mirrors a rule explained in the tutorial).
export const LOADING_TIPS = Object.freeze([
    "Conditions on one node all have to be true. Use ELSE IF for \"or\".",
    "Roots run left to right: the leftmost root has priority 1.",
    "A bot can select at most one movement, one rotation and one ability per tick.",
    "A timeout is a draw. A win requires defeating the opponent through HP damage.",
    "Only drafted or equipped abilities can execute, so test with your drafted loadout.",
    "Conditionals on the same level are checked left to right; the first true one wins.",
]);

/**
 * progress: 0-1 for a determinate bar, or null for an indeterminate one.
 * detail: muted line under the bar, e.g. "Ability art 62%".
 */
export default function ArenaLoadingScreen({ endsAtMs = null, label = "Loading the arena", overlay = false, progress = null, detail = null }) {
    const [remainingMs, setRemainingMs] = useState(() => remainingUntil(endsAtMs));
    const [tip] = useState(() => LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]);
    const [showTip, setShowTip] = useState(false);
    const determinate = Number.isFinite(progress);
    const percent = determinate ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;

    useEffect(() => {
        if (!endsAtMs) return undefined;
        const update = () => setRemainingMs(remainingUntil(endsAtMs));
        update();
        const interval = setInterval(update, 100);
        return () => clearInterval(interval);
    }, [endsAtMs]);

    // Fast loads never reach the tip, so it does not flash.
    useEffect(() => {
        const timeoutId = setTimeout(() => setShowTip(true), TIP_DELAY_MS);
        return () => clearTimeout(timeoutId);
    }, []);

    return (
        <main className={`${overlay ? "absolute inset-0 z-20" : "min-h-screen"} flex flex-col items-center justify-center gap-3 bg-arena-deep px-4 text-ink-muted`}>
            <SpinningBotFace className="h-14 w-14" />
            <p role="status" className="font-display text-lg font-bold text-white">{label}</p>
            <div
                className="h-1 w-[220px] max-w-full overflow-hidden rounded-full bg-[#262c33]"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
            >
                <div
                    className={`h-full rounded-full bg-[#3aa6c9] ${determinate ? "transition-[width] duration-300" : "arena-loading-indeterminate w-2/5"}`}
                    style={determinate ? { width: `${percent}%` } : undefined}
                />
            </div>
            {detail && <p className="text-xs text-slate-500">{detail}</p>}
            {endsAtMs && <p className="font-display text-xs text-cyan-300">{Math.ceil(remainingMs / 1000)}s</p>}
            <p
                className={`mt-3 max-w-[18rem] rounded-lg border border-[#262c33] bg-[#0f1418] px-3 py-2 text-center text-xs leading-5 text-slate-300 transition-opacity duration-500 ${showTip ? "opacity-100" : "opacity-0"}`}
                aria-hidden={!showTip}
            >
                <strong className="mr-1.5 text-[10px] font-bold text-amber-300">TIP</strong>{tip}
            </p>
        </main>
    );
}

function remainingUntil(endsAtMs) {
    if (!endsAtMs) return 0;
    return Math.max(0, Number(endsAtMs) - monotonicEpochNowMs());
}
