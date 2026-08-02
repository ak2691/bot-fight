import { useEffect, useState } from "react";
import { monotonicEpochNowMs } from "../matchmaking/networkDelayEstimator.js";

export default function ArenaLoadingScreen({ endsAtMs = null, label = "Loading...", overlay = false }) {
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
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-300" aria-hidden="true" />
            <p role="status" className="font-mono text-xs tracking-[0.25em]">{label}</p>
            {endsAtMs && <p className="font-mono text-xs text-cyan-300">{Math.ceil(remainingMs / 1000)}s</p>}
        </main>
    );
}

function remainingUntil(endsAtMs) {
    if (!endsAtMs) return 0;
    return Math.max(0, Number(endsAtMs) - monotonicEpochNowMs());
}
