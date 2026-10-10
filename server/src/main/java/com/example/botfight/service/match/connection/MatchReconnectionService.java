package com.example.botfight.service.match.connection;

import com.example.botfight.service.match.MatchLifecycleService;

import com.example.botfight.service.match.MatchLockService;

import org.springframework.stereotype.Component;

import com.example.botfight.service.match.MatchScheduler;
import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.MatchPersistenceService;
import com.example.botfight.service.match.MatchReplayService;
import com.example.botfight.service.match.MatchSimulationService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Resumes the active session and owns disconnect grace-period outcomes. */
@Component
public final class MatchReconnectionService {
    private final MatchScheduler matchScheduler;
    private static final String COMPLETION_REASON_DISCONNECTION = "DISCONNECTION";
    private static final String COMPLETION_REASON_MUTUAL_DISCONNECTION = "MUTUAL_DISCONNECTION";
    private static final String COMPLETION_REASON_INITIAL_DISCONNECTION = "INITIAL_DISCONNECTION";

    private final MatchLockService lockService;
    private final MatchRuntimeState state;
    private final Clock clock;
    private final MatchConnectionService connectionService;
    private final MatchPersistenceService persistenceService;
    private final MatchEventFactory eventFactory;
    private final MatchReplayService replayService;
    private final MatchLifecycleService lifecycleService;

    public MatchReconnectionService(
            MatchRuntimeState state,
            MatchLockService lockService,
            Clock clock,
            MatchConnectionService connectionService,
            MatchPersistenceService persistenceService,
            MatchEventFactory eventFactory,
            MatchReplayService replayService,
            MatchLifecycleService lifecycleService,
            MatchScheduler matchScheduler) {
        this.matchScheduler = matchScheduler;
        this.state = state;
        this.lockService = lockService;
        this.clock = clock;
        this.connectionService = connectionService;
        this.persistenceService = persistenceService;
        this.eventFactory = eventFactory;
        this.replayService = replayService;
        this.lifecycleService = lifecycleService;
    }

    public UUID matchIdForUser(UUID userId) {
        MatchSession activeSession = state.activeSessionForUser(userId);
        return activeSession == null ? null : activeSession.matchId();
    }

