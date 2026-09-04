package com.example.botfight.service.match.lifecycle;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.submission.MatchSubmissionService;
import com.example.botfight.service.match.timing.MatchTimingPolicy;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Owns match creation, surrender, and cleanup of in-memory match state. */
public final class MatchLifecycleService {
    private static final int LOADOUT_SELECTION_SECONDS = MatchTimingPolicy.LOADOUT_SELECTION_SECONDS;
    private static final int SUBMISSION_GRACE_SECONDS = MatchTimingPolicy.SUBMISSION_GRACE_SECONDS;
    private static final int WINS_REQUIRED = 2;
    private static final String COMPLETION_REASON_RESIGNATION = "RESIGNATION";

    private final MatchRuntimeState state;
    private final MatchPersistenceService persistenceService;
    private final MatchConnectionService connectionService;
    private final MatchEventFactory eventFactory;
    private final MatchSubmissionService submissionService;
    private final MatchChatService chatService;
    private final Clock clock;

    public MatchLifecycleService(
            MatchRuntimeState state,
            MatchPersistenceService persistenceService,
            MatchConnectionService connectionService,
            MatchEventFactory eventFactory,
            MatchSubmissionService submissionService,
            MatchChatService chatService,
            Clock clock) {
        this.state = state;
        this.persistenceService = persistenceService;
        this.connectionService = connectionService;
        this.eventFactory = eventFactory;
        this.submissionService = submissionService;
        this.chatService = chatService;
        this.clock = clock;
    }

    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player) {
        return startMatchInternal(List.of(opponent, player), MatchMode.ONES, true);
    }

    public List<OutboundMatchmakingEvent> startMatch(
            MatchEntrant opponent,
            MatchEntrant player,
            MatchMode mode) {
        return startMatchInternal(List.of(opponent, player), mode, false);
    }

    public List<OutboundMatchmakingEvent> startTeamMatch(
            List<MatchEntrant> entrants,
            MatchMode mode) {
        return startTeamMatch(entrants, mode, null);
    }

    public List<OutboundMatchmakingEvent> startTeamMatch(
            List<MatchEntrant> entrants,
            MatchMode mode,
            Integer requestedRoundDurationSeconds) {
        return startMatchInternal(entrants, mode, false, requestedRoundDurationSeconds);
    }

    private List<OutboundMatchmakingEvent> startMatchInternal(
            List<MatchEntrant> entrants,
            MatchMode mode,
            boolean useLegacyCreateMatch) {
        return startMatchInternal(entrants, mode, useLegacyCreateMatch, null);
    }

    private List<OutboundMatchmakingEvent> startMatchInternal(
            List<MatchEntrant> entrants,
            MatchMode mode,
            boolean useLegacyCreateMatch,
            Integer requestedRoundDurationSeconds) {
        MatchMode resolvedMode = mode == null ? MatchMode.ONES : mode;
        int roundDurationSeconds;
        try {
            roundDurationSeconds = MatchTimingPolicy.resolveRoundDurationSeconds(
                    resolvedMode, requestedRoundDurationSeconds);
        } catch (IllegalArgumentException exception) {
            throw new AuthException(exception.getMessage());
        }
        if (entrants == null || entrants.size() < 2 || entrants.size() > 8) {
            throw new AuthException("a match must contain between two and eight players");
        }
        List<MatchEntrant> normalizedEntrants = normalizeEntrants(entrants);
        validateRoster(normalizedEntrants, resolvedMode);
        Match match = useLegacyCreateMatch
                ? persistenceService.createMatch()
                : persistenceService.createMatch(resolvedMode);
        long seed = match.getSimulationSeed();
        List<MatchEntrant> orderedEntrants = useLegacyCreateMatch
                && normalizedEntrants.size() == 2
                && (seed & 1L) == 0L
                ? List.of(normalizedEntrants.get(1), normalizedEntrants.get(0))
                : normalizedEntrants;
        List<MatchPlayer> players = orderedEntrants.stream()
                .map(entrant -> new MatchPlayer(
                        entrant.userId(), entrant.username(), entrant.principalName(),
                        orderedEntrants.indexOf(entrant) + 1,
                        entrant.teamNumber(), false, null, 0, "custom:", false))
                .toList();

        MatchSession pendingSession = new MatchSession(
                match.getId(),
                seed,
                players,
                null,
                null,
                null,
                null,
                1,
                WINS_REQUIRED,
                List.of(),
                Map.of(),
                null,
                null,
                null,
                null,
                false,
                resolvedMode,
                roundDurationSeconds);
        persistenceService.createParticipants(match, pendingSession);
        MatchSession session = pendingSession;
        for (MatchEntrant entrant : orderedEntrants) {
            if (entrant.guaranteedAbilities() != null
                    && !entrant.guaranteedAbilities().isEmpty()) {
                session = session.withGuaranteedAbilities(
                        entrant.userId(), entrant.guaranteedAbilities());
            }
        }
        session = session.withLoadoutSelection(
                loadoutSelectionDeadlineAt(Instant.now(clock)));
        state.putSession(session);
        normalizedEntrants.forEach(entrant ->
                connectionService.registerSocket(entrant.userId(), entrant.socketSessionId()));

        MatchSession startedSession = session;
        return startedSession.players().stream()
                .map(matchPlayer -> eventFactory.forPlayer(
                        startedSession,
                        matchPlayer,
                        "MATCH_STARTED",
                        "LOADOUT_SELECT",
                        null,
                        "Match accepted. Choose your opening loadout."))
                .toList();
    }

    private List<MatchEntrant> normalizeEntrants(List<MatchEntrant> entrants) {
        List<MatchEntrant> normalized = entrants.stream()
                .filter(java.util.Objects::nonNull)
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
        MatchSession session = state.activeSessionsByUserId().get(userId);
        if (session == null || session.seriesComplete()) return List.of();

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
                    .map(player -> eventFactory.forPlayer(
                            updatedSession,
                            player,
                            "MATCH_SURRENDER_UPDATED",
                            statusForSession(updatedSession),
                            null,
                            message))
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
                null,
                List.of(),
                "RESIGNATION_WIN",
                winner.userId(),
                teamLabel(winner.teamNumber()) + " wins.");
        Instant now = Instant.now(clock);
        return updatedSession.players().stream()
                .map(player -> eventFactory.forPlayer(
                        updatedSession,
                        player,
                        "MATCH_RESULT_READY",
                        "RESULT_READY",
                        result,
                        result.message(),
                        0,
                        now,
                        now))
                .toList();
    }

    private String teamLabel(int teamNumber) {
        return teamNumber == 2 ? "Red Team" : "Blue Team";
    }

    private String statusForSession(MatchSession session) {
        if (session.isReplay()) return "SIMULATION_PREPARING";
        if (session.players().stream().allMatch(MatchPlayer::finished)) {
            return "SIMULATION_LOADING";
        }
        if (session.countdownEndsAt() != null) return "PREP";
        if (session.entityPlacementEndsAt() != null) return "OBJECT_PLACEMENT";
        if (session.buildingEndsAt() != null) return "BUILDING";
        return "LOADOUT_SELECT";
    }

    public void clearSession(MatchSession session) {
        submissionService.persistCodeHistory(session);
        chatService.open(session);
        for (MatchPlayer player : session.players()) {
            state.activeSessionsByUserId().remove(player.userId());
            connectionService.clear(player.userId());
        }
        state.roundHistoryByMatchId().remove(session.matchId());
        submissionService.removeAll(session.matchId());
    }

    private Instant loadoutSelectionDeadlineAt(Instant phaseStartedAt) {
        return phaseStartedAt.plusSeconds(LOADOUT_SELECTION_SECONDS + SUBMISSION_GRACE_SECONDS);
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }
}
