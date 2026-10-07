import { clockTone, formatClockMs, playerClockView } from "../../matchmaking/buildClock.js";
import useClockNow from "./useClockNow.js";

function teamOf(player) {
    const team = Number(player?.teamNumber);
    return Number.isFinite(team) && team > 0 ? team : Number(player?.slot) === 1 ? 1 : 2;
}

/**
 * One chess clock per player: yours counts down (amber under 30 s, red under 10 s); a player who has
 * submitted shows "Submitted" with their clock frozen, and one still building shows a running clock.
 */
export default function BuildClocks({ players = [], selfUserId = null }) {
    const nowMs = useClockNow();
    if (!players.length) return null;
    const ordered = [...players].sort((first, second) => {
        const firstSelf = String(first.userId) === String(selfUserId);
        const secondSelf = String(second.userId) === String(selfUserId);
        return Number(secondSelf) - Number(firstSelf) || teamOf(first) - teamOf(second) || Number(first.slot) - Number(second.slot);
    });
    return (
        <ul className="hud-clocks" aria-label="Build clocks">
            {ordered.map((player) => {
                const self = String(player.userId) === String(selfUserId);
                const view = playerClockView(player, nowMs);
                const tone = self && view.running ? clockTone(view.remainingMs) : "normal";
                return (
                    <li key={player.userId ?? player.slot} className={`hud-clock hud-clock--team${teamOf(player)} ${self ? "is-self" : ""} is-${tone} ${view.submitted ? "is-submitted" : ""}`}>
                        <span className="hud-clock__name">{player.username ?? "Player"}</span>
                        {self && <span className="hud-clock__you">You</span>}
                        {view.submitted && <span className="hud-clock__state">Submitted</span>}
                        <time className="hud-clock__time" role="timer" aria-label={`${player.username ?? "Player"} clock`}>{formatClockMs(view.remainingMs)}</time>
                    </li>
                );
            })}
        </ul>
    );
}

/** After you submit: whose clock is still running, so the wait is never a blank screen. */
export function BuildWaiting({ players = [], selfUserId = null }) {
    const nowMs = useClockNow();
    const self = players.find((candidate) => String(candidate.userId) === String(selfUserId));
    const waitingOn = players.filter((player) => teamOf(player) !== teamOf(self) && !player.finished);
    const first = waitingOn[0] ?? null;
    const view = first ? playerClockView(first, nowMs) : null;
    return (
        <div className="hud-wait" role="status" aria-live="polite">
            <span className="hud-wait__title">Submitted</span>
            {first ? (
                <>
                    <span className="hud-wait__body">Waiting for {waitingOn.map((player) => player.username ?? "Opponent").join(", ")}</span>
                    <time className="hud-wait__time" role="timer" aria-label={`${first.username ?? "Opponent"} clock`}>{formatClockMs(view.remainingMs)}</time>
                </>
            ) : (
                <span className="hud-wait__body">Everyone has submitted. Preparing the replay</span>
            )}
        </div>
    );
}

/** Shown when your own clock has run out but a submission can still arrive. */
export function BuildOutOfTime({ player }) {
    const nowMs = useClockNow();
    const view = playerClockView(player, nowMs);
    if (!view.running || view.remainingMs > 0) return null;
    return (
        <div role="status" aria-live="polite" className="hud-notice hud-notice--cyan">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/80" aria-hidden="true" />
            Out of time, preparing the replay
        </div>
    );
}
