import { Link } from "react-router-dom";

export default function AuthLayout({ title, subtitle, children, footer }) {
    return (
        <main className="min-h-screen bg-arena-deep text-ink-hi font-ui flex items-center justify-center px-6">
            <section className="w-full max-w-[420px] border border-border-lo bg-arena-panel px-6 py-6 rounded">
                <div className="mb-6">
                    <Link to="/" className="inline-flex items-center gap-3 text-ink-white hover:text-cyan-200">
                        <span className="text-xl text-cyan leading-none">BF</span>
                        <span className="font-bold tracking-[0.15em]">BOT FIGHT</span>
                    </Link>
                    <h1 className="mt-6 text-2xl font-bold tracking-wide text-ink-white">{title}</h1>
                    <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>
                </div>

                {children}

                {footer && (
                    <div className="mt-5 text-sm text-ink-muted">
                        {footer}
                    </div>
                )}
            </section>
        </main>
    );
}
