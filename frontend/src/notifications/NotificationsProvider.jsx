import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { apiUrl } from "../config/api";
import { ensureCsrfHeaders } from "../security/csrf";
import {
    forceDisconnectActiveMatchmakingClient,
    getActiveMatchmakingClient,
} from "../matchmaking/stompClient";
import { NotificationContext } from "./notification-context";
import {
    mergeIncomingInvite,
    normalizeIncomingInvites,
    removeExpiredInvites,
} from "./notificationExpiry";

const ACTION_STATUS_DURATION_MS = 3500;

function inviteFromNotification(event, username) {
    if (!event?.inviteId) return null;
    return {
        inviteId: event.inviteId,
        status: "PENDING",
        inviterUsername: event.actorUsername ?? "A player",
        inviteeUsername: username ?? null,
        createdAt: event.createdAt ?? null,
        expiresAt: event.expiresAt ?? null,
        matchId: null,
    };
}

function partyInviteFromNotification(event, username) {
    if (!event?.inviteId) return null;
    return {
        inviteId: event.inviteId,
        partyId: event.partyId ?? null,
        status: "PENDING",
        inviterUsername: event.actorUsername ?? "A player",
        inviteeUsername: username ?? null,
        createdAt: event.createdAt ?? null,
        expiresAt: event.expiresAt ?? null,
    };
}

function customLobbyInviteFromNotification(event, username) {
    if (!event?.inviteId) return null;
    return {
        inviteId: event.inviteId,
        lobbyId: event.customLobbyId ?? null,
        status: "PENDING",
        inviterUsername: event.actorUsername ?? "A player",
        inviteeUsername: username ?? null,
        createdAt: event.createdAt ?? null,
        expiresAt: event.expiresAt ?? null,
    };
}

