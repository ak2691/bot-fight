package com.example.botfight.service.match.resolution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.coordination.MatchLockService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.replay.MatchReplayService;
import com.example.botfight.service.match.resolution.MatchRoundResolutionService;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.state.MatchSubmissionKey;
import com.example.botfight.service.match.state.PreparedReplay;
import com.example.botfight.service.match.submission.MatchSubmissionService;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/**
 * a failure after round resolution mutates in-memory state (round
 * history, submissions) but before the transaction commits must leave the
 * round retryable, so the controller's retry can still record the result.
 */
class MatchRoundResolutionServiceTest {

    @Test
    void retryAfterTerminalPersistenceFailureStillResolvesRound() {
        retryAfterPersistenceFailure(false);
    }

    @Test
    void retryAfterResultVisibilityWriteFailureStillResolvesRound() {
        retryAfterPersistenceFailure(true);
    }

    private void retryAfterPersistenceFailure(boolean visibilityWriteFails) {
        MatchRuntimeState state = new MatchRuntimeState();
        MatchPersistenceService persistence = mock(MatchPersistenceService.class);
        MatchEventFactory eventFactory = mock(MatchEventFactory.class);
        MatchSubmissionService submissions = new MatchSubmissionService(
                state.activeSessionsByUserId(),
                state.matchSubmissionsByKey(),
                state.roundHistoryByMatchId(),
                Clock.systemUTC(),
                new JsonMapper(),
                persistence,
                null,
                eventFactory);
        MatchSimulationService simulation = mock(MatchSimulationService.class);
        MatchReplayService replay = mock(MatchReplayService.class);

        UUID matchId = UUID.nameUUIDFromBytes("res01-match".getBytes());
        UUID first = UUID.nameUUIDFromBytes("res01-first".getBytes());
        UUID second = UUID.nameUUIDFromBytes("res01-second".getBytes());
        // Round 2, first player already has one win: winning this round ends the series.
        MatchSession session = new MatchSession(
                matchId,
                7L,
                List.of(
                        new MatchPlayer(first, "One", "one", 1, true, UUID.randomUUID(), 1, "ranged", true),
                        new MatchPlayer(second, "Two", "two", 2, true, UUID.randomUUID(), 0, "melee", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                2,
                2,
                List.of(),
                Map.of());
        state.putSession(session);
        state.matchSubmissionsByKey().put(
                new MatchSubmissionKey(matchId, 2, MatchSubmissionService.BUILDING_PHASE, first),
                mock(BotSubmission.class));
        state.matchSubmissionsByKey().put(
                new MatchSubmissionKey(matchId, 2, MatchSubmissionService.BUILDING_PHASE, second),
                mock(BotSubmission.class));

        MatchReplayDTO playback = new MatchReplayDTO(
                null, List.of(), "WIN", first, "One wins", null, null, null, null, null, null, null);
        when(simulation.buildDuelReplay(any(), anyMap())).thenReturn(playback);
        when(replay.withRoundWinsBeforeResult(any(), anyMap())).thenReturn(playback);
        when(replay.withWinner(any(), any(), any())).thenReturn(playback);
        when(replay.prepare(any())).thenReturn(new PreparedReplay(playback, playback, 1000, List.of()));

        // First attempt: the terminal result write fails (DB error / rollback).
        if (visibilityWriteFails) {
            doThrow(new RuntimeException("simulated commit failure")).doNothing()
                    .when(persistence).setResultVisibleAt(eq(matchId), any(Instant.class));
        } else {
            doThrow(new RuntimeException("simulated commit failure")).doNothing()
                    .when(persistence).completeMatch(eq(matchId), any(MatchReplayDTO.class));
        }

        MatchRoundResolutionService service = new MatchRoundResolutionService(
                state,
                Clock.systemUTC(),
                new MatchLockService(),
                simulation,
                persistence,
                mock(MatchConnectionService.class),
                eventFactory,
                replay,
                submissions,
                mock(MatchChatService.class));

        assertThatThrownBy(() -> service.completeSimulation(matchId))
                .hasMessage("simulated commit failure");
        assertThat(state.roundHistoryByMatchId().get(matchId))
                .hasSize(visibilityWriteFails ? 1 : 0);

        // The DB work rolled back; the controller retries the same round.
        // Correct behavior: the retry resolves the round and persists the result.
        assertThatCode(() -> service.completeSimulation(matchId))
                .as("retry of the same round after a rolled-back attempt")
                .doesNotThrowAnyException();
        verify(persistence, times(2)).completeMatch(eq(matchId), any(MatchReplayDTO.class));
        assertThat(state.activeSessionForMatch(matchId).isReplay()).isTrue();
    }

    @Nested
    class SeriesResults {
        @Test
        void tiedOneOnOneRoundWinsResolveToDraw() throws Exception {
            assertThat(seriesWinner(List.of(player(1, 1, 1), player(2, 2, 1)))).isNull();
        }

        @Test
        void tiedTeamRoundWinsResolveToDraw() throws Exception {
            assertThat(seriesWinner(List.of(
                    player(1, 1, 1), player(2, 1, 1),
                    player(3, 2, 1), player(4, 2, 1)))).isNull();
        }

        @Test
        void greaterRoundWinsSelectWinner() throws Exception {
            MatchPlayer winner = player(1, 1, 2);
            assertThat(seriesWinner(List.of(winner, player(2, 2, 1)))).isEqualTo(winner.userId());
        }

        private UUID seriesWinner(List<MatchPlayer> players) throws Exception {
            MatchSession session = mock(MatchSession.class);
            when(session.players()).thenReturn(players);
            MatchRoundResolutionService service = new MatchRoundResolutionService(
                    null, null, null, null, null, null, null, null, null, null);
            Method method = MatchRoundResolutionService.class.getDeclaredMethod("seriesWinner", MatchSession.class);
            method.setAccessible(true);
            return (UUID) method.invoke(service, session);
        }

        private MatchPlayer player(int slot, int team, int wins) {
            return new MatchPlayer(UUID.randomUUID(), "p" + slot, "p" + slot, slot,
                    team, true, null, wins, null, true);
        }
    }
}
