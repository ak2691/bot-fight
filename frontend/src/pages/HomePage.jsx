import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppNavbar from "../components/AppNavbar";
import { apiUrl } from "../config/api";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import { loadAbilityCatalogue, loadBotRoom, loadConditionalCatalogue, loadMatchmaking, loadProfile } from "../routeLoaders";

const actions = [
    { id: "match", icon: "⚔", title: "Queue Match", copy: "Battle another player online", tone: "blue" },
    { id: "room", icon: "◇", title: "Open Bot Room", copy: "Build and test bots in the sandbox", tone: "blue" },
    { id: "abilities", icon: "⌘", title: "Ability List", copy: "Browse every draftable combat move", tone: "violet" },
    { id: "conditions", icon: "◆", title: "Conditional List", copy: "Explore the values your bot can read", tone: "violet" },
];

function formatQueueTime(elapsedSeconds) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function HomePage() {
    const navigate = useNavigate();
    const { isQueueing, queueElapsed, queueError, startQueue, cancelQueue } = useMatchmaking();
    const [activeMatchStatus, setActiveMatchStatus] = useState({
        loading: true,
        activeMatch: false,
        disconnected: false,
        error: null,
    });

    const refreshActiveMatchStatus = useCallback(async (signal) => {
        setActiveMatchStatus((current) => ({ ...current, loading: true, error: null }));
        try {
            const response = await fetch(apiUrl("/api/matches/active"), {
                credentials: "include",
                signal,
            });
            if (!response.ok) {
                throw new Error("active match status request failed");
            }
            const status = await response.json();
            setActiveMatchStatus({
                loading: false,
                activeMatch: status.activeMatch === true,
                disconnected: status.disconnected === true,
                error: null,
            });
        } catch (error) {
            if (error.name === "AbortError") return;
            setActiveMatchStatus({
                loading: false,
                activeMatch: false,
                disconnected: false,
                error: "Could not check your match status. Click to retry.",
            });
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void refreshActiveMatchStatus(controller.signal);
        return () => controller.abort();
    }, [refreshActiveMatchStatus]);

    useEffect(() => {
        const prefetchGameplay = () => void Promise.allSettled([loadAbilityCatalogue(), loadBotRoom(), loadConditionalCatalogue(), loadMatchmaking(), loadProfile(), import("../tutorial/TutorialPage")]);
        if ("requestIdleCallback" in window) {
            const idleId = window.requestIdleCallback(prefetchGameplay, { timeout: 3000 });
            return () => window.cancelIdleCallback(idleId);
        }
        const timeoutId = window.setTimeout(prefetchGameplay, 1000);
        return () => window.clearTimeout(timeoutId);
    }, []);

    let matchActionTitle = "Queue Match";
    let matchActionCopy = queueError ?? "Battle another player online";
    if (activeMatchStatus.loading) {
        matchActionTitle = "Checking Match Status...";
        matchActionCopy = "Confirming whether you have an unfinished match.";
    } else if (activeMatchStatus.error) {
        matchActionTitle = "Retry Match Status";
        matchActionCopy = activeMatchStatus.error;
    } else if (activeMatchStatus.activeMatch) {
        matchActionTitle = activeMatchStatus.disconnected
            ? "Reconnect to Match"
            : "Return to Match";
        matchActionCopy = activeMatchStatus.disconnected
            ? "Your connection was interrupted. Return before the grace period expires."
            : "Continue your unfinished match.";
    } else if (isQueueing) {
        matchActionTitle = "Looking for an opponent...";
        matchActionCopy = `Queued for ${formatQueueTime(queueElapsed)} · Click to cancel`;
    }

    const handleAction = (id) => {
        if (id === "match" && activeMatchStatus.loading) return;
        if (id === "match" && activeMatchStatus.error) {
            void refreshActiveMatchStatus();
            return;
        }
        if (id === "match" && activeMatchStatus.activeMatch) {
            navigate("/matchmaking");
        }
        if (id === "match" && !activeMatchStatus.activeMatch) {
            if (isQueueing) {
                cancelQueue();
            } else {
                startQueue();
            }
        }
        if (id === "room") navigate("/beta");
        if (id === "abilities") navigate("/ability-catalogue");
        if (id === "conditions") navigate("/conditionals");
    };

    return (
        <main className="home-grid home-dashboard min-h-screen overflow-hidden bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account />

            <section className="relative z-[1] mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[920px] flex-col justify-center px-5 py-10 sm:px-8">
                <div className="text-center">
                    <h1 className="home-title text-6xl font-bold leading-[.82] tracking-[-.04em] sm:text-8xl">
                        <span className="block text-cyan-400">BOT</span>
                        <span className="block text-fuchsia-400">FIGHT</span>
                    </h1>
                </div>

                <div className="mx-auto mt-12 grid w-full max-w-[800px] gap-4 sm:grid-cols-2">
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            onClick={() => handleAction(action.id)}
                            disabled={action.id === "match" && activeMatchStatus.loading}
                            className={`home-action home-action-${action.tone} group flex min-h-[116px] items-center gap-5 rounded-2xl border p-5 text-left shadow-[0_18px_40px_rgba(0,0,0,.2)] disabled:cursor-wait disabled:opacity-70`}
                        >
                            <span className="grid h-14 w-14 flex-none place-items-center rounded-xl border border-current/30 bg-black/20 text-3xl">{action.icon}</span>
                            <span>
                                <strong className="block text-xl text-white">
                                    {action.id === "match" ? matchActionTitle : action.title}
                                </strong>
                                <span className="mt-1 block text-sm text-slate-400">
                                    {action.id === "match" ? matchActionCopy : action.copy}
                                </span>
                            </span>

                        </button>
                    ))}
                </div>

                <button type="button" onClick={() => navigate("/tutorial")} className="mx-auto mt-7 border-0 bg-transparent px-4 py-2 text-sm font-semibold text-slate-400 hover:border-transparent hover:text-cyan-200">New to Bot Fight? <span className="text-cyan-300">Tutorial</span></button>
            </section>
        </main>
    );
}