    /** Adds an authenticated tab while coordinating against session cleanup. */
    public void registerSocketSession(UUID userId, String socketSessionId) {
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null || socketSessionId == null || socketSessionId.isBlank()) return;
        lockService.withLock(session.matchId(), () -> {
            MatchSession current = state.activeSessionForUser(userId);
            if (current != null && current.matchId().equals(session.matchId())) {
                connectionService.registerSocket(userId, socketSessionId);
            }
            return null;
        });
    }

    /** Removes one tab; the user remains present through any other live tabs. */
    public void unregisterSocketSession(String principalName, String socketSessionId) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) return;
        lockService.withLock(session.matchId(), () -> {
            session.players().stream().filter(player -> principalName.equals(player.principalName()))
                    .findFirst().ifPresent(player -> connectionService.unregisterSocket(player.userId(), socketSessionId));
            return null;
        });
    }

    public ActiveMatchStatusDTO activeMatchStatus(UUID userId) {
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null) return ActiveMatchStatusDTO.none();
        if (terminalResultIsVisible(session)) {
            expireTerminalSession(session);
            return ActiveMatchStatusDTO.none();
        }

        Instant disconnectEndsAt = connectionService.disconnectDeadline(userId);
        return new ActiveMatchStatusDTO(
                true,
                disconnectEndsAt != null,
                session.matchId(),
                disconnectEndsAt);
    }

    public boolean leaveCompletedMatch(UUID userId) {
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null || !session.ended()
                || session.resultRevealsAt() == null
                || Instant.now(clock).isBefore(session.resultRevealsAt())) {
            return false;
        }
        expireTerminalSession(session);
        return true;
    }

    /**
     * Removes the active match session after the terminal result is visible.
     * The independent MatchChatService window remains available for retention.
     */
    public void expireCompletedMatch(UUID matchId) {
        MatchSession session = state.activeSessionForMatch(matchId);
        if (session == null || !terminalResultIsVisible(session)) return;
        expireTerminalSession(session);
    }

    public List<OutboundMatchmakingEvent> resumeMatch(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null) {
            return List.of(eventFactory.noActiveMatchEvent(userId, username, principalName));
        }
        if (terminalResultIsVisible(session)) {
            expireTerminalSession(session);
            return List.of(eventFactory.noActiveMatchEvent(userId, username, principalName));
        }
        connectionService.registerSocket(userId, socketSessionId);
        MatchPlayer reconnectingPlayer = playerForUser(session, userId);
        Instant disconnectDeadline = connectionService.reconnect(userId, socketSessionId);
        List<OutboundMatchmakingEvent> events = session.isReplay()
                ? replayEventsForReconnect(userId, session)
                : new ArrayList<>(List.of(eventFactory.resumePhaseEvent(session, reconnectingPlayer)));
        if (disconnectDeadline == null) {
            return events;
        }
        events.addAll(eventFactory.playerReconnectedEvents(
                session,
                reconnectingPlayer,
                session.isReplay() ? session.replayPlayback() : null));
        return events;
    }

    public List<OutboundMatchmakingEvent> markDisconnected(
            String principalName,
            String socketSessionId) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) return List.of();
        Instant now = Instant.now(clock);
        MatchPlayer disconnectedPlayer = playerForPrincipal(session, principalName);
        if (session.ended()) {
            // The terminal replay still gets heartbeat-loss detection for
            // consistency, but it never creates a disconnect penalty.
            if (session.roundReadyAt() == null || !now.isBefore(session.roundReadyAt())) {
                if (persistenceService.isTerminalMatch(session.matchId())) {
                    removePlayer(disconnectedPlayer);
                }
            }
            return List.of();
        }
        boolean replayOrResultAvailable = session.isReplay()
                && session.roundReadyAt() != null
                && now.isBefore(session.roundReadyAt());
        if (replayOrResultAvailable) {
            if (!connectionService.deferDisconnect(disconnectedPlayer.userId(), socketSessionId)) {
                return List.of();
            }
            // No banner is shown during replay. A pending disconnect is
            // promoted only after the valid next round is active.
            return List.of();
        }
        Instant deadline = connectionService.beginDisconnect(
                disconnectedPlayer.userId(),
                socketSessionId);
        if (deadline == null) return List.of();
        matchScheduler.disconnect(session.matchId(), principalName, deadline);
        return session.players().stream()
                .map(player -> eventFactory.disconnectEventForPlayer(session,
                player,
                disconnectedPlayer,
                MatchEventType.PLAYER_DISCONNECTED,
                deadline,
                disconnectedPlayer.username()
                                + " disconnected. The match ends in 30 seconds unless they return.",
                null))
                .toList();
    }

    public List<OutboundMatchmakingEvent> promotePendingDisconnect(String principalName) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null || session.loadoutSelectionEndsAt() == null) return List.of();

        MatchPlayer disconnectedPlayer = findPlayerForPrincipal(session, principalName);
        if (disconnectedPlayer == null) return List.of();

        Instant deadline = connectionService.resumePausedDisconnect(disconnectedPlayer.userId());
        if (deadline == null) {
            deadline = connectionService.startDeferredDisconnect(disconnectedPlayer.userId());
        }
        if (deadline == null) return List.of();
        matchScheduler.disconnect(session.matchId(), principalName, deadline);
        Instant activeDeadline = deadline;
        String disconnectMessage = disconnectedPlayer.username()
                + " disconnected. The match ends in "
                + disconnectGraceSecondsRemaining(activeDeadline)
                + " seconds unless they return.";
        return session.players().stream()
                .map(player -> eventFactory.disconnectEventForPlayer(session,
                player,
                disconnectedPlayer,
                MatchEventType.PLAYER_DISCONNECTED,
                activeDeadline,
                disconnectMessage,
                null))
                .toList();
    }

    private long disconnectGraceSecondsRemaining(Instant deadline) {
        long remainingMillis = Math.max(0, Duration.between(Instant.now(clock), deadline).toMillis());
        return Math.max(1, (remainingMillis + 999) / 1000);
    }

    public List<OutboundMatchmakingEvent> resolveDisconnectTimeout(
            String principalName,
            Instant expectedDeadline) {
        MatchSession session = findSessionForPrincipal(principalName);
        if (session == null) return List.of();
        MatchPlayer disconnectedPlayer = findPlayerForPrincipal(session, principalName);
        if (disconnectedPlayer == null) return List.of();
        return resolveDisconnectTimeout(session, disconnectedPlayer, expectedDeadline);
    }

    private List<OutboundMatchmakingEvent> resolveDisconnectTimeout(
            MatchSession session,
            MatchPlayer disconnectedPlayer,
            Instant expectedDeadline) {
        if (persistenceService.isTerminalMatch(session.matchId())) {
            removePlayer(disconnectedPlayer);
            return List.of();
        }

        Instant currentDeadline = connectionService.disconnectDeadline(disconnectedPlayer.userId());
        if (currentDeadline == null
                || !currentDeadline.equals(expectedDeadline)
                || Instant.now(clock).isBefore(currentDeadline)) {
            return List.of();
        }
        MatchPlayer winner = session.players().stream()
                .filter(player -> player.teamNumber() != disconnectedPlayer.teamNumber())
                .findFirst()
                .orElseThrow(() -> new AuthException("opponent was not found"));

        if (disconnectExpiredDuringInitialSelection(session)) {
            persistenceService.completeMatchAsDraw(
                    session.matchId(), COMPLETION_REASON_INITIAL_DISCONNECTION);
            lifecycleService.clearSession(session);
            return resultEvents(
                    session,
                    "DRAW",
                    null,
                    "The match is a draw because a player disconnected before round one began.");
        }
        boolean everyOpponentDisconnected = session.players().stream()
                .filter(player -> player.teamNumber() == winner.teamNumber())
                .allMatch(player -> connectionService.isDisconnected(player.userId()));
        if (everyOpponentDisconnected) {
            persistenceService.completeMatchAsDraw(
                    session.matchId(), COMPLETION_REASON_MUTUAL_DISCONNECTION);
            lifecycleService.clearSession(session);
            return resultEvents(
                    session,
                    "DRAW",
                    null,
                    "The match is a draw because both players disconnected.");
        }

        persistenceService.completeMatchByForfeit(
                session.matchId(),
                disconnectedPlayer,
                winner,
                COMPLETION_REASON_DISCONNECTION);
        lifecycleService.clearSession(session);
        return resultEvents(
                session,
                "DISCONNECTION_WIN",
                winner.userId(),
                teamLabel(winner.teamNumber()) + " wins because the opposing team did not reconnect.");
    }

    private String teamLabel(int teamNumber) {
        return teamNumber == 2 ? "Red Team" : "Blue Team";
    }

    public MatchSession findSessionForPrincipal(String principalName) {
        return state.activeSessionForPrincipal(principalName);
    }

    private List<OutboundMatchmakingEvent> replayEventsForReconnect(
            UUID userId,
            MatchSession session) {
        Instant now = Instant.now(clock);
        MatchPlayer replayPlayer = playerForUser(session, userId);
        if (session.replayPlayback() == null || session.playbackStartsAt() == null) {
            return List.of();
        }
        if (session.resultRevealsAt() != null && now.isBefore(session.resultRevealsAt())) {
            return List.of(eventFactory.forCompactReplay(session,
                replayPlayer,
                MatchEventType.SIMULATION_PREPARING,
                "SIMULATION_PREPARING",
                replayService.authorizedReplayForReconnect(
                            session.replayPlayback(), session.playbackStartsAt(), now),
                "Replay ready.",
                0,
                session.playbackStartsAt(),
                session.resultRevealsAt(),
                session.roundReadyAt()));
        }
        if (session.ended()) {
            return List.of(eventFactory.forCompactReplay(session,
                replayPlayer,
                MatchEventType.MATCH_RESULT_READY,
                "RESULT_READY",
                replayService.resultPayload(session.replayPlayback()),
                session.replayPlayback().message(),
                0,
                session.playbackStartsAt(),
                session.resultRevealsAt(),
                session.roundReadyAt()));
        }
        return List.of(eventFactory.forCompactReplay(session,
                replayPlayer,
                MatchEventType.SIMULATION_PREPARING,
                "SIMULATION_PREPARING",
                session.replayPlayback(),
                "Replay ready.",
                0,
                session.playbackStartsAt(),
                session.resultRevealsAt(),
                session.roundReadyAt()));
    }

    private List<OutboundMatchmakingEvent> resultEvents(
            MatchSession session,
            String resultType,
            UUID winnerUserId,
            String message) {
        MatchPlaybackDTO result = new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "COMPLETED",
                resultType,
                winnerUserId,
                message);
        Instant now = Instant.now(clock);
        MatchSession resultSession = session.withoutReplay().resultReady();
        return resultSession.players().stream()
                .map(player -> eventFactory.forPlayer(resultSession,
                player,
                MatchEventType.MATCH_RESULT_READY,
                "RESULT_READY",
                result,
                result.message(),
                0,
                now,
                now,
                null,
                null))
                .toList();
    }

    private boolean disconnectExpiredDuringInitialSelection(MatchSession session) {
        return session.roundNumber() == 1
                && session.loadoutSelectionEndsAt() != null
                && session.countdownEndsAt() == null;
    }

    private void removePlayer(MatchPlayer player) {
        state.removeUser(player.userId());
        connectionService.clear(player.userId());
    }

    private void expireTerminalSession(MatchSession session) {
        state.removeSession(session);
        session.players().forEach(player -> connectionService.clear(player.userId()));
    }

    private boolean terminalResultIsVisible(MatchSession session) {
        return session.ended()
                && session.resultRevealsAt() != null
                && !Instant.now(clock).isBefore(session.resultRevealsAt());
    }

    private MatchPlayer playerForPrincipal(MatchSession session, String principalName) {
        return findPlayerForPrincipal(session, principalName);
    }

    private MatchPlayer findPlayerForPrincipal(MatchSession session, String principalName) {
        return session.players().stream()
                .filter(player -> player.principalName().equals(principalName))
                .findFirst()
                .orElse(null);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }
}
