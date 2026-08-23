package com.example.botfight.service.match.lifecycle;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.Match;
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
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Owns match creation, surrender, and cleanup of in-memory match state. */
public final class MatchLifecycleService {
    private static final int LOADOUT_SELECTION_SECONDS = 60;
    private static final int SUBMISSION_GRACE_SECONDS = 2;
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
        Match match = persistenceService.createMatch();
        long seed = match.getSimulationSeed();
        boolean queuedPlayerDefendsFirst = (seed & 1L) == 0L;
        MatchEntrant firstDefender = queuedPlayerDefendsFirst ? player : opponent;
        MatchEntrant firstAttacker = queuedPlayerDefendsFirst ? opponent : player;
        List<MatchPlayer> players = List.of(
                new MatchPlayer(
                        firstDefender.userId(), firstDefender.username(), firstDefender.principalName(),
                        1, false, null, 0, "custom:", false),
                new MatchPlayer(
                        firstAttacker.userId(), firstAttacker.username(), firstAttacker.principalName(),
                        2, false, null, 0, "custom:", false));

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
                Map.of());
        persistenceService.createParticipants(match, pendingSession);
        MatchSession session = pendingSession.withLoadoutSelection(
                loadoutSelectionDeadlineAt(Instant.now(clock)));
        state.putSession(session);
        connectionService.registerSocket(opponent.userId(), opponent.socketSessionId());
        connectionService.registerSocket(player.userId(), player.socketSessionId());

        return session.players().stream()
                .map(matchPlayer -> eventFactory.forPlayer(
                        session,
                        matchPlayer,
                        "MATCH_STARTED",
                        "LOADOUT_SELECT",
                        null,
                        "Match accepted. Choose your opening loadout."))
                .toList();
    }

    public List<OutboundMatchmakingEvent> surrender(UUID userId) {
        MatchSession session = state.activeSessionsByUserId().get(userId);
        if (session == null || session.seriesComplete()) return List.of();

        MatchPlayer resigningPlayer = playerForUser(session, userId);
        MatchPlayer winner = session.players().stream()
                .filter(player -> !player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("opponent was not found"));
        persistenceService.completeMatchByForfeit(
                session.matchId(),
                resigningPlayer,
                winner,
                COMPLETION_REASON_RESIGNATION);
        clearSession(session);

        MatchPlaybackDTO result = new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "COMPLETED",
                null,
                List.of(),
                "RESIGNATION_WIN",
                winner.userId(),
                winner.username() + " wins by resignation.");
        Instant now = Instant.now(clock);
        return session.players().stream()
                .map(player -> eventFactory.forPlayer(
                        session,
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
