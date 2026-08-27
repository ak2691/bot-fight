import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { useNotifications } from "../notifications/notification-context";
import BotLogo from "./BotLogo.jsx";

export default function AppNavbar({ account = false, currentPage = null, onHome = null, children = null }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const navbarRef = useRef(null);
    const { user } = useAuth();
    const {
        pendingInvites,
        actionPendingInviteId,
        actionError,
        acceptInvite,
        declineInvite,
    } = useNotifications();
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [navbarVisibility, setNavbarVisibility] = useState({ pathname: null, hidden: false });
    const isHidden = navbarVisibility.pathname === pathname && navbarVisibility.hidden;
    const isCharcoalPage = ["profile", "puzzles", "puzzle-builder", "puzzle-play", "abilities", "conditionals"].includes(currentPage);
    const username = user?.username ?? "bot";

    useEffect(() => {
        const navbar = navbarRef.current;
        if (!navbar) return undefined;

        const scrollTargets = [window];
        const pageRoot = navbar.closest(".arena-page-shell, main");
        const internalScrollContainer = pageRoot?.querySelector(".arena-content-shell");
        if (internalScrollContainer) scrollTargets.push(internalScrollContainer);

        const lastScrollPositions = new Map(scrollTargets.map((target) => [target, getScrollTop(target)]));
        const handleScroll = (event) => {
            const target = event.currentTarget;
            const currentScrollTop = getScrollTop(target);
            const previousScrollTop = lastScrollPositions.get(target) ?? currentScrollTop;
            const scrollDelta = currentScrollTop - previousScrollTop;
            lastScrollPositions.set(target, currentScrollTop);

            if (currentScrollTop <= 8) {
                setNavbarVisibility({ pathname, hidden: false });
            } else if (Math.abs(scrollDelta) >= 3) {
                setNavbarVisibility({ pathname, hidden: scrollDelta > 0 });
            }
        };

        scrollTargets.forEach((target) => target.addEventListener("scroll", handleScroll, { passive: true }));
        return () => scrollTargets.forEach((target) => target.removeEventListener("scroll", handleScroll));
    }, [pathname]);

    return (
        <div className="app-navbar-slot">
        <header ref={navbarRef} className={`app-navbar relative z-10 flex min-h-[72px] flex-shrink-0 items-center justify-between gap-3 border-b border-slate-600/80 bg-[#0e1a22] px-5 font-interface text-slate-100 sm:px-8 ${isCharcoalPage ? "app-navbar--charcoal-page" : ""} ${isHidden ? "app-navbar--hidden" : ""}`}>
            <button type="button" onClick={() => onHome ? onHome() : navigate("/home")} className="app-brand-link app-navbar-control flex h-12 w-12 items-center justify-center" aria-label="Go to home">
                <BotLogo className="h-12 w-12 object-contain" />
            </button>

            {account ? (
                <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account navigation">
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setNotificationsOpen((open) => !open)}
                            aria-expanded={notificationsOpen}
                            aria-label={pendingInvites.length > 0
                                ? `Open notifications, ${pendingInvites.length} pending duel invite${pendingInvites.length === 1 ? "" : "s"}`
                                : "Open notifications"}
                            className="app-navbar-control app-navbar-icon-control relative grid min-h-11 min-w-11 place-items-center text-slate-200"
                        >
                            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" aria-hidden="true">
                                <path d="M6.8 10.3a5.2 5.2 0 0 1 10.4 0c0 5.6 2.2 6.1 2.2 7.1H4.6c0-1 2.2-1.5 2.2-7.1Z" />
                                <path d="M9.8 20h4.4" />
                            </svg>
                            {pendingInvites.length > 0 && (
                                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border border-[#07111b] bg-fuchsia-400 px-1 text-[10px] font-black text-[#07111b]">
                                    {pendingInvites.length > 9 ? "9+" : pendingInvites.length}
                                </span>
                            )}
                        </button>
                        {notificationsOpen && (
                            <NotificationPanel
                                invites={pendingInvites}
                                actionPendingInviteId={actionPendingInviteId}
                                actionError={actionError}
                                onAccept={acceptInvite}
                                onDecline={declineInvite}
                            />
                        )}
                    </div>
                    {user?.admin === true && (
                        <button
                            type="button"
                            onClick={() => navigate("/admin/puzzles/new")}
                            aria-current={currentPage === "puzzle-builder" ? "page" : undefined}
                            aria-label="Open puzzle builder"
                            title="Puzzle builder"
                            className="app-navbar-control app-navbar-icon-control app-navbar-puzzle-builder grid min-h-11 min-w-11 place-items-center text-cyan-200"
                        >
                            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" aria-hidden="true">
                                <path d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v9a2.75 2.75 0 0 1-2.75 2.75h-9a2.75 2.75 0 0 1-2.75-2.75v-9a2.75 2.75 0 0 1 2.75-2.75Z" />
                                <path d="M12 8v8M8 12h8" />
                                <path d="M9.25 4.75v-1.5h5.5v1.5" />
                            </svg>
                        </button>
                    )}
                    <button type="button" onClick={() => navigate("/profile")} aria-current={currentPage === "profile" ? "page" : undefined} className="app-navbar-control app-navbar-profile flex min-h-11 min-w-0 items-center gap-3 px-3 py-2 text-sm font-bold text-slate-200" aria-label={`Open ${username}'s profile`}>
                        <span className="app-navbar-profile-avatar grid h-8 w-8 place-items-center rounded-full border border-slate-400/80 text-slate-200" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7">
                                <circle cx="12" cy="8" r="3.25" />
                                <path d="M5.75 19c.7-3.45 2.78-5.25 6.25-5.25s5.55 1.8 6.25 5.25" />
                            </svg>
                        </span>
                        <span className="hidden max-w-32 truncate sm:block">{username}</span>
                    </button>
                </nav>
            ) : children}
        </header>
        </div>
    );
}

