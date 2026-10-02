import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import FloatingLogicBackground from "../../components/FloatingLogicBackground";
import landingVideoUrl from "../../assets/landingpage/newlandingpagevid-compressed.mp4";
import landingPosterUrl from "../../assets/landingpage/newlandingpagevid-poster.webp";
import "./auth.css";

// authTab: "login" | "register" shows the Log in | Sign up toggle at the top of the card.
const CARD_VISIBLE_RATIO = 0.3;

/**
 * Phone-only bottom bar on the showcase pages: "Log in to play" scrolls to the card (no input focus),
 * "play as guest" runs the page's guest login. It hides while the card is mostly on screen or an error shows.
 */
function useMobileBarVisibility(panelRef, enabled) {
    const [cardVisible, setCardVisible] = useState(false);
    const [errorVisible, setErrorVisible] = useState(false);

    useEffect(() => {
        const panel = panelRef.current;
        if (!enabled || !panel) return undefined;
        let observer = null;
        if (typeof IntersectionObserver !== "undefined") {
            observer = new IntersectionObserver(
                ([entry]) => setCardVisible(entry.intersectionRatio >= CARD_VISIBLE_RATIO),
                { threshold: [0, CARD_VISIBLE_RATIO, 0.6, 1] },
            );
            observer.observe(panel);
        }
        const checkErrors = () => setErrorVisible(Boolean(panel.querySelector(".auth-banner--error")));
        checkErrors();
        const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(checkErrors);
        mutations?.observe(panel, { childList: true, subtree: true });
        return () => {
            observer?.disconnect();
            mutations?.disconnect();
        };
    }, [enabled, panelRef]);

    return !cardVisible && !errorVisible;
}

export default function AuthLayout({ title, subtitle, children, footer, showBrand = true, showPanel = true, showcase = false, authTab = null, onPlayAsGuest = null, guestDisabled = false }) {
    const location = useLocation();
    const panelRef = useRef(null);
    const hasMobileBar = showcase && showPanel && typeof onPlayAsGuest === "function";
    const barVisible = useMobileBarVisibility(panelRef, hasMobileBar);
    const scrollToCard = () => {
        const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        panelRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    };
    return (
        <main className="auth-shell home-grid home-dashboard flex min-h-screen items-center justify-center overflow-x-clip px-4 py-8 font-ui text-ink-hi sm:px-6 sm:py-10">
            <FloatingLogicBackground variant="auth" />
            <div className={`auth-content relative z-[2] grid w-full items-start ${showcase ? "auth-content--showcase" : "auth-content--single"}`}>
                <div className="auth-column flex w-full flex-col items-center">
                    {showBrand && (
                        <Link
                            to="/"
                            aria-label="Bot Fight home"
                            className="auth-brand home-title block text-center font-bold leading-[.82]"
                        >
                            <span className="home-title-bot block">BOT</span>
                            <span className="home-title-fight block">FIGHT</span>
                        </Link>
                    )}

                    {showPanel ? (
                        <>
                            <section ref={panelRef} className="auth-panel w-full">
                                {authTab && (
                                    <nav className="auth-tabs" aria-label="Log in or sign up">
                                        <Link to="/login" state={location.state} className={authTab === "login" ? "is-active" : ""} aria-current={authTab === "login" ? "page" : undefined}>Log in</Link>
                                        <Link to="/register" state={location.state} className={authTab === "register" ? "is-active" : ""} aria-current={authTab === "register" ? "page" : undefined}>Sign up</Link>
                                    </nav>
                                )}

                                {(title || subtitle) && (
                                    <div className="auth-panel__heading">
                                        {title && <h1>{title}</h1>}
                                        {subtitle && <p>{subtitle}</p>}
                                    </div>
                                )}

                                {children}

                                {footer && <div className="auth-panel__footer">{footer}</div>}
                            </section>
                            <Link className="auth-credits" to="/credits">Credits</Link>
                        </>
                    ) : children}
                </div>

                {showcase && <AuthShowcase />}
            </div>
            {hasMobileBar && (
                <div className={`auth-mobile-bar ${barVisible ? "" : "is-hidden"}`} inert={!barVisible} data-testid="auth-mobile-bar">
                    <button type="button" className="auth-mobile-bar__primary" onClick={scrollToCard}>
                        {authTab === "register" ? "Sign up to play" : "Log in to play"} <span aria-hidden="true">&darr;</span>
                    </button>
                    <button type="button" className="auth-mobile-bar__guest" onClick={() => void onPlayAsGuest()} disabled={guestDisabled}>
                        or play as guest
                    </button>
                </div>
            )}
        </main>
    );
}

function AuthShowcase() {
    return (
        <section className="auth-showcase" aria-label="About Bot Fight">
            <p className="auth-tagline"><span>Program your bot.</span>{" "}<span>Watch it battle.</span></p>

            <div className="auth-video-frame">
                <video
                    className="auth-video"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    poster={landingPosterUrl}
                    aria-label="Bot Fight arena gameplay preview"
                >
                    <source src={landingVideoUrl} type="video/mp4" />
                </video>
            </div>

            <ol className="auth-steps" aria-label="How Bot Fight works">
                <li><span>01</span> Choose abilities</li>
                <li><span>02</span> Build logic</li>
                <li><span>03</span> Battle</li>
            </ol>
        </section>
    );
}
