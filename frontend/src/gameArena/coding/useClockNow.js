import { useEffect, useState } from "react";
import { monotonicEpochNowMs } from "../../matchmaking/networkDelayEstimator.js";
import { CLOCK_TICK_MS } from "../../matchmaking/buildClock.js";

/** Re-renders every 250 ms with the monotonic clock the build deadlines are normalized against. */
export default function useClockNow() {
    const [nowMs, setNowMs] = useState(() => monotonicEpochNowMs());
    useEffect(() => {
        const id = setInterval(() => setNowMs(monotonicEpochNowMs()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);
    return nowMs;
}