function getScrollTop(target) {
    return target === window ? window.scrollY || document.documentElement.scrollTop : target.scrollTop;
}

function NotificationPanel({
    invites,
    actionPendingInviteId,
    actionError,
    onAccept,
    onDecline,
}) {
    return (
        <section className="absolute right-0 top-12 z-30 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-cyan-800/80 bg-[#091521f5] p-3 shadow-[0_18px_60px_rgba(0,0,0,.45)]" aria-label="Notifications">
            <div className="flex items-center justify-between gap-3 px-2 pb-2">
                <h2 className="font-mono text-[10px] font-bold tracking-[.2em] text-cyan-400">NOTIFICATIONS</h2>
                <span className="text-xs text-slate-500">{invites.length} pending</span>
            </div>
            {actionError && <p className="border border-rose-400/30 bg-rose-950/20 px-3 py-2 text-xs text-rose-200" role="alert">{actionError}</p>}
            {invites.length === 0 ? (
                <p className="px-2 py-5 text-sm text-slate-500">No pending notifications.</p>
            ) : (
                <div className="space-y-2">
                    {invites.map((invite) => {
                        const isPending = String(actionPendingInviteId) === String(invite.inviteId);
                        return (
                            <article key={invite.inviteId} className="rounded-lg border border-slate-700/80 bg-slate-950/30 p-3">
                                <p className="text-sm leading-5 text-slate-200">
                                    <span className="font-bold text-white">{invite.inviterUsername}</span> challenged you to a 1v1.
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => void onAccept(invite.inviteId)}
                                        className="min-h-9 flex-1 border border-emerald-400/50 bg-emerald-950/30 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:border-emerald-300 disabled:cursor-wait disabled:opacity-50"
                                    >
                                        {isPending ? "Connecting..." : "Accept"}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => void onDecline(invite.inviteId)}
                                        className="min-h-9 flex-1 border border-slate-600 bg-slate-900/40 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-rose-400/60 hover:text-rose-200 disabled:cursor-wait disabled:opacity-50"
                                    >
                                        Decline
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
