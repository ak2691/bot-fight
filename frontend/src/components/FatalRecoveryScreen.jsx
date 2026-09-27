import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context.js";

export default function FatalRecoveryScreen({
    title = "Unable to load this page",
    message = "Refresh the page to continue.",
    showRefresh = true,
    compact = false,
}) {
    const { isAuthenticated } = useAuth();
    const destination = isAuthenticated ? "/home" : "/login";
    const destinationLabel = isAuthenticated ? "Return home" : "Return to login";

    return (
        <main className={`${compact ? "h-full min-h-0" : "min-h-screen"} flex flex-col items-center justify-center gap-5 bg-arena-deep px-5 text-ink-muted`}>
            <h1 className="text-center font-mono text-sm font-bold tracking-[0.16em] text-white">{title}</h1>
            <p role="alert" className="max-w-xl text-center text-sm leading-6">{message}</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
                {showRefresh && (
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="border border-cyan-500/70 px-4 py-2 font-mono text-xs font-bold tracking-widest text-cyan-200 hover:bg-cyan-950/40"
                    >
                        Refresh page
                    </button>
                )}
                <Link to={destination} className="font-mono text-xs font-bold tracking-widest text-cyan-300 hover:text-white">
                    {destinationLabel}
                </Link>
            </div>
        </main>
    );
}
