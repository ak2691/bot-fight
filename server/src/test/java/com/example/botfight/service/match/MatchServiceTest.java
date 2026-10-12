package com.example.botfight.service.match;

import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;


import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.support.TestMatches;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.service.match.model.*;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class MatchServiceTest extends MatchWorkflowFixture {
    @Test
    void blockedTransitionInOneMatchDoesNotBlockAnotherMatch() throws Exception {
        UUID firstMatchFirstUser = UUID.randomUUID();
        UUID firstMatchSecondUser = UUID.randomUUID();
        UUID secondMatchFirstUser = UUID.randomUUID();
        UUID secondMatchSecondUser = UUID.randomUUID();
        UUID firstMatchId = service.startMatch(com.example.botfight.support.TestKits.entrant(firstMatchFirstUser, "alpha-one", "alpha-one@example.com", null), com.example.botfight.support.TestKits.entrant(firstMatchSecondUser, "alpha-two", "alpha-two@example.com", null), MatchMode.ONES, true)
                .getFirst().event().matchId();
        UUID secondMatchId = service.startMatch(com.example.botfight.support.TestKits.entrant(secondMatchFirstUser, "beta-one", "beta-one@example.com", null), com.example.botfight.support.TestKits.entrant(secondMatchSecondUser, "beta-two", "beta-two@example.com", null), MatchMode.ONES, true)
                .getFirst().event().matchId();
        clock.advance(java.time.Duration.ofSeconds(10));

        CountDownLatch firstMatchEnteredBlockedWork = new CountDownLatch(1);
        CountDownLatch releaseFirstMatch = new CountDownLatch(1);
        when(matchParticipantRepository.findByMatchIdAndUserId(any(UUID.class), any(UUID.class))).thenAnswer(invocation -> {
            UUID matchId = invocation.getArgument(0);
            UUID userId = invocation.getArgument(1);
            if (matchId.equals(firstMatchId)) {
                firstMatchEnteredBlockedWork.countDown();
                if (!releaseFirstMatch.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("timed out waiting to release the first match");
                }
                return Optional.empty();
            }
            return participants.stream()
                    .filter(participant -> participant.getUser().getId().equals(userId))
                    .findFirst();
        });

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<List<OutboundMatchmakingEvent>> blockedFirstMatch =
                    executor.submit(() -> timing.resolveLoadoutSelectionTimeout(firstMatchId));
            assertThat(firstMatchEnteredBlockedWork.await(2, TimeUnit.SECONDS)).isTrue();

            Future<List<OutboundMatchmakingEvent>> independentSecondMatch =
                    executor.submit(() -> timing.resolveLoadoutSelectionTimeout(secondMatchId));
            assertThat(independentSecondMatch.get(1, TimeUnit.SECONDS))
                    .isNotEmpty()
                    .allSatisfy(outbound -> assertThat(outbound.event().matchId()).isEqualTo(secondMatchId));

            releaseFirstMatch.countDown();
            assertThat(blockedFirstMatch.get(2, TimeUnit.SECONDS)).isNotEmpty();
        } finally {
            releaseFirstMatch.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void ratedReplayStreamsTheAuthoritativeResultWithTheBufferedTerminalFrame() {
        List<String> preparationSteps = new ArrayList<>();
        List<Integer> authoritativeElapsedMs = new ArrayList<>();
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            preparationSteps.add("simulation");
            MatchSession session = invocation.getArgument(0);
            MatchPlayer winner = session.players().getLast();
            for (int elapsedMs = 0; elapsedMs <= 50_500; elapsedMs += 100) authoritativeElapsedMs.add(elapsedMs);
            return replay(session, outcome(session), knockoutWinner(session, winner.userId()), authoritativeElapsedMs);
        });
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(com.example.botfight.support.TestKits.queue(
                firstUserId,
                "pilot-one",
                "pilot-one@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        matchmakingService.joinQueue(com.example.botfight.support.TestKits.queue(
                secondUserId,
                "pilot-two",
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        TestMatches.beginBuild(service, firstUserId);
        TestMatches.beginBuild(service, secondUserId);
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);

        List<OutboundMatchmakingEvent> preparingEvents =
                submitMatch(secondUserId, secondSubmissionId);
        assertThat(preparingEvents).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo(MatchEventType.SIMULATION_LOADING));
        assertThat(preparingEvents).allSatisfy(outbound ->
                assertThat(outbound.event().playbackStartsAt()).isNull());
        assertThat(simulatedSessions).isEmpty();
        clock.advance(Duration.ofSeconds(7));
        List<OutboundMatchmakingEvent> events =
                service.completeSimulation(savedMatch.getId());

        assertThat(preparationSteps).containsExactly("simulation");
        assertThat(events.stream()
                .filter(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .map(outbound -> outbound.event().type().name())
                .toList())
                .startsWith("SIMULATION_PREPARING", "MATCH_REPLAY_BATCH")
                .endsWith("MATCH_REPLAY_BATCH", "MATCH_ROUND_READY");

        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals(MatchEventType.SIMULATION_PREPARING))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().serverNow()).isEqualTo(clock.instant());
                    assertThat(outbound.event().playbackStartsAt()).isEqualTo(clock.instant().plusSeconds(3));
                    assertThat(outbound.event().simulationPreparingDurationMs()).isEqualTo(3_000L);
                    assertThat(elapsed(outbound.event().playback())).isEmpty();
                    assertThat(outbound.event().roundBrains()).isEmpty();
                });

        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals(MatchEventType.SIMULATION_PREPARING))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().playback().winnerUserId()).isNull();
                    assertThat(outbound.event().playback().result()).isNull();
                    assertThat(outbound.event().playbackStartsAt()).isEqualTo(clock.instant().plusSeconds(3));
                    assertThat(outbound.event().resultRevealsAt()).isAfter(outbound.event().playbackStartsAt());
                    assertThat(outbound.event().roundReadyAt()).isAfter(outbound.event().resultRevealsAt());
                    assertThat(viewerParticipant(outbound.event())).isNotNull();
                    assertThat(opponentParticipant(outbound.event())).isNotNull();
                    assertThat(outbound.event().eventSchemaVersion()).isEqualTo(2);
                    assertThat(outbound.event().players()).hasSize(2);
                    assertThat(outbound.delayMillis()).isZero();
                    assertThat(outbound.publishAt()).isNull();
                });
        List<OutboundMatchmakingEvent> replayBatches = events.stream()
                .filter(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .filter(outbound -> outbound.event().type().equals(MatchEventType.MATCH_REPLAY_BATCH))
                .toList();
        List<OutboundMatchmakingEvent> replayFrameBatches = replayBatches.stream()
                .filter(outbound -> !elapsed(outbound.event().playback()).isEmpty())
                .toList();
        assertThat(replayFrameBatches).isNotEmpty();
        assertThat(replayFrameBatches.getFirst().delayMillis()).isEqualTo(2_000L);
        assertThat(replayFrameBatches.getFirst().publishAt()).isEqualTo(clock.instant().plusSeconds(2));
        assertThat(elapsed(replayFrameBatches.getFirst().event().playback()).getLast())
                .isEqualTo(1_000);
        assertThat(replayFrameBatches.getLast().delayMillis()).isEqualTo(51_500L);
        assertThat(replayFrameBatches.getLast().publishAt()).isEqualTo(clock.instant().plusMillis(51_500));
        assertThat(replayFrameBatches.getLast().event().playback().terminalBatch()).isTrue();
        assertThat(elapsed(replayFrameBatches.getLast().event().playback()).getLast())
                .isEqualTo(50_500);
        assertThat(replayFrameBatches).allSatisfy(outbound -> {
            assertThat(outbound.event().playback().result()).isNull();
            assertThat(outbound.event().playback().winnerUserId()).isNull();
            assertThat(outbound.event().playback().message()).isNull();
        });
        assertThat(replayBatches)
                .filteredOn(outbound -> elapsed(outbound.event().playback()).isEmpty())
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("ROUND_RESULT_READY");
                    assertThat(outbound.delayMillis()).isEqualTo(53_500L);
                    assertThat(outbound.publishAt()).isEqualTo(clock.instant().plusMillis(53_500));
                    // A continuing round has no winner: the fight carries into the next segment.
                    assertThat(outbound.event().playback().result()).isEqualTo("CONTINUES");
                    assertThat(outbound.event().playback().winnerUserId()).isNull();
                });
        assertThat(replayBatches.stream()
                .flatMap(outbound -> elapsed(outbound.event().playback()).stream())
                                .toList()).containsExactlyElementsOf(authoritativeElapsedMs);
        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals(MatchEventType.MATCH_ROUND_READY))
                .allSatisfy(outbound -> {
                    assertThat(outbound.delayMillis()).isEqualTo(56_500L);
                    assertThat(outbound.event().resultRevealsAt())
                            .isEqualTo(clock.instant().plusMillis(53_500));
                    assertThat(outbound.event().roundReadyAt())
                            .isEqualTo(clock.instant().plusMillis(56_500));
                    assertThat(Duration.between(
                            outbound.event().resultRevealsAt(),
                            outbound.event().roundReadyAt())).isEqualTo(Duration.ofSeconds(3));
                    assertThat(outbound.publishAt()).isEqualTo(outbound.event().roundReadyAt());
                    assertThat(outbound.event().loadoutSelectionEndsAt()).isNull();
                });
        assertThat(TestMatches.beginBuild(service, firstUserId)).isEmpty();
        assertThat(TestMatches.beginBuild(service, secondUserId)).isEmpty();
        assertThat(service.resolveLoadoutSelectionTimeout(savedMatch.getId()))
                .as("a stale prior-round timeout cannot advance a round whose selection is not active")
                .isEmpty();
        List<OutboundMatchmakingEvent> activatedRoundEvents = service.beginNextRound(savedMatch.getId(), 1);
        assertThat(activatedRoundEvents).allSatisfy(outbound ->
                assertThat(outbound.event().loadoutSelectionEndsAt())
                        .isEqualTo(clock.instant().plusSeconds(22)));
        assertThat(service.matchChatCloseAt(savedMatch.getId())).isNull();
    }

    @Test
    void roundSixDecidesAMatchWithNoKnockoutByTeamHp() {
        knockoutRound = Integer.MAX_VALUE;
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation ->
                finalSegment(invocation.getArgument(0), 90, 140));
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        List<OutboundMatchmakingEvent> events = playToTheLastRound(first, second);

        assertThat(events).noneMatch(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()));
        assertThat(events).filteredOn(event -> MatchEventType.MATCH_RESULT_READY.equals(event.event().type()))
                .hasSize(2)
                .allSatisfy(event -> {
                    assertThat(event.event().playback().result()).isEqualTo("BOT_WIN");
                    assertThat(event.event().playback().message()).isEqualTo("Red Team wins on HP.");
                    var decision = event.event().timedRounds().hpDecision();
                    assertThat(decision.teamHp()).containsEntry(1, 90.0).containsEntry(2, 140.0);
                    assertThat(decision.winningTeam()).isEqualTo(2);
                });
        assertThat(savedMatch.getCompletionReason()).isEqualTo("HP_DECISION");
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(second);
    }
}
