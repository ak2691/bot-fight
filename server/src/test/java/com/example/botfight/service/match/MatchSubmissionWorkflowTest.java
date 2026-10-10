package com.example.botfight.service.match;

import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchSubmissionResult;


import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.support.TestMatches;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.*;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchSubmissionWorkflowTest extends MatchWorkflowFixture {
    @Test
    void matchSubmissionRetryUsesTheInMemoryRoundKeyWithoutSubmissionLookup() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID matchId = service.startMatch(new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null), new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null), MatchMode.ONES, true)
                .getFirst().event().matchId();
        TestMatches.selectLoadout(service, firstUserId, "melee");
        TestMatches.selectLoadout(service, secondUserId, "melee");

        MatchSubmissionResult first = submissions.accept(
                firstUserId,
                matchId,
                1,
                "BUILDING",
                inMemorySubmission(matchId, "fingerprint-1"));
        MatchSubmissionResult retry = submissions.accept(
                firstUserId,
                matchId,
                1,
                "BUILDING",
                inMemorySubmission(matchId, "fingerprint-1"));

        assertThat(first.accepted()).isTrue();
        assertThat(first.duplicate()).isFalse();
        assertThat(retry.accepted()).isTrue();
        assertThat(retry.duplicate()).isTrue();
    }

    @Test
    void repeatedFinishWithSameSubmissionDoesNotAttachTwice() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID submissionId = UUID.randomUUID();
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
        stubSubmission(firstUserId, submissionId);

        submitMatch(firstUserId, submissionId);
        List<OutboundMatchmakingEvent> retryEvents =
                submitMatch(firstUserId, submissionId);

        assertThat(retryEvents).isEmpty();
    }
}
