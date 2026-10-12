package com.example.botfight.service.match;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.model.MatchSubmissionResult;


import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.support.TestMatches;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.*;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchTimingWorkflowTest extends MatchWorkflowFixture {
    @Test
    void revealsBothFullKitsForTenSecondsWithoutSpendingClocks() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        var started = service.startMatch(com.example.botfight.support.TestKits.entrant(first,"one","one",null),
                com.example.botfight.support.TestKits.entrant(second,"two","two",null), MatchMode.ONES, true);
        var event = started.getFirst().event();
        assertThat(started).allMatch(service::isCurrentEvent);
        assertThat(event.status()).isEqualTo("KIT_REVEAL");
        assertThat(event.players()).allSatisfy(player -> {
            assertThat(player.selectedLoadout()).isEqualTo(com.example.botfight.support.TestKits.KIT);
            assertThat(player.clockRemainingMs()).isEqualTo(180_000);
        });
        assertThat(event.loadoutSelectionEndsAt()).isEqualTo(clock.instant().plusSeconds(10));
        assertThat(event.timedRounds().unlockedTier()).isEqualTo(1);
        assertThat(service.isCurrentMatchSubmission(first, savedMatch.getId(), 1, "BUILDING")).isFalse();
        clock.advance(Duration.ofSeconds(9));
        assertThat(timing.resolveExpiredLoadoutSelections()).isEmpty();
        clock.advance(Duration.ofSeconds(1));
        var building = timing.resolveExpiredLoadoutSelections();
        assertThat(building).hasSize(2).allMatch(service::isCurrentEvent);
        assertThat(building.getFirst().event().players()).allSatisfy(player -> assertThat(player.clockRemainingMs()).isEqualTo(225_000));
        assertThat(timing.resolveExpiredLoadoutSelections()).isEmpty();
    }

    @Test
    void aSubmitDeductsTheTimeSpentBuildingFromThatPlayersClockOnly() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<OutboundMatchmakingEvent> building = startDuelBuild(first, second);
        Instant buildStart = clock.instant();

        MatchmakingEventDTO started = building.getFirst().event();
        assertThat(started.countdownEndsAt()).isEqualTo(buildStart);
        for (UUID userId : List.of(first, second)) {
            // The 5:00 base plus the round's 30 second increment, and a deadline to match.
            assertThat(playerOf(started, userId).clockRemainingMs()).isEqualTo(225_000L);
            assertThat(playerOf(started, userId).buildEndsAt()).isEqualTo(buildStart.plusSeconds(225));
        }

        clock.advance(Duration.ofSeconds(100));
        MatchmakingEventDTO afterFirst = submit(first).getFirst().event();
        assertThat(playerOf(afterFirst, first).clockRemainingMs()).isEqualTo(125_000L);
        assertThat(playerOf(afterFirst, first).buildEndsAt()).isNull();
        assertThat(playerOf(afterFirst, first).finished()).isTrue();
        // The other player's clock did not move.
        assertThat(playerOf(afterFirst, second).clockRemainingMs()).isEqualTo(225_000L);
        assertThat(playerOf(afterFirst, second).buildEndsAt()).isEqualTo(buildStart.plusSeconds(225));
        assertThat(playerOf(afterFirst, second).finished()).isFalse();
    }

    @Test
    void aSubmitInsideTheGraceIsAcceptedAtZeroAndOneAfterItIsRejected() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        startDuelBuild(first, second);
        Instant buildStart = clock.instant();

        // 331 s: past the visible 330 s deadline, inside the 2 s grace.
        clock.advance(Duration.ofSeconds(226));
        assertThat(service.isCurrentMatchSubmission(first, savedMatch.getId(), 1, "BUILDING")).isTrue();
        MatchmakingEventDTO accepted = submit(first).getFirst().event();
        assertThat(playerOf(accepted, first).clockRemainingMs()).isZero();

        // 333 s: the grace is over.
        clock.advance(Duration.ofSeconds(2));
        assertThat(service.isCurrentMatchSubmission(second, savedMatch.getId(), 1, "BUILDING")).isFalse();
        UUID lateSubmission = UUID.randomUUID();
        stubSubmission(second, lateSubmission, BRAIN);
        MatchSubmissionResult late = service.acceptMatchSubmission(
                second, savedMatch.getId(), 1, "BUILDING", persistedSubmissions.get(lateSubmission));
        assertThat(late.accepted()).isFalse();
        assertThat(buildStart).isBefore(clock.instant());
    }

    @Test
    void theCurrentFallbackGetsTheGraceAndThenResubmitsLastRoundsBrain() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        startDuelBuild(first, second);

        clock.advance(Duration.ofSeconds(226));
        assertThat(timing.resolveExpiredBuildingSessions())
                .as("CURRENT keeps the player open for the grace so an auto-submit can still arrive")
                .isEmpty();
        clock.advance(Duration.ofSeconds(1));
        List<OutboundMatchmakingEvent> resolved = timing.resolveExpiredBuildingSessions();

        assertThat(resolved).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo(MatchEventType.SIMULATION_LOADING));
        assertThat(resolved.getFirst().event().players())
                .allSatisfy(player -> assertThat(player.clockRemainingMs()).isZero());
        assertThat(service.completeSimulation(savedMatch.getId())).isNotEmpty();
    }

    @Test
    void thePreviousFallbackResolvesExactlyAtTheDeadlineWithoutCuttingAnyoneElseOff() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        startDuelBuild(first, second);

        List<OutboundMatchmakingEvent> chosen =
                timing.setTimeoutFallback(first, savedMatch.getId(), 1, "PREVIOUS");
        assertThat(chosen).isNotEmpty();
        assertThat(playerOf(chosen.getFirst().event(), first).timeoutFallback()).isEqualTo("PREVIOUS");
        assertThat(playerOf(chosen.getFirst().event(), second).timeoutFallback()).isEqualTo("CURRENT");
        assertThat(timing.setTimeoutFallback(first, savedMatch.getId(), 1, "SOMETHING")).isEmpty();

        clock.advance(Duration.ofSeconds(225));
        List<OutboundMatchmakingEvent> resolved = timing.resolveExpiredBuildingSessions();

        assertThat(resolved).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo(MatchEventType.PLAYER_FINISHED));
        MatchmakingEventDTO event = resolved.getFirst().event();
        assertThat(playerOf(event, first).finished()).isTrue();
        assertThat(playerOf(event, first).clockRemainingMs()).isZero();
        assertThat(playerOf(event, second).finished()).isFalse();
        // The other player is on CURRENT: still open for the grace, and a valid submit is accepted.
        clock.advance(Duration.ofSeconds(1));
        MatchmakingEventDTO accepted = submit(second).getFirst().event();
        assertThat(playerOf(accepted, second).finished()).isTrue();
        assertThat(playerOf(accepted, second).clockRemainingMs()).isZero();
    }

    @Test
    void sixRoundsGoStraightToBuildWithKnownUnlocksAndAlternatingIncrements() {
        knockoutRound = Integer.MAX_VALUE;
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            simulatedSessions.add(session);
            return finalSegment(session, 180, 60);
        });
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        var build = startDuelBuild(first, second);
        for (int round = 1; round <= 6; round++) {
            var event = lastEventFor(service.resumeMatch(first,"one","pilot-one@example.com",null), first);
            assertThat(event.roundNumber()).isEqualTo(round);
            assertThat(event.status()).isEqualTo("PREP");
            assertThat(event.loadoutSelectionEndsAt()).isNull();
            assertThat(event.timedRounds().unlockedTier()).isEqualTo(MatchLoadoutService.unlockedTier(round));
            assertThat(event.timedRounds().incrementSeconds()).isEqualTo(round % 2 == 1 ? 45 : 30);
            assertThat(event.players()).allSatisfy(player -> assertThat(player.selectedLoadout()).isEqualTo(com.example.botfight.support.TestKits.KIT));
            var events = playRound(first, second, true);
            if (round < 6) openNextRound(events);
        }
        assertThat(simulatedSessions.stream().map(MatchSession::roundNumber)).containsExactly(1,2,3,4,5,6);
    }

    @Test
    void twoVersusTwoHasAPerPlayerClockFromSevenMinutesAndOneExpiredTeammateDoesNotAffectTheOthers() {
        List<UUID> ids = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        UUID blueA = ids.get(0);
        UUID blueD = ids.get(1);
        UUID redB = ids.get(2);
        UUID redC = ids.get(3);
        List<MatchEntrant> entrants = List.of(
                com.example.botfight.support.TestKits.entrant(blueA, "blue-a", "blue-a@example.com", null, 1),
                com.example.botfight.support.TestKits.entrant(blueD, "blue-d", "blue-d@example.com", null, 1),
                com.example.botfight.support.TestKits.entrant(redB, "red-b", "red-b@example.com", null, 2),
                com.example.botfight.support.TestKits.entrant(redC, "red-c", "red-c@example.com", null, 2));
        List<OutboundMatchmakingEvent> started = service.startTeamMatch(entrants, MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null);
        MatchmakingEventDTO startEvent = started.getFirst().event();
        // Offers are shared by all four players.
        assertThat(startEvent.players()).allSatisfy(player ->
                assertThat(player.clockRemainingMs()).isEqualTo(240_000L));

        List<OutboundMatchmakingEvent> building = List.of();
        for (UUID userId : ids) building = pick(userId);
        Instant buildStart = clock.instant();
        MatchmakingEventDTO buildEvent = building.getFirst().event();
        // 7:00 base plus the 30 second increment.
        assertThat(buildEvent.players()).allSatisfy(player -> {
            assertThat(player.clockRemainingMs()).isEqualTo(285_000L);
            assertThat(player.buildEndsAt()).isEqualTo(buildStart.plusSeconds(285));
        });

        clock.advance(Duration.ofSeconds(60));
        MatchmakingEventDTO afterA = submit(blueA).getFirst().event();
        clock.advance(Duration.ofSeconds(140));
        submit(redB);
        MatchmakingEventDTO afterC = submit(redC).getFirst().event();
        assertThat(playerOf(afterA, blueA).clockRemainingMs()).isEqualTo(225_000L);
        assertThat(playerOf(afterC, redB).clockRemainingMs()).isEqualTo(85_000L);
        assertThat(playerOf(afterC, redC).clockRemainingMs()).isEqualTo(85_000L);
        // The fourth player is the only one still building, on their own untouched clock.
        assertThat(playerOf(afterC, blueD).finished()).isFalse();
        assertThat(playerOf(afterC, blueD).clockRemainingMs()).isEqualTo(285_000L);

        clock.advance(Duration.ofSeconds(86));
        assertThat(timing.resolveExpiredBuildingSessions()).isEmpty();
        clock.advance(Duration.ofSeconds(1));
        List<OutboundMatchmakingEvent> expired = timing.resolveExpiredBuildingSessions();
        assertThat(expired).hasSize(4).allSatisfy(event ->
                assertThat(event.event().type()).isEqualTo(MatchEventType.SIMULATION_LOADING));
        MatchmakingEventDTO afterExpiry = expired.getFirst().event();
        assertThat(playerOf(afterExpiry, blueD).clockRemainingMs()).isZero();
        assertThat(playerOf(afterExpiry, blueA).clockRemainingMs()).isEqualTo(225_000L);
        assertThat(playerOf(afterExpiry, redB).clockRemainingMs()).isEqualTo(85_000L);

        // Round two: each player's clock is what they saved plus the increment; the expired one has 30 s.
        List<OutboundMatchmakingEvent> roundOne = service.completeSimulation(savedMatch.getId());
        openNextRound(roundOne);
        for (UUID userId : ids) building = pick(userId);
        Instant secondBuildStart = clock.instant();
        MatchmakingEventDTO secondBuild = lastEventFor(building, blueA);
        assertThat(playerOf(secondBuild, blueA).clockRemainingMs()).isEqualTo(255_000L);
        assertThat(playerOf(secondBuild, redB).clockRemainingMs()).isEqualTo(115_000L);
        assertThat(playerOf(secondBuild, redC).clockRemainingMs()).isEqualTo(115_000L);
        assertThat(playerOf(secondBuild, blueD).clockRemainingMs()).isEqualTo(30_000L);
        assertThat(playerOf(secondBuild, blueD).buildEndsAt()).isEqualTo(secondBuildStart.plusSeconds(30));
    }
}
