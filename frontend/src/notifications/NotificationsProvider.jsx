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

function mergeInvites(current, next) {
    const byId = new Map(current.map((invite) => [String(invite.inviteId), invite]));
    next.filter(Boolean).forEach((invite) => {
        byId.set(String(invite.inviteId), { ...byId.get(String(invite.inviteId)), ...invite });
    });
    return [...byId.values()];
}

export default function NotificationsProvider({ children }) {
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);
    const clientRef = useRef(null);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [actionPendingInviteId, setActionPendingInviteId] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [lastNotification, setLastNotification] = useState(null);

    navigateRef.current = navigate;

    const refreshIncomingInvites = useCallback(async () => {
        try {
            const response = await fetch(apiUrl("/api/duel-invites/incoming"), {
                credentials: "include",
                cache: "no-store",
            });
            if (!response.ok) return;
            const body = await response.json().catch(() => ({}));
            if (Array.isArray(body.invites)) setPendingInvites(body.invites);
        } catch {
            // The socket remains the live path; a later app navigation can retry the snapshot.
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            setPendingInvites([]);
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
                if (invite) setPendingInvites((current) => mergeInvites(current, [invite]));
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
            setPendingInvites((current) => current.filter(
                (invite) => String(invite.inviteId) !== String(inviteId),
            ));
        } catch (error) {
            setActionError(error.message ?? "The invite could not be declined.");
        } finally {
            setActionPendingInviteId(null);
        }
    }, []);

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
        setPendingInvites((current) => current.filter(
            (invite) => String(invite.inviterUsername ?? "").toLowerCase() !== normalizedUsername,
        ));
    }, []);

    const value = useMemo(() => ({
        pendingInvites,
        notificationCount: pendingInvites.length,
        actionPendingInviteId,
        actionError,
        lastNotification,
        refreshIncomingInvites,
        hideInvitesFrom,
        acceptInvite,
        declineInvite,
    }), [
        acceptInvite,
        actionError,
        actionPendingInviteId,
        declineInvite,
        hideInvitesFrom,
        lastNotification,
        pendingInvites,
        refreshIncomingInvites,
    ]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}
