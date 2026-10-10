package com.example.botfight.service.match;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
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
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.service.match.model.*;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchReconnectionWorkflowTest extends MatchWorkflowFixture {
    @Test
    void resumingDuringSecondRoundBuildingUsesTheLivePhaseInsteadOfTheReplayBoundary() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";

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

        List<OutboundMatchmakingEvent> firstRoundEvents = service.completeSimulation(savedMatch.getId());
        Instant secondRoundReadyAt = firstRoundEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), secondRoundReadyAt));
        firstRoundEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));

        TestMatches.selectLoadout(service, firstUserId, "melee");
        List<OutboundMatchmakingEvent> buildingEvents = TestMatches.selectLoadout(service, secondUserId, "melee");
        assertThat(buildingEvents).allSatisfy(event ->
                assertThat(event.event().roundNumber()).isEqualTo(2));

        OutboundMatchmakingEvent staleBoundary = firstRoundEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .findFirst()
                .orElseThrow();
        assertThat(service.beginNextRound(staleBoundary.event().matchId(), staleBoundary.event().roundNumber() - 1))
                .as("a delayed round boundary cannot reopen loadout selection")
                .isEmpty();

        List<OutboundMatchmakingEvent> resumed = reconnect.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-reconnected");

        assertThat(resumed).singleElement().satisfies(event -> {
            assertThat(event.event().type()).isEqualTo(MatchEventType.MATCH_FOUND);
            assertThat(event.event().status()).isEqualTo("PREP");
            assertThat(event.event().roundNumber()).isEqualTo(2);
            assertThat(event.event().buildingEndsAt()).isNotNull();
            assertThat(service.isCurrentEvent(event)).isTrue();
        });
    }

    @Test
    void disconnectNotificationRemainsCurrentAcrossLoadoutToBuildingTransition() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
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
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));

        TestMatches.selectLoadout(service, firstUserId, "melee");
        List<OutboundMatchmakingEvent> disconnectEvents = reconnect.markDisconnected(firstPrincipal, null);
        assertThat(disconnectEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo(MatchEventType.PLAYER_DISCONNECTED);
            assertThat(event.event().status()).isEqualTo("LOADOUT_SELECT");
            assertThat(service.isCurrentEvent(event)).isTrue();
        });

        TestMatches.selectLoadout(service, secondUserId, "melee");

        assertThat(disconnectEvents).allSatisfy(event ->
                assertThat(service.isCurrentEvent(event)).isTrue());
    }

    @Test
    void replayDisconnectWaitsForAValidNextRoundBeforeStartingGrace() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
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
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        List<OutboundMatchmakingEvent> replayEvents = service.completeSimulation(savedMatch.getId());
        Instant roundReadyAt = replayEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();

        assertThat(reconnect.markDisconnected(firstPrincipal, null)).isEmpty();
        assertThat(reconnect.activeMatchStatus(firstUserId).disconnected()).isFalse();

        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        replayEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));

        List<OutboundMatchmakingEvent> disconnectEvents =
                reconnect.promotePendingDisconnect(firstPrincipal);
        assertThat(disconnectEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo(MatchEventType.PLAYER_DISCONNECTED);
            assertThat(event.event().disconnectEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });

        List<OutboundMatchmakingEvent> reconnectEvents =
                reconnect.resumeMatch(firstUserId, "pilot-one", firstPrincipal, "socket-reconnected");
        assertThat(reconnectEvents)
                .filteredOn(event -> MatchEventType.PLAYER_RECONNECTED.equals(event.event().type()))
                .hasSize(2)
                .allSatisfy(event -> assertThat(service.isCurrentEvent(event)).isTrue());

        TestMatches.selectLoadout(service, firstUserId, "melee");
        List<OutboundMatchmakingEvent> buildingEvents = TestMatches.selectLoadout(service, secondUserId, "melee");
        assertThat(buildingEvents)
                .filteredOn(event -> MatchEventType.BOT_BUILDING_SESSION_READY.equals(event.event().type()))
                .hasSize(2);

        List<OutboundMatchmakingEvent> buildingDisconnectEvents = reconnect.markDisconnected(firstPrincipal, null);
        assertThat(buildingDisconnectEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo(MatchEventType.PLAYER_DISCONNECTED);
            assertThat(event.event().status()).isEqualTo("PREP");
            assertThat(service.isCurrentEvent(event)).isTrue();
        });
    }

    @Test
    void startedDisconnectGracePausesDuringReplayAndStartsFreshGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
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
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        reconnect.markDisconnected(firstPrincipal, null);
        clock.advance(Duration.ofSeconds(18));
        List<OutboundMatchmakingEvent> replayEvents = service.completeSimulation(savedMatch.getId());
        assertThat(reconnect.activeMatchStatus(firstUserId).disconnected()).isFalse();
        assertThat(replayEvents)
                .filteredOn(event -> MatchEventType.SIMULATION_PREPARING.equals(event.event().type()))
                .allSatisfy(event -> assertThat(event.event().disconnectEndsAt()).isNull());

        Instant roundReadyAt = replayEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        replayEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));

        List<OutboundMatchmakingEvent> resumedEvents =
                reconnect.promotePendingDisconnect(firstPrincipal);
        Instant resumedDeadline = resumedEvents.getFirst().event().disconnectEndsAt();
        assertThat(resumedDeadline).isEqualTo(clock.instant().plusSeconds(30));

        clock.advance(Duration.between(clock.instant(), resumedDeadline));
        List<OutboundMatchmakingEvent> results = reconnect.resolveDisconnectTimeout(
                firstPrincipal,
                resumedDeadline);

        assertThat(results).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo(MatchEventType.MATCH_RESULT_READY);
            assertThat(event.event().playback().result()).isEqualTo("DISCONNECTION_WIN");
            assertThat(event.event().playback().winnerUserId()).isEqualTo(secondUserId);
        });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("DISCONNECTION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Test
    void terminalSeriesCompletionWinsTheDisconnectRaceAndStartsNoNewGracePeriod() {
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            MatchPlayer winner = session.players().getLast();
            return replay(session, outcome(session), knockoutWinner(session, winner.userId()), List.of());
        });
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        String secondPrincipal = "pilot-two@example.com";
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
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
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);
        List<OutboundMatchmakingEvent> roundEvents =
                service.completeSimulation(savedMatch.getId());
        Instant roundReadyAt = roundEvents.stream()
                .filter(outbound -> outbound.event().type().equals(MatchEventType.MATCH_ROUND_READY))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        roundEvents.stream()
                .filter(outbound -> outbound.event().type().equals(MatchEventType.MATCH_ROUND_READY))
                .forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));
        // A timed-rounds match has no round leader; the first player disconnects as round 2 begins.
        UUID roundLeaderUserId = firstUserId;
        String roundLeaderPrincipal = roundLeaderUserId.equals(firstUserId) ? firstPrincipal : secondPrincipal;
        UUID winnerUserId = roundLeaderUserId.equals(firstUserId) ? secondUserId : firstUserId;

        Instant deadline = reconnect.markDisconnected(roundLeaderPrincipal, null).getFirst().event().disconnectEndsAt();
        clock.advance(Duration.between(clock.instant(), deadline));
        List<OutboundMatchmakingEvent> results =
                reconnect.resolveDisconnectTimeout(roundLeaderPrincipal, deadline);

        assertThat(results).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("DISCONNECTION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(winnerUserId);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(roundLeaderUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.FORFEIT);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(winnerUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.WIN);
        assertThat(results).allSatisfy(outbound ->
                assertThat(outbound.event().playback().result()).isEqualTo("DISCONNECTION_WIN"));
    }

    @Test
    void bothPlayersDisconnectingAfterFirstRoundCompletesMatchAsDraw() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        String secondPrincipal = "pilot-two@example.com";
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
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
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);
        List<OutboundMatchmakingEvent> firstRoundEvents = service.completeSimulation(savedMatch.getId());
        Instant roundReadyAt = firstRoundEvents.stream()
                .filter(outbound -> MatchEventType.MATCH_ROUND_READY.equals(outbound.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        firstRoundEvents.stream()
                .filter(outbound -> MatchEventType.MATCH_ROUND_READY.equals(outbound.event().type()))
                .forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));

        Instant firstDeadline =
                reconnect.markDisconnected(firstPrincipal, null).getFirst().event().disconnectEndsAt();
        reconnect.markDisconnected(secondPrincipal, null);
        clock.advance(Duration.between(clock.instant(), firstDeadline));
        List<OutboundMatchmakingEvent> results =
                reconnect.resolveDisconnectTimeout(firstPrincipal, firstDeadline);

        assertThat(results).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("MUTUAL_DISCONNECTION");
        assertThat(savedMatch.getWinnerUser()).isNull();
        assertThat(participants).allSatisfy(participant ->
                assertThat(participant.getResult()).isEqualTo(MatchResult.DRAW));
        assertThat(results).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_RESULT_READY);
            assertThat(outbound.event().playback().result()).isEqualTo("DRAW");
            assertThat(outbound.event().playback().winnerUserId()).isNull();
        });
        assertThat(reconnect.markDisconnected(firstPrincipal, null)).isEmpty();
        assertThat(reconnect.markDisconnected(secondPrincipal, null)).isEmpty();
        assertThat(savedMatch.getWinnerUser()).isNull();
    }

    @Test
    void reconnectCancelsPendingDisconnectForfeit() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
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
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        Instant deadline = reconnect.markDisconnected(firstPrincipal, null).get(0).event().disconnectEndsAt();

        List<OutboundMatchmakingEvent> reconnectEvents =
                reconnect.resumeMatch(firstUserId, "pilot-one", firstPrincipal, "socket-reconnected");
        clock.advance(Duration.ofSeconds(31));

        assertThat(reconnectEvents)
                .extracting(outbound -> outbound.event().type().name())
                .contains("MATCH_FOUND", "PLAYER_RECONNECTED");
        assertThat(reconnect.resolveDisconnectTimeout(firstPrincipal, deadline)).isEmpty();
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Test
    void disconnectFromSupersededSocketDoesNotDisconnectCurrentMatchSession() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(new QueueJoinRequest(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-old",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        matchmakingService.joinQueue(new QueueJoinRequest(
                secondUserId,
                "pilot-two",
                "pilot-two@example.com",
                "socket-two",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));

        reconnect.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-current");

        assertThat(reconnect.markDisconnected(firstPrincipal, "socket-old")).isEmpty();
        List<OutboundMatchmakingEvent> notices =
                reconnect.markDisconnected(firstPrincipal, "socket-current");

        assertThat(notices).hasSize(2);
        assertThat(notices).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.PLAYER_DISCONNECTED);
            assertThat(outbound.event().disconnectEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });
    }

    @Test
    void duplicateDisconnectFromSameSocketDoesNotRestartGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(new QueueJoinRequest(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-one",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        matchmakingService.joinQueue(new QueueJoinRequest(
                secondUserId,
                "pilot-two",
                "pilot-two@example.com",
                "socket-two",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));

        List<OutboundMatchmakingEvent> firstNotice =
                reconnect.markDisconnected(firstPrincipal, "socket-one");
        clock.advance(Duration.ofSeconds(1));
        List<OutboundMatchmakingEvent> duplicateNotice =
                reconnect.markDisconnected(firstPrincipal, "socket-one");

        assertThat(firstNotice).hasSize(2);
        assertThat(duplicateNotice).isEmpty();
        assertThat(firstNotice.getFirst().event().disconnectEndsAt())
                .isEqualTo(Instant.parse("2026-06-03T12:00:30Z"));
    }

    @Test
    void aReconnectMidBuildGetsTheSamePerPlayerDeadlines() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<OutboundMatchmakingEvent> building = startDuelBuild(first, second);
        MatchmakingEventDTO started = building.getFirst().event();
        clock.advance(Duration.ofSeconds(50));
        submit(second);
        clock.advance(Duration.ofSeconds(10));

        reconnect.markDisconnected("pilot-one@example.com", null);
        List<OutboundMatchmakingEvent> resumed =
                reconnect.resumeMatch(first, "pilot-one", "pilot-one@example.com", "socket-reconnected");

        assertThat(resumed).filteredOn(outbound -> MatchEventType.MATCH_FOUND.equals(outbound.event().type()))
                .singleElement().satisfies(outbound -> {
            MatchmakingEventDTO event = outbound.event();
            assertThat(event.status()).isEqualTo("PREP");
            // Mid-build the clock is not a countdown the server restarts: the deadline is unchanged.
            assertThat(playerOf(event, first).buildEndsAt()).isEqualTo(playerOf(started, first).buildEndsAt());
            assertThat(playerOf(event, first).clockRemainingMs()).isEqualTo(330_000L);
            // The player who already submitted keeps what they saved.
            assertThat(playerOf(event, second).finished()).isTrue();
            assertThat(playerOf(event, second).clockRemainingMs()).isEqualTo(280_000L);
            assertThat(event.buildingEndsAt()).isEqualTo(playerOf(started, first).buildEndsAt().plusSeconds(2));
            assertThat(service.isCurrentEvent(outbound)).isTrue();
        });
    }

    @Test
    void reconnectPreservesDraftAndClocksAtResultHoldNextPickAndMidBuild() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        startDuelBuild(first, second);
        clock.advance(Duration.ofSeconds(60));
        submit(first);
        clock.advance(Duration.ofSeconds(30));
        submit(second);
        service.completeSimulation(savedMatch.getId());
        MatchSession replay = service.sessionForScheduling(savedMatch.getId());
        clock.advance(Duration.between(clock.instant(), replay.resultRevealsAt().plusMillis(1)));
        MatchmakingEventDTO hold = lastEventFor(reconnect.resumeMatch(first, "pilot-one", "pilot-one@example.com", "hold"), first);
        assertThat(hold.roundReadyAt()).isEqualTo(replay.roundReadyAt());
        assertThat(playerOf(hold, first).clockRemainingMs()).isEqualTo(270_000L);
        assertThat(playerOf(hold, second).clockRemainingMs()).isEqualTo(240_000L);
        clock.advance(Duration.between(clock.instant(), replay.roundReadyAt()));
        MatchmakingEventDTO next = lastEventFor(service.beginNextRound(savedMatch.getId(), 1), first);
        MatchmakingEventDTO resumedPick = lastEventFor(reconnect.resumeMatch(first, "pilot-one", "pilot-one@example.com", "pick"), first);
        assertThat(resumedPick.loadoutSelectionEndsAt()).isEqualTo(next.loadoutSelectionEndsAt());
        assertThat(resumedPick.players()).isEqualTo(next.players());
        assertThat(resumedPick.abilityOffers()).isEqualTo(next.abilityOffers());
        assertThat(resumedPick.players()).allSatisfy(player -> assertThat(player.loadoutSelected()).isFalse());
        pick(first);
        MatchmakingEventDTO build = pick(second).getFirst().event();
        clock.advance(Duration.ofSeconds(10));
        MatchmakingEventDTO resumedBuild = lastEventFor(reconnect.resumeMatch(first, "pilot-one", "pilot-one@example.com", "build"), first);
        assertThat(resumedBuild.status()).isEqualTo("PREP");
        assertThat(resumedBuild.buildingEndsAt()).isEqualTo(build.buildingEndsAt());
        assertThat(resumedBuild.players()).isEqualTo(build.players());
        assertThat(playerOf(resumedBuild, first).clockRemainingMs()).isEqualTo(300_000L);
        assertThat(playerOf(resumedBuild, second).clockRemainingMs()).isEqualTo(270_000L);
    }
}
