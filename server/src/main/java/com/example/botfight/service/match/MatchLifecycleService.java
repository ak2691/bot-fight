package com.example.botfight.service.match;

import com.example.botfight.service.match.state.MatchPhase;

import org.springframework.stereotype.Component;

import com.example.botfight.DTO.match.MatchEventType;

import java.util.Objects;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.matchmaking.MatchParticipationCoordinator;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Owns match creation, surrender, and cleanup of in-memory match state. */
@Component
public final class MatchLifecycleService {
    private final MatchLockService lockService;
    private final MatchScheduler matchScheduler;
    private static final int SUBMISSION_GRACE_SECONDS = MatchTimingPolicy.SUBMISSION_GRACE_SECONDS;
    private static final String COMPLETION_REASON_RESIGNATION = "RESIGNATION";

    private final MatchRuntimeState state;
    private final MatchPersistenceService persistenceService;
    private final MatchConnectionService connectionService;
    private final MatchEventFactory eventFactory;
    private final MatchSubmissionService submissionService;
    private final MatchChatService chatService;
    private final Clock clock;
    private final MatchParticipationCoordinator participationCoordinator;

    public MatchLifecycleService(
            MatchRuntimeState state,
            MatchLockService lockService,
            MatchPersistenceService persistenceService,
            MatchConnectionService connectionService,
            MatchEventFactory eventFactory,
            MatchSubmissionService submissionService,
            MatchChatService chatService,
            Clock clock,
            MatchParticipationCoordinator participationCoordinator,
            MatchScheduler matchScheduler) {
        this.matchScheduler = matchScheduler;
        this.state = state;
        this.lockService = lockService;
        this.persistenceService = persistenceService;
        this.connectionService = connectionService;
        this.eventFactory = eventFactory;
        this.submissionService = submissionService;
        this.chatService = chatService;
        this.clock = clock;
        this.participationCoordinator = participationCoordinator;
    }

    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player,
            MatchMode mode,
            boolean ranked) {
        return startMatchInternal(List.of(opponent, player), mode, ranked, null, null);
    }

    public List<OutboundMatchmakingEvent> startTeamMatch(
            List<MatchEntrant> entrants,
            MatchMode mode,
            boolean ranked,
            Integer requestedBaseClockSeconds,
            Integer requestedIncrementSeconds) {
        return startMatchInternal(
                entrants,
                mode,
                ranked,
                requestedBaseClockSeconds,
                requestedIncrementSeconds);
    }

    private List<OutboundMatchmakingEvent> startMatchInternal(
            List<MatchEntrant> entrants,
            MatchMode mode,
            boolean ranked,
            Integer requestedBaseClockSeconds,
            Integer requestedIncrementSeconds) {
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        int baseClockSeconds;
        int incrementSeconds;
        try {
            baseClockSeconds = MatchTimingPolicy.resolveBaseClockSeconds(
                    resolvedMode, requestedBaseClockSeconds);
            incrementSeconds = MatchTimingPolicy.resolveIncrementSeconds(
                    resolvedMode, requestedIncrementSeconds);
        } catch (IllegalArgumentException exception) {
            throw new AuthException(exception.getMessage());
        }
        if (entrants == null || entrants.size() < 2 || entrants.size() > 8) {
            throw new AuthException("a match must contain between two and eight players");
        }
        List<MatchEntrant> normalizedEntrants = normalizeEntrants(entrants);
        validateRoster(normalizedEntrants, resolvedMode);
        UUID reservationId = state.reserveMatchStart(
                normalizedEntrants.stream().map(MatchEntrant::userId).toList());
        if (reservationId == null) {
            throw new AuthException("one or more players are already in a match or starting a match");
        }
        MatchSession startedSession = null;
        List<UUID> socketRegistrationAttempts = new ArrayList<>();
        try {
            Match match = persistenceService.createMatch(resolvedMode, ranked);
            long seed = match.getSimulationSeed();
            List<MatchEntrant> orderedEntrants = normalizedEntrants;
            List<MatchPlayer> players = orderedEntrants.stream()
                    .map(entrant -> new MatchPlayer(
                            entrant.userId(),
                            entrant.username(),
                            entrant.principalName(),
                            orderedEntrants.indexOf(entrant) + 1,
                            entrant.teamNumber(),
                            false,
                            null,
                            0,
                            "custom:",
                            false,
                            baseClockSeconds * 1_000L,
                            MatchPlayer.TIMEOUT_FALLBACK_CURRENT,
                            null))
                    .toList();

            MatchSession pendingSession = new MatchSession(
                    match.getId(),
                    seed,
                    players,
                    null,
                    null,
                    null,
                    1,
                    null,
                    null,
                    null,
                    null,
                    false,
                    resolvedMode,
                    baseClockSeconds,
                    incrementSeconds,
                    Set.of(),
                    List.of(), MatchPhase.MATCH_FOUND);
            persistenceService.createParticipants(match, pendingSession);
            MatchSession session = pendingSession;
            session = session.withLoadoutSelection(
                    loadoutSelectionDeadlineAt(Instant.now(clock)));
            MatchSession sessionToStart = session;
            startedSession = sessionToStart;
            List<OutboundMatchmakingEvent> startedEvents = sessionToStart.players().stream()
                    .map(matchPlayer -> eventFactory.forPlayer(sessionToStart,
                matchPlayer,
                MatchEventType.MATCH_STARTED,
                "LOADOUT_SELECT",
                null,
                "Match accepted. Pick your weapon and first ability.",
                0,
                null,
                null,
                null,
                null))
                    .toList();
            for (MatchEntrant entrant : normalizedEntrants) {
                socketRegistrationAttempts.add(entrant.userId());
                connectionService.registerSocket(entrant.userId(), entrant.socketSessionId());
            }
            if (!state.publishReservedSession(reservationId, sessionToStart)) {
                throw new AuthException("the match roster reservation was no longer available");
            }
            matchScheduler.deadlinesChanged(sessionToStart);
            return startedEvents;
        } catch (RuntimeException | Error exception) {
            if (startedSession != null) {
                try {
                    state.removeSession(startedSession);
                } catch (RuntimeException | Error cleanupFailure) {
                    exception.addSuppressed(cleanupFailure);
                }
            }
            for (UUID userId : socketRegistrationAttempts) {
                try {
                    connectionService.clear(userId);
                } catch (RuntimeException | Error cleanupFailure) {
                    exception.addSuppressed(cleanupFailure);
                }
            }
            state.releaseMatchStart(reservationId);
            throw exception;
        }
    }

    private List<MatchEntrant> normalizeEntrants(List<MatchEntrant> entrants) {
        List<MatchEntrant> normalized = entrants.stream()
                .filter(Objects::nonNull)
                .toList();
        if (normalized.size() != entrants.size()
                || normalized.stream().map(MatchEntrant::userId).distinct().count() != normalized.size()) {
            throw new AuthException("match players must be unique");
        }
        boolean explicitTeams = normalized.stream().allMatch(entrant -> entrant.teamNumber() > 0);
        if (!explicitTeams) {
            if (normalized.size() != 2) {
                throw new AuthException("team assignments are required for team matches");
            }
            return List.of(
                    normalized.get(0).withTeam(1),
                    normalized.get(1).withTeam(2));
        }
        if (normalized.stream().map(MatchEntrant::teamNumber).distinct().count() < 2) {
            throw new AuthException("a match must contain at least two teams");
        }
        return normalized;
    }

    /**
     * A team match is created only after the queue has produced an exact
     * roster. Keeping this invariant here protects all other callers too: a
     * malformed queue event, stale party snapshot, or duplicate connection
     * can never turn a 2v2 match into a 2v3 match at the authoritative seam.
     */
    private void validateRoster(List<MatchEntrant> entrants, MatchMode mode) {
        Set<String> socketSessionIds = new HashSet<>();
        for (MatchEntrant entrant : entrants) {
            if (entrant.userId() == null
                    || entrant.principalName() == null
                    || entrant.principalName().isBlank()) {
                throw new AuthException("match players must have authenticated identities");
            }
            String socketSessionId = entrant.socketSessionId();
            if (socketSessionId != null
                    && !socketSessionId.isBlank()
                    && !socketSessionIds.add(socketSessionId)) {
                throw new AuthException("match players must use distinct socket connections");
            }
        }

        if (mode == MatchMode.ONES) {
            if (entrants.size() != 2
                    || entrants.stream().filter(entrant -> entrant.teamNumber() == 1).count() != 1
                    || entrants.stream().filter(entrant -> entrant.teamNumber() == 2).count() != 1) {
                throw new AuthException("1v1 matches require one player on each team");
            }
            return;
        }

        if (mode == MatchMode.TWOS) {
            if (entrants.size() != 4
                    || entrants.stream().anyMatch(entrant -> entrant.teamNumber() != 1
                            && entrant.teamNumber() != 2)
                    || entrants.stream().filter(entrant -> entrant.teamNumber() == 1).count() != 2
                    || entrants.stream().filter(entrant -> entrant.teamNumber() == 2).count() != 2) {
                throw new AuthException("2v2 matches require exactly two players on each team");
            }
            return;
        }

        if (mode == MatchMode.CUSTOM) {
            long bluePlayers = entrants.stream()
                    .filter(entrant -> entrant.teamNumber() == 1)
                    .count();
            long redPlayers = entrants.stream()
                    .filter(entrant -> entrant.teamNumber() == 2)
                    .count();
            if (entrants.size() < 2
                    || entrants.size() > 4
                    || entrants.stream().anyMatch(entrant -> entrant.teamNumber() != 1
                            && entrant.teamNumber() != 2)
                    || bluePlayers < 1
                    || bluePlayers > 2
                    || redPlayers < 1
                    || redPlayers > 2) {
                throw new AuthException("custom matches require two to four players split across Blue and Red teams");
            }
        }
    }

    public List<OutboundMatchmakingEvent> surrender(UUID userId) {
        MatchSession session = state.activeSessionForUser(userId);
        if (session == null || session.ended()) return List.of();

        MatchPlayer votingPlayer = playerForUser(session, userId);
        boolean requested = !session.surrenderVotes().contains(userId);
        MatchSession updatedSession = session.withSurrenderVote(userId, requested);
        List<MatchPlayer> votingTeamPlayers = updatedSession.players().stream()
                .filter(player -> player.teamNumber() == votingPlayer.teamNumber())
                .toList();
        long voteCount = votingTeamPlayers.stream()
                .filter(player -> updatedSession.surrenderVotes().contains(player.userId()))
                .count();
        boolean teamUnanimous = !votingTeamPlayers.isEmpty()
                && voteCount == votingTeamPlayers.size();

        if (!teamUnanimous) {
            state.putSession(updatedSession);
            String action = requested ? "voted to forfeit" : "withdrew the forfeit vote";
            String message = teamLabel(votingPlayer.teamNumber()) + " " + action + "."
                    + " Forfeit votes: " + voteCount + "/" + votingTeamPlayers.size() + ".";
            return updatedSession.players().stream()
                    .map(player -> eventFactory.forPlayer(updatedSession,
                player,
                MatchEventType.MATCH_SURRENDER_UPDATED,
                updatedSession.phase().wireStatus(),
                null,
                message,
                0,
                null,
                null,
                null,
                null))
                    .toList();
        }

        MatchPlayer winner = updatedSession.players().stream()
                .filter(player -> player.teamNumber() != votingPlayer.teamNumber())
                .findFirst()
                .orElseThrow(() -> new AuthException("the opposing team is not available"));
        persistenceService.completeMatchByTeamForfeit(
                updatedSession.matchId(),
                votingPlayer.teamNumber(),
                winner,
                COMPLETION_REASON_RESIGNATION);
        clearSession(updatedSession);

        MatchPlaybackDTO result = new MatchPlaybackDTO(
                updatedSession.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "COMPLETED",
                "RESIGNATION_WIN",
                winner.userId(),
                teamLabel(winner.teamNumber()) + " wins.");
        Instant now = Instant.now(clock);
        return updatedSession.players().stream()
                .map(player -> eventFactory.forPlayer(updatedSession.resultReady(),
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

    private String teamLabel(int teamNumber) {
        return teamNumber == 2 ? "Red Team" : "Blue Team";
    }

    public void clearSession(MatchSession session) {
        matchScheduler.cancelAll(session.matchId());
        submissionService.persistCodeHistory(session);
        chatService.open(session);
        for (MatchPlayer player : session.players()) {
            connectionService.clear(player.userId());
        }
        state.removeSession(session);
        state.roundHistoryByMatchId().remove(session.matchId());
        submissionService.removeAll(session.matchId());
        participationCoordinator.releaseRankedParticipants(
                session.players().stream().map(MatchPlayer::userId).toList());
    }

    private Instant loadoutSelectionDeadlineAt(Instant phaseStartedAt) {
        return phaseStartedAt.plusSeconds(
                MatchTimingPolicy.pickSeconds(1) + SUBMISSION_GRACE_SECONDS);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }
    public void revealCompletedMatchResult(UUID matchId) {
        lockService.withLock(matchId, () -> {
            MatchSession session = state.activeSessionForMatch(matchId);
            if (session != null && session.ended() && session.resultRevealsAt() != null
                    && !Instant.now(clock).isBefore(session.resultRevealsAt())) {
                state.putSession(session.resultReady());
            }
            return null;
        });
        persistenceService.invalidateAfterResultReveal(matchId);
    }

}
