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
    void startsTheRoundOnePickWithWeaponOffersSharedAbilityOffersAndFullClocks() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        List<OutboundMatchmakingEvent> started = service.startMatch(new MatchEntrant(firstUserId, "alpha-one", "alpha-one@example.com", null), new MatchEntrant(secondUserId, "alpha-two", "alpha-two@example.com", null), MatchMode.ONES, true);

        assertThat(started)
                .allMatch(event -> "LOADOUT_SELECT".equals(event.event().status()))
                .allMatch(service::isCurrentEvent);
        // Round 1 pick: 30 seconds plus the hidden 2 second grace.
        assertThat(Duration.between(
                started.getFirst().event().serverNow(),
                started.getFirst().event().loadoutSelectionEndsAt()).getSeconds())
                .isEqualTo(32);

        MatchmakingEventDTO firstStarted = started.stream()
                .filter(event -> firstUserId.equals(event.event().viewerUserId()))
                .findFirst()
                .orElseThrow()
                .event();
        MatchmakingEventDTO secondStarted = started.stream()
                .filter(event -> secondUserId.equals(event.event().viewerUserId()))
                .findFirst()
                .orElseThrow()
                .event();
        assertThat(firstStarted.abilityOffers()).hasSize(3).doesNotContain(1);
        assertThat(secondStarted.abilityOffers()).isEqualTo(firstStarted.abilityOffers());
        assertThat(firstStarted.timedRounds().weaponOffers()).containsExactly(1, 35, 36, 37);
        assertThat(firstStarted.timedRounds().maxRounds()).isEqualTo(6);
        assertThat(firstStarted.timedRounds().baseClockSeconds()).isEqualTo(300);
        assertThat(firstStarted.timedRounds().incrementSeconds()).isEqualTo(30);
        assertThat(firstStarted.timedRounds().pickSeconds()).isEqualTo(30);
        assertThat(firstStarted.timedRounds().zoneStartsInRound()).isEqualTo(5);
        assertThat(firstStarted.players()).allSatisfy(player ->
                assertThat(player.clockRemainingMs()).isEqualTo(300_000L));
    }

    @Test
    void loadoutRequestFromAnOlderRoundIsIgnored() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID matchId = service.startMatch(new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null), new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null), MatchMode.ONES, true)
                .getFirst().event().matchId();

        assertThat(timing.selectLoadout(firstUserId, matchId, 2, "melee")).isEmpty();
        assertThat(timing.selectLoadout(firstUserId, matchId, 1, "melee")).isNotEmpty();
    }

    @Test
    void duplicateLoadoutSelectionIsIdempotentUnderTheMatchLock() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.startMatch(new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null), new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null), MatchMode.ONES, true);

        TestMatches.selectLoadout(service, firstUserId, "melee");
        List<OutboundMatchmakingEvent> duplicate =
                TestMatches.selectLoadout(service, firstUserId, "ranged");

        assertThat(duplicate).hasSize(1);
        assertThat(viewerParticipant(duplicate.getFirst().event()).loadoutSelected()).isTrue();
        assertThat(viewerParticipant(duplicate.getFirst().event()).selectedLoadout()).isEqualTo("melee");
        assertThat(TestMatches.selectLoadout(service, secondUserId, "melee")).hasSize(2);
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
            assertThat(playerOf(started, userId).clockRemainingMs()).isEqualTo(330_000L);
            assertThat(playerOf(started, userId).buildEndsAt()).isEqualTo(buildStart.plusSeconds(330));
        }

        clock.advance(Duration.ofSeconds(100));
        MatchmakingEventDTO afterFirst = submit(first).getFirst().event();
        assertThat(playerOf(afterFirst, first).clockRemainingMs()).isEqualTo(230_000L);
        assertThat(playerOf(afterFirst, first).buildEndsAt()).isNull();
        assertThat(playerOf(afterFirst, first).finished()).isTrue();
        // The other player's clock did not move.
        assertThat(playerOf(afterFirst, second).clockRemainingMs()).isEqualTo(330_000L);
        assertThat(playerOf(afterFirst, second).buildEndsAt()).isEqualTo(buildStart.plusSeconds(330));
        assertThat(playerOf(afterFirst, second).finished()).isFalse();
    }

    @Test
    void aSubmitInsideTheGraceIsAcceptedAtZeroAndOneAfterItIsRejected() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        startDuelBuild(first, second);
        Instant buildStart = clock.instant();

        // 331 s: past the visible 330 s deadline, inside the 2 s grace.
        clock.advance(Duration.ofSeconds(331));
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

        clock.advance(Duration.ofSeconds(331));
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

        clock.advance(Duration.ofSeconds(330));
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
    void picksFollowTheTierScheduleThroughAllSixRounds() {
        knockoutRound = Integer.MAX_VALUE;
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            simulatedSessions.add(session);
            return finalSegment(session, 180, 60);
        });
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        matchmakingService.joinQueue(new QueueJoinRequest(
                first,
                "pilot-one",
                "pilot-one@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        List<OutboundMatchmakingEvent> started =
                matchmakingService.joinQueue(new QueueJoinRequest(
                        second,
                        "pilot-two",
                        "pilot-two@example.com",
                        null,
                        MatchMode.ONES,
                        null,
                        null,
                        QueuePool.REGISTERED));
        int[] offerCounts = {3, 3, 3, 3, 2, 2};
        String previous = "";

        // Round 1: nobody picks, so the server picks Slash and the first offer once the phase ends.
        MatchmakingEventDTO roundOne = started.stream()
                .filter(event -> MatchEventType.MATCH_STARTED.equals(event.event().type()))
                .findFirst().orElseThrow().event();
        assertThat(roundOne.abilityOffers()).hasSize(3);
        assertThat(roundOne.timedRounds().weaponOffers()).containsExactly(1, 35, 36, 37);
        clock.advance(Duration.ofSeconds(33));
        List<OutboundMatchmakingEvent> building = timing.resolveExpiredLoadoutSelections();
        assertThat(building).isNotEmpty();
        MatchmakingEventDTO afterTimeout = building.getFirst().event();
        String slashAndFirstOffer = playerOf(afterTimeout, first).selectedLoadout();
        assertThat(slashAndFirstOffer).startsWith("custom:s").hasSize("custom:".length() + 2);
        assertThat(playerOf(afterTimeout, second).selectedLoadout()).isEqualTo(slashAndFirstOffer);
        previous = slashAndFirstOffer;
        afterTimeout.players().forEach(player -> carriedLoadouts.put(player.userId(), player.selectedLoadout()));

        List<OutboundMatchmakingEvent> roundEvents = playRound(first, second, true);
        for (int round = 2; round <= 6; round++) {
            openNextRound(roundEvents);
            MatchmakingEventDTO pick = lastEventFor(service.resumeMatch(
                    first, "pilot-one", "pilot-one@example.com", "socket-" + round), first);
            assertThat(pick.roundNumber()).isEqualTo(round);
            assertThat(pick.abilityOffers()).hasSize(offerCounts[round - 1]).doesNotContain(1);
            assertThat(pick.timedRounds().weaponOffers()).isEmpty();
            // The frozen end of the last segment travels with the round, and the zone ring warns of the
            // next size during the round before each contraction (round 4 shows 900, round 5 shows 600).
            assertThat(pick.timedRounds().segmentEndState()).hasSize(2);
            assertThat(pick.timedRounds().zoneStartsInRound()).isEqualTo(5);
            assertThat(pick.timedRounds().zoneNextDiameterUnits())
                    .isEqualTo(round == 4 ? Double.valueOf(900) : round == 5 ? Double.valueOf(600) : null);
            assertThat(Duration.between(clock.instant(), pick.loadoutSelectionEndsAt())).isEqualTo(Duration.ofSeconds(22));
            // The previous picks are the base of the new draft and an owned ability is never re-offered.
            for (char code : previous.substring("custom:".length()).toCharArray()) {
                assertThat(pick.abilityOffers()).doesNotContain(codeToId(code));
            }

            pick(first);
            List<OutboundMatchmakingEvent> picked = pick(second);
            String loadout = playerOf(picked.getFirst().event(), first).selectedLoadout();
            assertThat(loadout).startsWith(previous).hasSize(previous.length() + 1);
            // A timeout takes the first offer.
            assertThat(codeToId(loadout.charAt(loadout.length() - 1))).isEqualTo(pick.abilityOffers().getFirst());
            previous = loadout;
            roundEvents = playRound(first, second, true);
        }
        // Weapon plus six abilities, none repeated.
        assertThat(previous.substring("custom:".length())).hasSize(7);
        assertThat(previous.substring("custom:".length()).chars().distinct().count()).isEqualTo(7);
        assertThat(simulatedSessions.stream().map(MatchSession::roundNumber).toList())
                .containsExactly(1, 2, 3, 4, 5, 6);
    }

    @Test
    void twoVersusTwoHasAPerPlayerClockFromSevenMinutesAndOneExpiredTeammateDoesNotAffectTheOthers() {
        List<UUID> ids = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        UUID blueA = ids.get(0);
        UUID blueD = ids.get(1);
        UUID redB = ids.get(2);
        UUID redC = ids.get(3);
        List<MatchEntrant> entrants = List.of(
                new MatchEntrant(blueA, "blue-a", "blue-a@example.com", null, 1),
                new MatchEntrant(blueD, "blue-d", "blue-d@example.com", null, 1),
                new MatchEntrant(redB, "red-b", "red-b@example.com", null, 2),
                new MatchEntrant(redC, "red-c", "red-c@example.com", null, 2));
        List<OutboundMatchmakingEvent> started = service.startTeamMatch(entrants, MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null);
        MatchmakingEventDTO startEvent = started.getFirst().event();
        // Offers are shared by all four players.
        assertThat(started.stream().map(event -> event.event().abilityOffers()).distinct()).hasSize(1);
        assertThat(startEvent.players()).allSatisfy(player ->
                assertThat(player.clockRemainingMs()).isEqualTo(420_000L));

        List<OutboundMatchmakingEvent> building = List.of();
        for (UUID userId : ids) building = pick(userId);
        Instant buildStart = clock.instant();
        MatchmakingEventDTO buildEvent = building.getFirst().event();
        // 7:00 base plus the 30 second increment.
        assertThat(buildEvent.players()).allSatisfy(player -> {
            assertThat(player.clockRemainingMs()).isEqualTo(450_000L);
            assertThat(player.buildEndsAt()).isEqualTo(buildStart.plusSeconds(450));
        });

        clock.advance(Duration.ofSeconds(60));
        MatchmakingEventDTO afterA = submit(blueA).getFirst().event();
        clock.advance(Duration.ofSeconds(140));
        submit(redB);
        MatchmakingEventDTO afterC = submit(redC).getFirst().event();
        assertThat(playerOf(afterA, blueA).clockRemainingMs()).isEqualTo(390_000L);
        assertThat(playerOf(afterC, redB).clockRemainingMs()).isEqualTo(250_000L);
        assertThat(playerOf(afterC, redC).clockRemainingMs()).isEqualTo(250_000L);
        // The fourth player is the only one still building, on their own untouched clock.
        assertThat(playerOf(afterC, blueD).finished()).isFalse();
        assertThat(playerOf(afterC, blueD).clockRemainingMs()).isEqualTo(450_000L);

        clock.advance(Duration.ofSeconds(251));
        assertThat(timing.resolveExpiredBuildingSessions()).isEmpty();
        clock.advance(Duration.ofSeconds(1));
        List<OutboundMatchmakingEvent> expired = timing.resolveExpiredBuildingSessions();
        assertThat(expired).hasSize(4).allSatisfy(event ->
                assertThat(event.event().type()).isEqualTo(MatchEventType.SIMULATION_LOADING));
        MatchmakingEventDTO afterExpiry = expired.getFirst().event();
        assertThat(playerOf(afterExpiry, blueD).clockRemainingMs()).isZero();
        assertThat(playerOf(afterExpiry, blueA).clockRemainingMs()).isEqualTo(390_000L);
        assertThat(playerOf(afterExpiry, redB).clockRemainingMs()).isEqualTo(250_000L);

        // Round two: each player's clock is what they saved plus the increment; the expired one has 30 s.
        List<OutboundMatchmakingEvent> roundOne = service.completeSimulation(savedMatch.getId());
        openNextRound(roundOne);
        for (UUID userId : ids) building = pick(userId);
        Instant secondBuildStart = clock.instant();
        MatchmakingEventDTO secondBuild = lastEventFor(building, blueA);
        assertThat(playerOf(secondBuild, blueA).clockRemainingMs()).isEqualTo(420_000L);
        assertThat(playerOf(secondBuild, redB).clockRemainingMs()).isEqualTo(280_000L);
        assertThat(playerOf(secondBuild, redC).clockRemainingMs()).isEqualTo(280_000L);
        assertThat(playerOf(secondBuild, blueD).clockRemainingMs()).isEqualTo(30_000L);
        assertThat(playerOf(secondBuild, blueD).buildEndsAt()).isEqualTo(secondBuildStart.plusSeconds(30));
    }
}
