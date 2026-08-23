import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import FloatingLogicBackground from "../../components/FloatingLogicBackground";
import { useMatchmaking } from "../../matchmaking/matchmaking-context";
import { loadAbilityCatalogue, loadConditionalCatalogue, loadMatch, loadProfile, loadTutorial } from "../../routeLoaders";

const actions = [
    { id: "match", title: "Queue Match", tone: "blue", icon: "/assets/homepage/queue-icon%20(1).svg" },
    { id: "room", title: "Practice Room", tone: "blue", icon: "/assets/homepage/business-management-icon.svg" },
    {
        id: "abilities",
        title: "Ability List",
        tone: "teal",
        icons: [
            "/assets/ability-list/icons/temporal_rewind.png",
            "/assets/ability-list/icons/rail_shot.png",
            "/assets/ability-list/icons/shoot_fireball.png",
        ],
    },
    { id: "conditions", title: "Conditional List", tone: "blue", icon: "/assets/homepage/book-icon.svg" },
];

function formatQueueTime(elapsedSeconds) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function HomeActionIcon({ action }) {
    if (action.icons) {
        return <span className="home-action-ability-icons" aria-hidden="true">
            {action.icons.map((icon, index) => <span className={`home-action-ability-card home-action-ability-card-${index + 1}`} key={icon}>
                <img src={icon} alt="" />
            </span>)}
        </span>;
    }

    return <span className="home-action-icon" aria-hidden="true"><img src={action.icon} alt="" /></span>;
}

export default function HomePage({ activeMatch = false, activeMatchId = null }) {
    const navigate = useNavigate();
    const { isQueueing, queueElapsed, startQueue, cancelQueue } = useMatchmaking();

    useEffect(() => {
        const prefetchGameplay = () => void Promise.allSettled([loadAbilityCatalogue(), loadConditionalCatalogue(), loadMatch(), loadProfile(), loadTutorial()]);
        if ("requestIdleCallback" in window) {
            const idleId = window.requestIdleCallback(prefetchGameplay, { timeout: 3000 });
            return () => window.cancelIdleCallback(idleId);
        }
        const timeoutId = window.setTimeout(prefetchGameplay, 1000);
        return () => window.clearTimeout(timeoutId);
    }, []);

    const matchActionTitle = activeMatch
        ? "Return to match"
        : isQueueing
            ? `Searching · ${formatQueueTime(queueElapsed)}`
            : "Queue Match";

    const handleAction = (id) => {
        if (id === "match") {
            if (activeMatch) {
                navigate("/match", {
                    state: {
                        activeMatchVerified: true,
                        matchId: activeMatchId,
                    },
                });
                return;
            }
            if (isQueueing) {
                cancelQueue();
            } else {
                startQueue();
            }
        }
        if (id === "room") navigate("/practice");
        if (id === "abilities") navigate("/ability-catalogue");
        if (id === "conditions") navigate("/conditionals");
    };

    return (
        <main className="home-grid home-dashboard min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account />

            <FloatingLogicBackground />

            <section className="relative z-[2] mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1240px] flex-col justify-center px-5 py-8 sm:px-8">
                <div className="text-center">
                    <h1 className="home-title text-6xl font-bold leading-[.82] tracking-[-.04em] sm:text-8xl">
                        <span className="home-title-bot block">BOT</span>
                        <span className="home-title-fight block">FIGHT</span>
                    </h1>
                </div>

                <div className="mx-auto mt-10 grid w-full max-w-[860px] gap-4 sm:grid-cols-2">
                    {actions.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            onClick={() => handleAction(action.id)}
                            className={`home-action home-action-${action.tone} group flex min-h-[92px] items-center justify-center gap-5 rounded-xl p-4 text-left shadow-[0_18px_40px_rgba(0,0,0,.2)] disabled:cursor-wait disabled:opacity-70`}
                        >
                            <HomeActionIcon action={action} />
                            <span>
                                <strong className={`block leading-tight text-white ${action.id === "match" ? "text-sm whitespace-nowrap" : "text-base"}`}>
                                    {action.id === "match" ? matchActionTitle : action.title}
                                </strong>
                            </span>

                        </button>
                    ))}
                </div>

                <div className="mx-auto mt-7 flex flex-wrap items-center justify-center gap-3">
                    <button type="button" onClick={() => navigate("/puzzles")} className="home-tutorial-button inline-flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-cyan-200" aria-label="Open puzzles">
                        <span className="grid h-7 w-7 place-items-center" aria-hidden="true">
                            <img src="/assets/homepage/puzzle-icon.png" alt="" className="h-6 w-6 brightness-0 invert" />
                        </span>
                        <span>Puzzles</span>
                    </button>
                    <button type="button" onClick={() => navigate("/tutorial")} className="home-tutorial-button min-h-11 px-4 py-2 text-sm font-semibold text-slate-400 hover:text-cyan-200">New to Bot Fight? <span className="text-cyan-300">Tutorial</span></button>
                </div>
                <Link to="/credits" className="mx-auto mt-2 inline-flex min-h-11 items-center px-4 py-2 text-sm font-semibold text-slate-500 hover:border-transparent hover:text-cyan-200">Credits</Link>
            </section>
        </main>
    );
}
