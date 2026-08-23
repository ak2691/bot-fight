import { useEffect, useState } from "react";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";
import SpinningBotFace from "./SpinningBotFace.jsx";

export default function ArenaLoadingScreen({ endsAtMs = null, label = "Loading...", overlay = false, error = null, onRetry = null }) {
    const [remainingMs, setRemainingMs] = useState(() => remainingUntil(endsAtMs));

    useEffect(() => {
        if (!endsAtMs) return undefined;
        const update = () => setRemainingMs(remainingUntil(endsAtMs));
        update();
        const interval = setInterval(update, 100);
        return () => clearInterval(interval);
    }, [endsAtMs]);

    return (
        <main className={`${overlay ? "absolute inset-0 z-20" : "min-h-screen"} flex flex-col items-center justify-center gap-4 bg-arena-deep text-ink-muted`}>
            <SpinningBotFace />
            <p role="status" className="font-mono text-xs tracking-[0.25em]">{label}</p>
            {endsAtMs && <p className="font-mono text-xs text-cyan-300">{Math.ceil(remainingMs / 1000)}s</p>}
            {error && <p role="alert" className="max-w-sm text-center font-mono text-[11px] text-rose-300">{error.message ?? String(error)}</p>}
            {onRetry && <button type="button" onClick={onRetry} className="border-b border-cyan-400/50 px-1 py-1 font-mono text-[11px] uppercase tracking-[.14em] text-cyan-200 hover:border-cyan-200 hover:text-white">Retry Loading</button>}
        </main>
    );
}

function remainingUntil(endsAtMs) {
    if (!endsAtMs) return 0;
    return Math.max(0, Number(endsAtMs) - monotonicEpochNowMs());
}
