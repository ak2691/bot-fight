package com.example.botfight.service.match;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;


import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.model.*;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchLifecycleWorkflowTest extends MatchWorkflowFixture {
    @Test
    void teamMatchStartsOnlyWithAnExactTwoVersusTwoRoster() {
        List<MatchEntrant> entrants = List.of(
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-one-a", "team-one-a@example.com", "socket-1", 1),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-one-b", "team-one-b@example.com", "socket-2", 1),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-two-a", "team-two-a@example.com", "socket-3", 2),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-two-b", "team-two-b@example.com", "socket-4", 2));

        List<OutboundMatchmakingEvent> events = lifecycle.startTeamMatch(entrants, MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null);

        assertThat(events).hasSize(4);
        assertThat(events).allSatisfy(event -> assertThat(event.event().players()).hasSize(4));
    }

    @Test
    void malformedTeamRosterAndDuplicateSocketAreRejectedBeforePersistence() {
        List<MatchEntrant> threePlayers = List.of(
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-one-a", "team-one-a@example.com", "socket-1", 1),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-one-b", "team-one-b@example.com", "socket-2", 1),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-two-a", "team-two-a@example.com", "socket-3", 2));

        assertThatThrownBy(() -> lifecycle.startTeamMatch(threePlayers, MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null))
                .isInstanceOf(AuthException.class)
                .hasMessage("2v2 matches require exactly two players on each team");

        List<MatchEntrant> duplicateSockets = List.of(
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-one-a", "team-one-a@example.com", "same-socket", 1),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-one-b", "team-one-b@example.com", "same-socket", 1),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-two-a", "team-two-a@example.com", "socket-3", 2),
                com.example.botfight.support.TestKits.entrant(UUID.randomUUID(), "team-two-b", "team-two-b@example.com", "socket-4", 2));

        assertThatThrownBy(() -> lifecycle.startTeamMatch(duplicateSockets, MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null))
                .isInstanceOf(AuthException.class)
                .hasMessage("match players must use distinct socket connections");
    }

    @Test
    void unanimousTeamForfeitCompletesMatchForTheOpposingTeam() {
        UUID firstUserId = UUID.randomUUID();
        UUID teammateUserId = UUID.randomUUID();
        UUID opponentUserId = UUID.randomUUID();
        UUID opponentTeammateUserId = UUID.randomUUID();
        lifecycle.startTeamMatch(List.of(
                com.example.botfight.support.TestKits.entrant(firstUserId, "pilot-one", "pilot-one@example.com", "socket-one", 1),
                com.example.botfight.support.TestKits.entrant(teammateUserId, "pilot-one-b", "pilot-one-b@example.com", "socket-two", 1),
                com.example.botfight.support.TestKits.entrant(opponentUserId, "pilot-two", "pilot-two@example.com", "socket-three", 2),
                com.example.botfight.support.TestKits.entrant(opponentTeammateUserId, "pilot-two-b", "pilot-two-b@example.com", "socket-four", 2)), MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null);

        List<OutboundMatchmakingEvent> voteEvents = lifecycle.surrender(firstUserId);

        assertThat(voteEvents).hasSize(4).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_SURRENDER_UPDATED);
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(2);
            assertThat(outbound.event().surrenderVoteCount())
                    .isEqualTo(viewerParticipant(outbound.event()).teamNumber() == 1 ? 1 : 0);
        });
        List<OutboundMatchmakingEvent> events = lifecycle.surrender(teammateUserId);

        assertThat(events).hasSize(4);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isIn(opponentUserId, opponentTeammateUserId);
        assertThat(participants)
                .filteredOn(participant -> participant.getTeamNumber() == 1)
                .hasSize(2)
                .allSatisfy(participant ->
                        assertThat(participant.getResult()).isEqualTo(MatchResult.FORFEIT));
        assertThat(participants)
                .filteredOn(participant -> participant.getTeamNumber() == 2)
                .hasSize(2)
                .allSatisfy(participant ->
                        assertThat(participant.getResult()).isEqualTo(MatchResult.WIN));
        assertThat(events).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_RESULT_READY);
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId())
                    .isIn(opponentUserId, opponentTeammateUserId);
            assertThat(outbound.event().playback().message()).isEqualTo("Red Team wins.");
            assertThat(outbound.delayMillis()).isZero();
            assertThat(outbound.event().matchChatEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });
        assertThat(service.matchChatCloseAt(savedMatch.getId()))
                .isEqualTo(clock.instant().plusSeconds(30));
        assertThat(service.markDisconnected("pilot-one@example.com")).isEmpty();
        assertThat(service.markDisconnected("pilot-one-b@example.com")).isEmpty();
        assertThat(savedMatch.getWinnerUser().getId()).isIn(opponentUserId, opponentTeammateUserId);
    }

    @Test
    void oneVersusOneForfeitRequiresOnlyThatTeamMember() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
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

        List<OutboundMatchmakingEvent> events = lifecycle.surrender(firstUserId);

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_RESULT_READY);
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(1);
        });
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Test
    void forfeitVoteCanBeWithdrawnBeforeItBecomesUnanimous() {
        UUID firstUserId = UUID.randomUUID();
        UUID teammateUserId = UUID.randomUUID();
        UUID opponentUserId = UUID.randomUUID();
        UUID opponentTeammateUserId = UUID.randomUUID();
        lifecycle.startTeamMatch(List.of(
                com.example.botfight.support.TestKits.entrant(firstUserId, "pilot-one", "pilot-one@example.com", "socket-one", 1),
                com.example.botfight.support.TestKits.entrant(teammateUserId, "pilot-one-b", "pilot-one-b@example.com", "socket-two", 1),
                com.example.botfight.support.TestKits.entrant(opponentUserId, "pilot-two", "pilot-two@example.com", "socket-three", 2),
                com.example.botfight.support.TestKits.entrant(opponentTeammateUserId, "pilot-two-b", "pilot-two-b@example.com", "socket-four", 2)), MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null);

        List<OutboundMatchmakingEvent> voteEvents = lifecycle.surrender(firstUserId);
        List<OutboundMatchmakingEvent> withdrawalEvents = lifecycle.surrender(firstUserId);

        assertThat(voteEvents).hasSize(4).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_SURRENDER_UPDATED);
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(2);
        });
        assertThat(withdrawalEvents).hasSize(4).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo(MatchEventType.MATCH_SURRENDER_UPDATED);
            assertThat(outbound.event().surrenderVoteCount()).isZero();
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(2);
        });
        assertThat(withdrawalEvents.stream()
                .filter(outbound -> outbound.event().viewerUserId().equals(firstUserId))
                .findFirst()
                .orElseThrow()
                .event()
                .surrenderRequestedByMe()).isFalse();
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Test
    void repeatedSurrenderDoesNotCompleteOrScoreMatchTwice() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
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

        lifecycle.surrender(firstUserId);
        lifecycle.surrender(secondUserId);
        List<OutboundMatchmakingEvent> retryEvents = lifecycle.surrender(firstUserId);

        assertThat(retryEvents).isEmpty();
        verify(matchRepository, times(2)).save(any(Match.class));
        verify(profileRepository, times(2)).save(any());
    }
}
