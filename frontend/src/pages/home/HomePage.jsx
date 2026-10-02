import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import FloatingLogicBackground from "../../components/FloatingLogicBackground";
import { useAuth } from "../../auth/auth-context";
import { loadAbilityCatalogue, loadConditionalCatalogue, loadMatch, loadProfile, loadTutorial } from "../../routeLoaders";
import { AbilityTileArt, ConditionalsTileIcon, PuzzleTileIcon } from "../../components/exploreTileArt.jsx";
import RankedMatchBlock from "./RankedMatchBlock.jsx";
import { useHomeProfile } from "./useHomeProfile.js";
import "./home.css";

export default function HomePage({ activeMatch = false, activeMatchId = null }) {
    const navigate = useNavigate();
    const { user, isGuest } = useAuth();
    const { profileStats, puzzlesSolved, totalPuzzles } = useHomeProfile(user, isGuest);

    useEffect(() => {
        const prefetchGameplay = () => void Promise.allSettled([loadAbilityCatalogue(), loadConditionalCatalogue(), loadMatch(), loadProfile(), loadTutorial()]);
        if ("requestIdleCallback" in window) {
            const idleId = window.requestIdleCallback(prefetchGameplay, { timeout: 3000 });
            return () => window.cancelIdleCallback(idleId);
        }
        const timeoutId = window.setTimeout(prefetchGameplay, 1000);
        return () => window.clearTimeout(timeoutId);
    }, []);

    const hasPuzzleProgress = puzzlesSolved !== null && totalPuzzles !== null && totalPuzzles > 0;
    const puzzleProgress = hasPuzzleProgress ? Math.min(100, Math.round((puzzlesSolved / totalPuzzles) * 100)) : 0;

    return (
        <main className="home-grid home-dashboard min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account currentPage="home" />

            <FloatingLogicBackground variant="home" />

            <section className="hq-page relative z-[2] mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1240px] flex-col items-center px-5 py-8 sm:px-8">
                <div className="hq-logo text-center">
                    <h1 className="home-title text-6xl font-bold leading-[.82] sm:text-8xl">
                        <span className="home-title-bot block">BOT</span>
                        <span className="home-title-fight block">FIGHT</span>
                    </h1>
                </div>

                <RankedMatchBlock activeMatch={activeMatch} activeMatchId={activeMatchId} profileStats={profileStats} />

                <nav className="hq-tiles" aria-label="Explore Bot Fight">
                    <button type="button" onClick={() => navigate("/puzzles")} className="hq-tile hq-tile--puzzles" aria-label="Open puzzles">
                        <span className="hq-tile__icon hq-tile__icon--puzzle"><PuzzleTileIcon /></span>
                        <span className="hq-tile__text">
                            <strong>Puzzles</strong>
                            <small>
                                {isGuest ? "Sign in to track progress" : puzzlesSolved === null
                                    ? "Logic challenges"
                                    : hasPuzzleProgress ? `${puzzlesSolved} of ${totalPuzzles} solved` : `${puzzlesSolved} solved`}
                            </small>
                            {hasPuzzleProgress && (
                                <span className="hq-tile__bar" role="progressbar" aria-label="Puzzles solved" aria-valuemin={0} aria-valuemax={totalPuzzles} aria-valuenow={puzzlesSolved}>
                                    <span style={{ width: `${puzzleProgress}%` }} />
                                </span>
                            )}
                        </span>
                    </button>
                    <button type="button" onClick={() => navigate("/ability-catalogue")} className="hq-tile hq-tile--abilities" aria-label="Open ability catalogue">
                        <AbilityTileArt />
                        <span className="hq-tile__text">
                            <strong>Abilities</strong>
                            <small>Every ability and its stats</small>
                        </span>
                    </button>
                    <button type="button" onClick={() => navigate("/conditionals")} className="hq-tile hq-tile--conditionals" aria-label="Open conditional catalogue">
                        <span className="hq-tile__icon hq-tile__icon--conditionals"><ConditionalsTileIcon /></span>
                        <span className="hq-tile__text">
                            <strong>Conditionals</strong>
                            <small>Every variable you can check</small>
                        </span>
                    </button>
                </nav>

                <p className="hq-footer">
                    New to Bot Fight?{" "}
                    <button type="button" onClick={() => navigate("/tutorial")} className="hq-footer__link" aria-label="Open tutorial">Start the tutorial</button>
                    {" · "}
                    <Link to="/credits" className="hq-footer__link">Credits</Link>
                </p>
            </section>
        </main>
    );
}
