import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context.js";
import AppNavbar from "../components/AppNavbar.jsx";

/** Static bot face for the 404: tilted, with mismatched eyes and a flat, crooked mouth. */
function ConfusedBotFace() {
    return (
        <svg viewBox="0 0 100 100" className="h-24 w-24" style={{ transform: "rotate(-14deg)" }} aria-hidden="true">
            <circle cx="50" cy="50" r="48" fill="#8b98a5" />
            <circle cx="34" cy="46" r="5" fill="#0b1014" />
            <circle cx="66" cy="38" r="6.5" fill="#0b1014" />
            <path d="M36 66 L62 58" stroke="#0b1014" strokeWidth="4" strokeLinecap="round" />
        </svg>
    );
}

export default function NotFoundPage() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    return (
        <div className="flex min-h-screen flex-col bg-arena-deep text-ink-hi font-ui">
            {isAuthenticated ? <AppNavbar account /> : <AppNavbar onHome={() => navigate("/login")} />}
            <main className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-16 text-center">
                <ConfusedBotFace />
                <p className="font-display text-6xl font-bold leading-none text-[#57b8ff]">404</p>
                <h1 className="font-display text-2xl font-bold text-white">This bot took a wrong turn</h1>
                <p className="max-w-[340px] text-sm leading-6 text-slate-400">
                    The page you&apos;re looking for doesn&apos;t exist or has moved.
                </p>
                <Link
                    to={isAuthenticated ? "/home" : "/login"}
                    className="mt-2 inline-flex min-h-11 items-center rounded-xl border-b-[3px] border-[#0f5f78] bg-[#2088ac] px-6 font-display text-sm font-bold text-white hover:brightness-110"
                >
                    GO HOME
                </Link>
            </main>
        </div>
    );
}
