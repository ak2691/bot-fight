import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { useNotifications } from "../notifications/notification-context";
import { useMatchmaking } from "../matchmaking/matchmaking-context";
import BotLogo from "./BotLogo.jsx";
import PartyPopover from "./PartyPopover.jsx";
import PlayerAvatar from "./PlayerAvatar.jsx";
import { Icon } from "./SocialBits.jsx";
import { formatRelativeTime } from "./relativeTime.js";
import { loadCachedProfileStats } from "../pages/profile/profileStatsCache.js";
import "./navbar.css";

export default function AppNavbar({ account = false, currentPage = null, onHome = null, children = null, inPageFlow = false }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const navbarRef = useRef(null);
    const { user, isAuthenticated, isGuest } = useAuth();
    const { isQueueing, pendingAcceptance, activeMatchStatus } = useMatchmaking();
    const {
        pendingPartyInvites,
        pendingCustomLobbyInvites,
        actionPendingInviteId,
        actionError,
        acceptPartyInvite,
        acceptCustomLobbyInvite,
        declinePartyInvite,
        declineCustomLobbyInvite,
    } = useNotifications();
    const notificationsPopoverRef = useRef(null);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [navbarVisibility, setNavbarVisibility] = useState({ pathname: null, hidden: false });
    const isHidden = navbarVisibility.pathname === pathname && navbarVisibility.hidden;
    const isCharcoalPage = ["profile", "puzzles", "puzzle-builder", "puzzle-play", "abilities", "conditionals", "tutorial", "chat-reports"].includes(currentPage);
    const username = user?.username ?? "bot";
    const pendingNotificationCount = pendingPartyInvites.length + pendingCustomLobbyInvites.length;
    const customLobbyEntryBlocked = Boolean(
        isQueueing || pendingAcceptance || activeMatchStatus?.activeMatch,
    );

    useEffect(() => {
        if (!notificationsOpen) return undefined;

        const handlePointerDown = (event) => {
            if (!notificationsPopoverRef.current?.contains(event.target)) setNotificationsOpen(false);
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") setNotificationsOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [notificationsOpen]);

    useEffect(() => {
        const navbar = navbarRef.current;
        if (!navbar) return undefined;

        const scrollTargets = [window];
        const pageRoot = navbar.closest(".arena-page-shell, main");
        const internalScrollContainer = pageRoot?.querySelector(".arena-content-shell");
        if (internalScrollContainer) scrollTargets.push(internalScrollContainer);
        const showAtScrollTop = inPageFlow ? 72 : 8;

        const lastScrollPositions = new Map(scrollTargets.map((target) => [target, getScrollTop(target)]));
        const handleScroll = (event) => {
            const target = event.currentTarget;
            const currentScrollTop = getScrollTop(target);
            const previousScrollTop = lastScrollPositions.get(target) ?? currentScrollTop;
            const scrollDelta = currentScrollTop - previousScrollTop;
            lastScrollPositions.set(target, currentScrollTop);

            if (currentScrollTop <= showAtScrollTop) {
                setNavbarVisibility({ pathname, hidden: false });
            } else if (Math.abs(scrollDelta) >= 3) {
                setNavbarVisibility({ pathname, hidden: scrollDelta > 0 });
            }
        };

        scrollTargets.forEach((target) => target.addEventListener("scroll", handleScroll, { passive: true }));
        return () => scrollTargets.forEach((target) => target.removeEventListener("scroll", handleScroll));
    }, [inPageFlow, pathname]);

    const profileCacheKey = user?.authenticated === true ? user.id ?? user.username : null;
    // Cached by the home and profile pages; read on each render so it follows the latest snapshot.
    const oneVsOneElo = account && !isGuest ? loadCachedProfileStats(profileCacheKey)?.ones?.elo ?? null : null;
    const [findPlayerQuery, setFindPlayerQuery] = useState("");
    const navLinks = [
        { id: "play", label: "Play", to: "/home", active: pathname === "/home" || currentPage === "home" },
        { id: "puzzles", label: "Puzzles", to: "/puzzles", active: pathname.startsWith("/puzzles") || pathname.startsWith("/admin/puzzles") },
        { id: "catalogue", label: "Catalogue", to: "/ability-catalogue", active: pathname.startsWith("/ability-catalogue") || pathname.startsWith("/conditionals") },
        { id: "tutorial", label: "Tutorial", to: "/tutorial", active: pathname.startsWith("/tutorial") },
    ];
    const profileActive = pathname.startsWith("/profile") || currentPage === "profile";

    // Sticky page controls (e.g. the catalogue search) sit below the navbar while it is showing.
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--app-navbar-offset", isHidden ? "0px" : "72px");
        return () => root.style.removeProperty("--app-navbar-offset");
    }, [isHidden]);

    useEffect(() => {
        if (!account) return undefined;
        document.body.classList.add("has-tabbar");
        return () => document.body.classList.remove("has-tabbar");
    }, [account]);

    const submitFindPlayer = (event) => {
        event.preventDefault();
        const query = findPlayerQuery.trim();
        if (query) navigate(`/profile/search?query=${encodeURIComponent(query)}`);
    };

    return (
        <div className={`app-navbar-slot ${inPageFlow ? "app-navbar-slot--in-page-flow" : ""}`}>
        <header ref={navbarRef} className={`app-navbar relative z-10 flex min-h-[72px] flex-shrink-0 items-center justify-between gap-3 border-b border-slate-600/80 bg-[#0e1a22] px-5 font-interface text-slate-100 sm:px-8 ${isCharcoalPage ? "app-navbar--charcoal-page" : ""} ${inPageFlow ? "app-navbar--in-page-flow" : ""} ${isHidden ? "app-navbar--hidden" : ""}`}>
            <button type="button" onClick={() => onHome ? onHome() : navigate("/home")} className="app-brand-link app-navbar-control flex h-12 items-center justify-center gap-2 px-0" aria-label="Go to home">
                <BotLogo className="h-12 w-12 object-contain" />
                <span className="nb-wordmark" aria-hidden="true"><span className="nb-wordmark__bot home-title-bot">BOT</span><span className="nb-wordmark__fight home-title-fight">FIGHT</span></span>
            </button>

            {account ? (
                <>
                    <nav className="nb-links" aria-label="Main navigation">
                        {navLinks.map((link) => (
                            <Link key={link.id} to={link.to} className={`nb-link ${link.active ? "is-active" : ""}`} aria-current={link.active ? "page" : undefined}>{link.label}</Link>
                        ))}
                    </nav>
                    <div className="nb-right">
                        <form onSubmit={submitFindPlayer} className="nb-search" role="search">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                            <label htmlFor="nb-find-player" className="sr-only">Find player</label>
                            <input id="nb-find-player" name="query" type="search" value={findPlayerQuery} onChange={(event) => setFindPlayerQuery(event.target.value)} maxLength={50} placeholder="Find player" autoComplete="off" className="nb-search__input" />
                        </form>
                        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account navigation">
                            <Link to="/profile/search" className="app-navbar-control app-navbar-icon-control nb-find-icon grid min-h-11 min-w-11 place-items-center text-slate-200" aria-label="Find player" title="Find player">
                                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                            </Link>
                            {!isGuest && <PartyPopover onOpen={() => setNotificationsOpen(false)} />}
                            {!isGuest && <div ref={notificationsPopoverRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() => setNotificationsOpen((open) => !open)}
                                    aria-expanded={notificationsOpen}
                                    title="Notifications"
                                    aria-label={pendingNotificationCount > 0
                                        ? `Open notifications, ${pendingNotificationCount} pending invite${pendingNotificationCount === 1 ? "" : "s"}`
                                        : "Open notifications"}
                                    className="app-navbar-control app-navbar-icon-control relative grid min-h-11 min-w-11 place-items-center text-slate-200"
                                >
                                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" aria-hidden="true">
                                        <path d="M6.8 10.3a5.2 5.2 0 0 1 10.4 0c0 5.6 2.2 6.1 2.2 7.1H4.6c0-1 2.2-1.5 2.2-7.1Z" />
                                        <path d="M9.8 20h4.4" />
                                    </svg>
                                    {pendingNotificationCount > 0 && (
                                        <span className="nb-unread" aria-hidden="true" />
                                    )}
                                </button>
                                {notificationsOpen && (
                                    <NotificationPanel
                                        partyInvites={pendingPartyInvites}
                                        customLobbyInvites={pendingCustomLobbyInvites}
                                        actionPendingInviteId={actionPendingInviteId}
                                        actionError={actionError}
                                        customLobbyEntryBlocked={customLobbyEntryBlocked}
                                        onAcceptParty={acceptPartyInvite}
                                        onAcceptCustomLobby={acceptCustomLobbyInvite}
                                        onDeclineParty={declinePartyInvite}
                                        onDeclineCustomLobby={declineCustomLobbyInvite}
                                    />
                                )}
                            </div>}
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
                            {user?.admin === true && (
                                <button
                                    type="button"
                                    onClick={() => navigate("/admin/chat-reports")}
                                    aria-current={currentPage === "chat-reports" ? "page" : undefined}
                                    aria-label="Open chat reports"
                                    title="Chat reports"
                                    className="app-navbar-control app-navbar-icon-control grid min-h-11 min-w-11 place-items-center text-amber-200"
                                >
                                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" aria-hidden="true">
                                        <path d="M4 5.5h16v12H9l-5 3v-15Z" />
                                        <path d="M12 8v4m0 3h.01" />
                                    </svg>
                                </button>
                            )}
                            <button type="button" onClick={() => navigate("/profile")} aria-current={profileActive ? "page" : undefined} className="app-navbar-control app-navbar-profile nb-profile flex min-h-11 min-w-0 items-center gap-2 px-2 py-1 text-sm font-bold text-slate-200" aria-label={`Open ${username}'s profile`}>
                                <PlayerAvatar name={username} size={30} />
                                <span className="nb-profile__text">
                                    <span className="nb-profile__name" title={username}>{username}</span>
                                    {oneVsOneElo != null && <span className="nb-profile__elo">{oneVsOneElo} ELO</span>}
                                </span>
                            </button>
                            {isGuest && !isAuthenticated && (
                                <button
                                    type="button"
                                    onClick={() => navigate("/login")}
                                    className="app-navbar-control nb-signin"
                                >
                                    Sign in
                                </button>
                            )}
                        </nav>
                    </div>
                </>
            ) : children}
        </header>
        {account && (
            <nav className="nb-tabbar" aria-label="Primary">
                {[
                    { id: "play", label: "Play", to: "/home", active: navLinks[0].active, icon: <path d="m14.5 4 5.5 5.5M4 20l8-8m-2-8-6 6 2 2 6-6Zm4 16 6-6-2-2-6 6Z" /> },
                    { id: "puzzles", label: "Puzzles", to: "/puzzles", active: navLinks[1].active, icon: <path d="M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h-1a2 2 0 1 0 0 4h1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3Z" /> },
                    { id: "catalogue", label: "Catalogue", to: "/ability-catalogue", active: navLinks[2].active, icon: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Zm0 13a3 3 0 0 1 3-3h11" /> },
                    { id: "tutorial", label: "Tutorial", to: "/tutorial", active: navLinks[3].active, icon: <path d="M12 3 2 8l10 5 10-5Zm-6 7.5V15c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" /> },
                    { id: "profile", label: "Profile", to: "/profile", active: profileActive, icon: <><circle cx="12" cy="8" r="3.25" /><path d="M5.75 19c.7-3.45 2.78-5.25 6.25-5.25s5.55 1.8 6.25 5.25" /></> },
                ].map((tab) => (
                    <Link key={tab.id} to={tab.to} className={`nb-tab ${tab.active ? "is-active" : ""}`} aria-current={tab.active ? "page" : undefined}>
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tab.icon}</svg>
                        <span>{tab.label}</span>
                    </Link>
                ))}
            </nav>
        )}
        </div>
    );
}

function getScrollTop(target) {
    return target === window ? window.scrollY || document.documentElement.scrollTop : target.scrollTop;
}

function NotificationPanel({
    partyInvites,
    customLobbyInvites,
    actionPendingInviteId,
    actionError,
    customLobbyEntryBlocked,
    onAcceptParty,
    onAcceptCustomLobby,
    onDeclineParty,
    onDeclineCustomLobby,
}) {
    const totalInvites = partyInvites.length + customLobbyInvites.length;
    const rows = [
        ...partyInvites.map((invite) => ({
            key: `party-${invite.inviteId}`,
            invite,
            text: "invited you to their party.",
            joinLabel: "Join party",
            blocked: false,
            onAccept: onAcceptParty,
            onDecline: onDeclineParty,
        })),
        ...customLobbyInvites.map((invite) => ({
            key: `custom-lobby-${invite.inviteId}`,
            invite,
            text: "invited you to a Custom Lobby.",
            joinLabel: "Join lobby",
            blocked: customLobbyEntryBlocked,
            onAccept: onAcceptCustomLobby,
            onDecline: onDeclineCustomLobby,
        })),
    ];
    return (
        <section className="absolute right-0 top-12 z-30 max-h-[min(32rem,calc(100vh-6rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-[#262c33] bg-[#0f1418] shadow-[0_18px_60px_rgba(0,0,0,.45)] game-popover" aria-label="Notifications">
            <div className="flex items-center justify-between gap-3 border-b border-[#262c33] px-3.5 py-3">
                <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-[#e6edf3]">
                    <Icon name="bell" className="h-4 w-4 text-cyan-300" />
                    Notifications
                </h2>
                {totalInvites > 0 && <span className="text-[11px] text-[#8b98a5]">{totalInvites} new</span>}
            </div>
            {actionError && <p className="border-b border-rose-400/30 bg-rose-950/20 px-3.5 py-2 text-xs text-rose-200" role="alert">{actionError}</p>}
            {totalInvites === 0 ? (
                <div className="flex flex-col items-center gap-2 px-3.5 py-7 text-[#8b98a5]">
                    <Icon name="bellOff" className="h-6 w-6" />
                    <p className="text-xs">You&apos;re all caught up</p>
                </div>
            ) : (
                <ul>
                    {rows.map(({ key, invite, text, joinLabel, blocked, onAccept, onDecline }) => {
                        const isPending = String(actionPendingInviteId) === String(invite.inviteId);
                        const relativeTime = formatRelativeTime(invite.createdAt);
                        const blockedMessage = "Leave ranked matchmaking or return to your active match before joining a custom lobby.";
                        return (
                            <li key={key} className="flex items-start gap-2.5 border-b border-[#1c2228] bg-[#151b21] px-3.5 py-3 last:border-b-0">
                                <PlayerAvatar name={invite.inviterUsername} size={32} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] leading-5 text-[#c9d3dc]">
                                        <span className="font-semibold text-[#e6edf3]">{invite.inviterUsername}</span> {text}
                                    </p>
                                    {relativeTime && <p className="text-[11px] text-[#8b98a5]">{relativeTime}</p>}
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            type="button"
                                            disabled={isPending || blocked}
                                            title={blocked ? blockedMessage : undefined}
                                            onClick={() => void onAccept(invite.inviteId)}
                                            className="min-h-8 rounded-md border-b-2 border-[#1d6f8a] bg-[#2a9cc4] px-3 text-xs font-bold text-white hover:bg-[#35aed8] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isPending ? "Joining..." : joinLabel}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPending}
                                            onClick={() => void onDecline(invite.inviteId)}
                                            className="min-h-8 rounded-md border border-[#262c33] px-3 text-xs font-semibold text-[#c9d3dc] hover:border-rose-400/60 hover:text-rose-200 disabled:cursor-wait disabled:opacity-50"
                                        >
                                            Decline
                                        </button>
                                    </div>
                                    {blocked && <p className="mt-2 text-[11px] text-amber-200" role="status">{blockedMessage}</p>}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
