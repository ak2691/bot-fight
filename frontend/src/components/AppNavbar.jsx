import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";

export default function AppNavbar({ account = false, currentPage = null, onHome = null, children = null }) {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const username = user?.username ?? "fighter";

    const handleLogout = async () => {
        await logout();
        navigate("/login", { replace: true });
    };

    return (
        <header className="relative z-10 flex min-h-[72px] flex-shrink-0 items-center justify-between border-b border-slate-700/60 bg-[#07111be8] px-5 font-interface text-slate-100 sm:px-8">
            <button type="button" onClick={() => onHome ? onHome() : navigate("/home")} className="flex items-center bg-transparent p-0 hover:border-transparent" aria-label="Go to home">
                <span className="grid h-11 w-11 place-items-center border border-cyan-400/70 bg-cyan-950/30 font-mono text-lg font-bold tracking-[.14em] text-cyan-300 [clip-path:polygon(25%_0,75%_0,100%_25%,100%_75%,75%_100%,25%_100%,0_75%,0_25%)]">BF</span>
            </button>

            {account ? (
                <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account navigation">
                    <button type="button" onClick={() => navigate("/profile")} aria-current={currentPage === "profile" ? "page" : undefined} className="flex items-center gap-3 border border-slate-600/60 bg-slate-900/30 px-3 py-2 text-sm font-bold text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200" aria-label={`Open ${username}'s profile`}>
                        <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-500/70 bg-slate-800 text-slate-300" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7">
                                <circle cx="12" cy="8" r="3.25" />
                                <path d="M5.75 19c.7-3.45 2.78-5.25 6.25-5.25s5.55 1.8 6.25 5.25" />
                            </svg>
                        </span>
                        <span className="max-w-32 truncate">{username}</span>
                    </button>
                    <div className="hidden h-8 w-px bg-slate-700 sm:block" />
                    <button type="button" onClick={handleLogout} className="border border-rose-400/20 bg-rose-950/10 px-4 py-2 text-sm font-bold text-rose-300 hover:border-rose-400/60">
                        ↪ <span className="ml-1 hidden sm:inline">Logout</span>
                    </button>
                </nav>
            ) : children}
        </header>
    );
}
