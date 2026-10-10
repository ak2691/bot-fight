package com.example.botfight.service.match;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;


import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.support.TestMatches;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.service.match.MatchPersistenceService;
import com.example.botfight.service.match.model.*;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchRoundResolutionWorkflowTest extends MatchWorkflowFixture {
    @Test
    void exhaustedSimulationFailureCancelsMatchWithoutAnOutcomeOrRatingChange() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        UUID matchId = service.startMatch(new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null), new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null), MatchMode.ONES, true)
                .getFirst().event().matchId();
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        List<OutboundMatchmakingEvent> cancellationEvents = resolution.cancelFailedSimulation(matchId, 1);

        assertThat(cancellationEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_RESULT_READY);
            assertThat(outbound.event().status()).isEqualTo("CANCELLED");
            assertThat(outbound.event().playback()).isNull();
            assertThat(outbound.event().message()).contains("cancelled");
            assertThat(service.isCurrentEvent(outbound)).isTrue();
        });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.CANCELLED);
        assertThat(savedMatch.getCompletionReason())
                .isEqualTo(MatchPersistenceService.COMPLETION_REASON_SIMULATION_FAILURE);
        assertThat(savedMatch.getWinnerUser()).isNull();
        assertThat(participants).hasSize(2).allSatisfy(participant -> {
            assertThat(participant.getResult()).isNull();
            assertThat(participant.getRatingAfter()).isNull();
        });
        assertThat(service.activeMatchStatus(firstUserId).activeMatch()).isFalse();
        assertThat(service.activeMatchStatus(secondUserId).activeMatch()).isFalse();
    }

    @Test
    void simulationErrorRemainsRetryableUntilControllerCancelsIt() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        UUID matchId = service.startMatch(new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null), new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null), MatchMode.ONES, true)
                .getFirst().event().matchId();
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);
        MatchReplayDTO failedReplay = mock(MatchReplayDTO.class);
        when(failedReplay.result()).thenReturn("ERROR");
        when(simulationService.buildDuelReplay(any(MatchSession.class), any()))
                .thenReturn(failedReplay);

        assertThatThrownBy(() -> resolution.completeSimulation(matchId))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("authoritative duel simulation failed");
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
        assertThat(participants).allSatisfy(participant -> assertThat(participant.getResult()).isNull());
        assertThat(service.activeMatchStatus(firstUserId).activeMatch()).isTrue();

        assertThat(resolution.cancelFailedSimulation(matchId, 1)).hasSize(2);

        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.CANCELLED);
        assertThat(participants).allSatisfy(participant -> assertThat(participant.getResult()).isNull());
    }

    @Test
    void singlePlayerForfeitDuringReplayCompletesAOneVersusOneMatch() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(new QueueJoinRequest(
                firstUserId,
                "pilot-one",
                "pilot-one@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        matchmakingService.joinQueue(new QueueJoinRequest(
                secondUserId,
                "pilot-two",
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        assertThat(resolution.completeSimulation(savedMatch.getId())).isNotEmpty();

        List<OutboundMatchmakingEvent> events = service.surrender(firstUserId);

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_RESULT_READY);
            assertThat(outbound.event().roundNumber()).isEqualTo(1);
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
            assertThat(outbound.event().playback().message()).isEqualTo("Red Team wins.");
            assertThat(outbound.delayMillis()).isZero();
        });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
        assertThat(service.surrender(firstUserId)).isEmpty();
    }

    @Test
    void terminalReplayStaysReplayCurrentAndRevealsResultWithAnExplicitDelayedEvent() {
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            MatchPlayer winner = session.players().getLast();
            return replay(session, outcome(session), knockoutWinner(session, winner.userId()), List.of(1000));
        });
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        String secondPrincipal = "pilot-two@example.com";
        matchmakingService.joinQueue(new QueueJoinRequest(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        matchmakingService.joinQueue(new QueueJoinRequest(
                secondUserId,
                "pilot-two",
                secondPrincipal,
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        submitMatch(firstUserId, firstRoundFirstSubmission);
        submitMatch(secondUserId, firstRoundSecondSubmission);
        List<OutboundMatchmakingEvent> firstRoundEvents = resolution.completeSimulation(savedMatch.getId());
        List<OutboundMatchmakingEvent> roundReadyEvents = firstRoundEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .toList();
        Instant secondRoundReadyAt = roundReadyEvents.getFirst().event().roundReadyAt();
        clock.advance(Duration.between(clock.instant(), secondRoundReadyAt));
        roundReadyEvents.forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));

        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        UUID secondRoundFirstSubmission = UUID.randomUUID();
        UUID secondRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, secondRoundFirstSubmission);
        stubSubmission(secondUserId, secondRoundSecondSubmission);
        submitMatch(firstUserId, secondRoundFirstSubmission);
        submitMatch(secondUserId, secondRoundSecondSubmission);

        List<OutboundMatchmakingEvent> terminalEvents = resolution.completeSimulation(savedMatch.getId());
        List<OutboundMatchmakingEvent> preparingEvents = terminalEvents.stream()
                .filter(event -> MatchEventType.SIMULATION_PREPARING.equals(event.event().type()))
                .toList();
        List<OutboundMatchmakingEvent> resultEvents = terminalEvents.stream()
                .filter(event -> MatchEventType.MATCH_RESULT_READY.equals(event.event().type()))
                .toList();

        assertThat(preparingEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.delayMillis()).isZero();
            assertThat(service.isCurrentEvent(event)).isTrue();
        });
        assertThat(resultEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.delayMillis()).isEqualTo(4_000L);
            assertThat(event.event().playback().result()).isEqualTo("BOT_WIN");
            assertThat(elapsed(event.event().playback())).isEmpty();
        });
        assertThat(terminalEvents)
                .noneMatch(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()));

        Instant resultRevealsAt = resultEvents.getFirst().event().resultRevealsAt();
        UUID terminalWinnerUserId = resultEvents.getFirst().event().playback().winnerUserId();
        assertThat(service.markDisconnected(firstPrincipal)).isEmpty();
        assertThat(service.activeMatchStatus(firstUserId).disconnected()).isFalse();
        clock.advance(Duration.between(clock.instant(), resultRevealsAt).plusMillis(1));

        assertThat(service.resumeMatch(firstUserId, "pilot-one", firstPrincipal, "socket-reconnected"))
                .anySatisfy(event -> assertThat(event.event().type()).isEqualTo(MatchEventType.NO_ACTIVE_MATCH));
        assertThat(service.activeMatchStatus(firstUserId).activeMatch()).isFalse();
        assertThat(service.activeMatchStatus(secondUserId).activeMatch())
                .as("the terminal session remains hidden from active-match checks")
                .isFalse();
        assertThat(service.submitChatMessage(firstUserId, savedMatch.getId(), "chat remains available", "ALL").status())
                .isEqualTo(MatchChatSubmissionStatus.ACCEPTED);
        assertThat(terminalWinnerUserId).isEqualTo(resultEvents.getFirst().event().playback().winnerUserId());
    }

    @Test
    void servicesScheduleDeadlinesAndSimulationFromStoredPhase() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        startDuelBuild(first, second);
        var deadlines = org.mockito.ArgumentCaptor.forClass(MatchSession.class);
        verify(scheduler, times(2)).deadlinesChanged(deadlines.capture());
        assertThat(deadlines.getAllValues()).extracting(session -> session.phase().wireStatus())
                .containsExactly("LOADOUT_SELECT", "PREP");
        submit(first);
        verify(scheduler, never()).simulate(any(), anyInt());
        submit(second);
        verify(scheduler).simulate(savedMatch.getId(), 1);
        assertThat(service.sessionForScheduling(savedMatch.getId()).phase().wireStatus()).isEqualTo("SIMULATION_LOADING");
        resolution.completeSimulation(savedMatch.getId());
        var replay = org.mockito.ArgumentCaptor.forClass(MatchSession.class);
        verify(scheduler).replay(replay.capture());
        assertThat(replay.getValue().phase().wireStatus()).isEqualTo("SIMULATION_PREPARING");
        assertThat(resolution.completeSimulation(savedMatch.getId())).isEmpty();
        assertThat(service.beginNextRound(savedMatch.getId(), 1)).isEmpty();
        clock.advance(Duration.between(clock.instant(), replay.getValue().roundReadyAt()));
        List<OutboundMatchmakingEvent> next = service.beginNextRound(savedMatch.getId(), 1);
        assertThat(next).hasSize(2).allSatisfy(event -> {
            assertThat(event.phase().wireStatus()).isEqualTo(event.event().status());
            assertThat(event.event().loadoutSelectionEndsAt()).isEqualTo(clock.instant().plusSeconds(22));
        });
        verify(scheduler, times(3)).deadlinesChanged(any());
        assertThat(service.beginNextRound(savedMatch.getId(), 1)).isEmpty();
    }

    @Test
    void aKnockoutEndsTheMatchWithoutPlayingTheRemainingRounds() {
        // The default stub: round 1 continues, round 2 is a knockout by slot 2's team.
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        startDuelBuild(first, second);
        List<OutboundMatchmakingEvent> roundOne = playRound(first, second, true);
        assertThat(roundOne).anyMatch(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()));
        assertThat(roundOne).noneMatch(event -> MatchEventType.MATCH_RESULT_READY.equals(event.event().type()));

        openNextRound(roundOne);
        List<OutboundMatchmakingEvent> roundTwo = playRound(first, second, false);

        assertThat(roundTwo).noneMatch(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()));
        assertThat(roundTwo).filteredOn(event -> MatchEventType.MATCH_RESULT_READY.equals(event.event().type()))
                .hasSize(2)
                .allSatisfy(event -> {
                    assertThat(event.event().playback().result()).isEqualTo("BOT_WIN");
                    assertThat(event.event().timedRounds().hpDecision()).isNull();
                });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("SIMULATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(simulatedSessions.getLast().players().stream()
                .filter(player -> player.slot() == 2).findFirst().orElseThrow().userId());
    }

    @Test
    void roundSixWithEqualTeamHpIsADraw() {
        knockoutRound = Integer.MAX_VALUE;
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation ->
                finalSegment(invocation.getArgument(0), 120, 120));
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        List<OutboundMatchmakingEvent> events = playToTheLastRound(first, second);

        assertThat(events).filteredOn(event -> MatchEventType.MATCH_RESULT_READY.equals(event.event().type()))
                .hasSize(2)
                .allSatisfy(event -> {
                    assertThat(event.event().playback().result()).isEqualTo("DRAW");
                    assertThat(event.event().playback().winnerUserId()).isNull();
                    assertThat(event.event().timedRounds().hpDecision().winningTeam()).isNull();
                });
        assertThat(savedMatch.getCompletionReason()).isEqualTo("HP_DECISION");
        assertThat(savedMatch.getWinnerUser()).isNull();
        assertThat(participants).allSatisfy(participant ->
                assertThat(participant.getResult()).isEqualTo(MatchResult.DRAW));
    }
}
