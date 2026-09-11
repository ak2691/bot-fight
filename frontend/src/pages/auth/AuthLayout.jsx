import { Link } from "react-router-dom";
import FloatingLogicBackground from "../../components/FloatingLogicBackground";
import landingVideoUrl from "../../assets/landingpage/videoforbotfight.mp4";
import landingPosterUrl from "../../assets/landingpage/videoforbotfight-poster.webp";

export default function AuthLayout({ title, subtitle, children, footer, showBrand = true, showPanel = true, showcase = false }) {
    return (
        <main className="auth-shell home-grid home-dashboard flex min-h-screen items-center justify-center overflow-x-clip px-4 py-8 font-ui text-ink-hi sm:px-6 sm:py-10">
            <FloatingLogicBackground />
            <div className={`auth-content relative z-[2] grid w-full items-center ${showcase ? "auth-content--showcase" : "max-w-[420px]"}`}>
                <div className="flex w-full flex-col items-center">
                    {showBrand && (
                        <Link
                            to="/"
                            aria-label="Bot Fight home"
                            className="auth-brand home-title mb-8 block text-center text-6xl font-bold leading-[.82] tracking-[-.04em] sm:mb-10 sm:text-8xl"
                        >
                            <span className="home-title-bot block">BOT</span>
                            <span className="home-title-fight block">FIGHT</span>
                        </Link>
                    )}

                    {showPanel ? (
                        <section className="auth-panel w-full rounded-2xl border border-slate-600/80 bg-[#081824]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,.48)] backdrop-blur-sm sm:p-8">
                            {(title || subtitle) && (
                                <div className="mb-6">
                                    {title && <h1 className="text-2xl font-bold tracking-wide text-ink-white">{title}</h1>}
                                    {subtitle && <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>}
                                </div>
                            )}

                            {children}

                            {footer && (
                                <div className="mt-6 text-sm text-ink-muted">
                                    {footer}
                                </div>
                            )}

                            <div className="mt-4 text-center text-sm text-ink-muted">
                                <Link className="text-cyan-300 hover:text-cyan-100" to="/credits">Credits</Link>
                            </div>
                        </section>
                    ) : children}
                </div>

                {showcase && <AuthShowcase />}
            </div>
        </main>
    );
}

function AuthShowcase() {
    return (
        <section className="auth-showcase" aria-label="About Bot Fight">
            <div className="auth-showcase-copy">
                <p className="auth-showcase-tagline"><span>Program your bot.</span>{" "}<span>Watch it battle.</span></p>
            </div>

            <div className="auth-showcase-video-frame">
                <video
                    className="auth-showcase-video"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    poster={landingPosterUrl}
                    aria-label="Bot Fight arena gameplay preview"
                >
                    <source src={landingVideoUrl} type="video/mp4" />
                </video>
            </div>

            <ol className="auth-showcase-steps" aria-label="How Bot Fight works">
                <li><span>01</span> Choose abilities</li>
                <li><span>02</span> Build logic</li>
                <li><span>03</span> Battle</li>
            </ol>
        </section>
    );
}
