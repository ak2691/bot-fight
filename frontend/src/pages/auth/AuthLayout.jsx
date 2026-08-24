import { Link } from "react-router-dom";
import FloatingLogicBackground from "../../components/FloatingLogicBackground";

export default function AuthLayout({ title, subtitle, children, footer, showBrand = true, showPanel = true }) {
    return (
        <main className="auth-shell home-grid home-dashboard flex min-h-screen items-center justify-center overflow-x-clip px-4 py-8 font-ui text-ink-hi sm:px-6 sm:py-10">
            <FloatingLogicBackground />
            <div className="relative z-[2] flex w-full max-w-[420px] flex-col items-center">
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
        </main>
    );
}