export default function NotificationsProvider({ children }) {
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);
    const clientRef = useRef(null);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [pendingPartyInvites, setPendingPartyInvites] = useState([]);
    const [pendingCustomLobbyInvites, setPendingCustomLobbyInvites] = useState([]);
    const [actionPendingInviteId, setActionPendingInviteId] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [lastNotification, setLastNotification] = useState(null);
    const hiddenInviteIdsRef = useRef(new Set());

    navigateRef.current = navigate;

    const refreshIncomingInvites = useCallback(async () => {
        try {
            const receivedAt = Date.now();
            const [duelResponse, partyResponse, customLobbyResponse] = await Promise.all([
                fetch(apiUrl("/api/duel-invites/incoming"), {
                    credentials: "include",
                    cache: "no-store",
                }),
                fetch(apiUrl("/api/party-invites/incoming"), {
                    credentials: "include",
                    cache: "no-store",
                }),
                fetch(apiUrl("/api/custom-lobby-invites/incoming"), {
                    credentials: "include",
                    cache: "no-store",
                }),
            ]);
            if (duelResponse.ok) {
                const body = await duelResponse.json().catch(() => ({}));
                if (Array.isArray(body.invites)) {
                    setPendingInvites((current) => normalizeIncomingInvites(
                        body.invites,
                        current,
                        receivedAt,
                        hiddenInviteIdsRef.current,
                    ));
                }
            }
            if (partyResponse.ok) {
                const body = await partyResponse.json().catch(() => ({}));
                if (Array.isArray(body.invites)) {
                    setPendingPartyInvites((current) => normalizeIncomingInvites(
                        body.invites,
                        current,
                        receivedAt,
                        hiddenInviteIdsRef.current,
                    ));
                }
            }
            if (customLobbyResponse.ok) {
                const body = await customLobbyResponse.json().catch(() => ({}));
                if (Array.isArray(body.invites)) {
                    setPendingCustomLobbyInvites((current) => normalizeIncomingInvites(
                        body.invites,
                        current,
                        receivedAt,
                        hiddenInviteIdsRef.current,
                    ));
                }
            }
        } catch {
            // The socket remains the live path; a later app navigation can retry the snapshot.
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            hiddenInviteIdsRef.current.clear();
            setPendingInvites([]);
            setPendingPartyInvites([]);
            setPendingCustomLobbyInvites([]);
            setActionPendingInviteId(null);
            setActionError(null);
            setLastNotification(null);
            return undefined;
        }

        let disposed = false;
        const handleNotification = (event) => {
            if (disposed || !event) return;
            setLastNotification(event);
            if (event.type === "DUEL_INVITE_RECEIVED") {
                const invite = inviteFromNotification(event, null);
                if (invite) setPendingInvites((current) => mergeIncomingInvite(
                    current,
                    invite,
                    Date.now(),
                    hiddenInviteIdsRef.current,
                ));
                return;
            }
            if (event.type === "PARTY_INVITE_RECEIVED") {
                const invite = partyInviteFromNotification(event, null);
                if (invite) setPendingPartyInvites((current) => mergeIncomingInvite(
                    current,
                    invite,
                    Date.now(),
                    hiddenInviteIdsRef.current,
                ));
                return;
            }
            if (event.type === "CUSTOM_LOBBY_INVITE_RECEIVED") {
                const invite = customLobbyInviteFromNotification(event, null);
                if (invite) setPendingCustomLobbyInvites((current) => mergeIncomingInvite(
                    current,
                    invite,
                    Date.now(),
                    hiddenInviteIdsRef.current,
                ));
                return;
            }
            if (event.type === "DUEL_INVITE_MATCH_READY"
                || event.type === "DUEL_INVITE_ACCEPTED") {
                setPendingInvites((current) => current.filter(
                    (invite) => String(invite.inviteId) !== String(event.inviteId),
                ));
                setActionPendingInviteId(null);
                clientRef.current?.subscribeMatch?.();
                navigateRef.current("/match");
                return;
            }
            if (event.type === "DUEL_INVITE_ERROR") {
                setActionPendingInviteId(null);
                setActionError(event.message ?? "The duel invite could not be processed.");
                return;
            }
            if (event.type === "PARTY_INVITE_DECLINED"
                || event.type === "PARTY_MEMBER_JOINED") {
                void refreshIncomingInvites();
                return;
            }
            if (event.type === "CUSTOM_LOBBY_INVITE_DECLINED") {
                void refreshIncomingInvites();
                return;
            }
            if (event.type === "PARTY_ERROR") {
                setActionPendingInviteId(null);
                setActionError(event.message ?? "The party action could not be processed.");
            }
        };

        const client = getActiveMatchmakingClient(
            { onNotification: handleNotification },
            { autoReconnect: true, autoJoinOnConnect: false },
        );
        clientRef.current = client;
        client.setNotificationHandler?.(handleNotification);
        client.resumeReconnect?.();
        void client.connect();
        void refreshIncomingInvites();

        return () => {
            disposed = true;
            if (clientRef.current === client) clientRef.current = null;
            client.setNotificationHandler?.(null);
            client.clearPendingNotifications?.();
            void forceDisconnectActiveMatchmakingClient(client);
        };
    }, [isAuthenticated, refreshIncomingInvites]);

    useEffect(() => {
        if (!isAuthenticated) return undefined;
        const removeExpired = () => {
            const now = Date.now();
            setPendingInvites((current) => removeExpiredInvites(
                current,
                now,
                hiddenInviteIdsRef.current,
            ));
            setPendingPartyInvites((current) => removeExpiredInvites(
                current,
                now,
                hiddenInviteIdsRef.current,
            ));
            setPendingCustomLobbyInvites((current) => removeExpiredInvites(
                current,
                now,
                hiddenInviteIdsRef.current,
            ));
            setActionPendingInviteId((current) => (
                current != null && hiddenInviteIdsRef.current.has(String(current)) ? null : current
            ));
        };
        removeExpired();
        const intervalId = window.setInterval(removeExpired, 1000);
        return () => window.clearInterval(intervalId);
    }, [isAuthenticated]);

    useEffect(() => {
        if (!actionError) return undefined;
        const timeoutId = window.setTimeout(() => {
            setActionError((current) => current === actionError ? null : current);
        }, ACTION_STATUS_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [actionError]);

    const markInviteHandled = useCallback((inviteId) => {
        if (inviteId != null) hiddenInviteIdsRef.current.add(String(inviteId));
    }, []);

    const declineInvite = useCallback(async (inviteId) => {
        setActionPendingInviteId(inviteId);
        setActionError(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await ensureCsrfHeaders("POST")),
            };
            const response = await fetch(
                apiUrl(`/api/duel-invites/${encodeURIComponent(inviteId)}/decline`),
                { method: "POST", credentials: "include", headers },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The invite could not be declined.");
            markInviteHandled(inviteId);
            setPendingInvites((current) => current.filter(
                (invite) => String(invite.inviteId) !== String(inviteId),
            ));
        } catch (error) {
            setActionError(error.message ?? "The invite could not be declined.");
        } finally {
            setActionPendingInviteId(null);
        }
    }, [markInviteHandled]);

    const declinePartyInvite = useCallback(async (inviteId) => {
        setActionPendingInviteId(inviteId);
        setActionError(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await ensureCsrfHeaders("POST")),
            };
            const response = await fetch(
                apiUrl(`/api/party-invites/${encodeURIComponent(inviteId)}/decline`),
                { method: "POST", credentials: "include", headers },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The party invite could not be declined.");
            markInviteHandled(inviteId);
            setPendingPartyInvites((current) => current.filter(
                (invite) => String(invite.inviteId) !== String(inviteId),
            ));
        } catch (error) {
            setActionError(error.message ?? "The party invite could not be declined.");
        } finally {
            setActionPendingInviteId(null);
        }
    }, [markInviteHandled]);

    const acceptPartyInvite = useCallback(async (inviteId) => {
        setActionPendingInviteId(inviteId);
        setActionError(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await ensureCsrfHeaders("POST")),
            };
            const response = await fetch(
                apiUrl(`/api/party-invites/${encodeURIComponent(inviteId)}/accept`),
                { method: "POST", credentials: "include", headers },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The party invite could not be accepted.");
            markInviteHandled(inviteId);
            setPendingPartyInvites((current) => current.filter(
                (invite) => String(invite.inviteId) !== String(inviteId),
            ));
        } catch (error) {
            const message = error.message ?? "The party invite could not be accepted.";
            if (message === "Party no longer exists") {
                markInviteHandled(inviteId);
                setPendingPartyInvites((current) => current.filter(
                    (invite) => String(invite.inviteId) !== String(inviteId),
                ));
            }
            setActionError(message);
        } finally {
            setActionPendingInviteId(null);
        }
    }, [markInviteHandled]);

    const acceptCustomLobbyInvite = useCallback(async (inviteId) => {
        setActionPendingInviteId(inviteId);
        setActionError(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await ensureCsrfHeaders("POST")),
            };
            const response = await fetch(
                apiUrl(`/api/custom-lobby-invites/${encodeURIComponent(inviteId)}/accept`),
                { method: "POST", credentials: "include", headers },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The custom lobby invite could not be accepted.");
            markInviteHandled(inviteId);
            setPendingCustomLobbyInvites((current) => current.filter(
                (invite) => String(invite.inviteId) !== String(inviteId),
            ));
            navigateRef.current("/custom-lobby");
        } catch (error) {
            const message = error.message ?? "The custom lobby invite could not be accepted.";
            if (message === "Lobby no longer exists") {
                markInviteHandled(inviteId);
                setPendingCustomLobbyInvites((current) => current.filter(
                    (invite) => String(invite.inviteId) !== String(inviteId),
                ));
            }
            setActionError(message);
        } finally {
            setActionPendingInviteId(null);
        }
    }, [markInviteHandled]);

    const declineCustomLobbyInvite = useCallback(async (inviteId) => {
        setActionPendingInviteId(inviteId);
        setActionError(null);
        try {
            const headers = {
                "Content-Type": "application/json",
                ...(await ensureCsrfHeaders("POST")),
            };
            const response = await fetch(
                apiUrl(`/api/custom-lobby-invites/${encodeURIComponent(inviteId)}/decline`),
                { method: "POST", credentials: "include", headers },
            );
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.message ?? "The custom lobby invite could not be declined.");
            markInviteHandled(inviteId);
            setPendingCustomLobbyInvites((current) => current.filter(
                (invite) => String(invite.inviteId) !== String(inviteId),
            ));
        } catch (error) {
            setActionError(error.message ?? "The custom lobby invite could not be declined.");
        } finally {
            setActionPendingInviteId(null);
        }
    }, [markInviteHandled]);

    const acceptInvite = useCallback(async (inviteId) => {
        setActionPendingInviteId(inviteId);
        setActionError(null);
        try {
            const activeMatchResponse = await fetch(apiUrl("/api/matches/active"), {
                credentials: "include",
                cache: "no-store",
            });
            if (!activeMatchResponse.ok) {
                throw new Error("Could not verify your active match.");
            }
            const activeMatch = await activeMatchResponse.json();
            if (activeMatch.activeMatch === true) {
                clientRef.current?.subscribeMatch?.();
                navigateRef.current("/match", {
                    state: {
                        activeMatchVerified: true,
                        matchId: activeMatch.matchId ?? null,
                    },
                });
                setActionError("You are already in an active match. Return to it first.");
                return;
            }
            await clientRef.current?.acceptDuelInvite(inviteId);
        } catch (error) {
            setActionPendingInviteId(null);
            setActionError(error.message ?? "The invite could not be accepted.");
        } finally {
            setActionPendingInviteId(null);
        }
    }, []);

    const hideInvitesFrom = useCallback((username) => {
        const normalizedUsername = String(username ?? "").toLowerCase();
        if (!normalizedUsername) return;
        const hide = (current) => current.filter((invite) => {
            const shouldHide = String(invite.inviterUsername ?? "").toLowerCase() === normalizedUsername;
            if (shouldHide && invite.inviteId != null) hiddenInviteIdsRef.current.add(String(invite.inviteId));
            return !shouldHide;
        });
        setPendingInvites(hide);
        setPendingPartyInvites(hide);
        setPendingCustomLobbyInvites(hide);
    }, []);

    const value = useMemo(() => ({
        pendingInvites,
        pendingPartyInvites,
        pendingCustomLobbyInvites,
        notificationCount: pendingInvites.length + pendingPartyInvites.length + pendingCustomLobbyInvites.length,
        actionPendingInviteId,
        actionError,
        lastNotification,
        refreshIncomingInvites,
        hideInvitesFrom,
        acceptInvite,
        acceptPartyInvite,
        acceptCustomLobbyInvite,
        declineInvite,
        declinePartyInvite,
        declineCustomLobbyInvite,
    }), [
        acceptInvite,
        acceptPartyInvite,
        acceptCustomLobbyInvite,
        actionError,
        actionPendingInviteId,
        declineInvite,
        declinePartyInvite,
        declineCustomLobbyInvite,
        hideInvitesFrom,
        lastNotification,
        pendingInvites,
        pendingPartyInvites,
        pendingCustomLobbyInvites,
        refreshIncomingInvites,
    ]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}
