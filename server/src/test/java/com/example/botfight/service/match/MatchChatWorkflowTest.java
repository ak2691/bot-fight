package com.example.botfight.service.match;

import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;


import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.*;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchChatWorkflowTest extends MatchWorkflowFixture {
    @Test
    void matchChatIsServerConfirmedAndRateLimitedPerSender() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
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

        MatchChatSubmission first =
                chat.submit(firstUserId, savedMatch.getId(), "  ready?  ", "ALL");
        for (int messageNumber = 2; messageNumber <= 10; messageNumber++) {
            chat.submit(firstUserId, savedMatch.getId(), "message-" + messageNumber, "ALL");
        }
        MatchChatSubmission limited =
                chat.submit(firstUserId, savedMatch.getId(), "message-11", "ALL");

        assertThat(first.status()).isEqualTo(MatchChatSubmissionStatus.ACCEPTED);
        assertThat(first.username()).isEqualTo("pilot-one");
        assertThat(first.message()).isEqualTo("ready?");
        assertThat(first.recipientPrincipalNames())
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(limited.status()).isEqualTo(MatchChatSubmissionStatus.RATE_LIMITED);
        assertThat(limited.message()).isEqualTo("Too many requests, please wait.");

        clock.advance(Duration.ofSeconds(1));
        assertThat(chat.submit(firstUserId, savedMatch.getId(), "after window", "ALL").status())
                .isEqualTo(MatchChatSubmissionStatus.ACCEPTED);
    }

    @Test
    void matchChatRemainsOpenForThirtySecondsAfterTheMatchEnds() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
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
        UUID matchId = savedMatch.getId();

        service.surrender(firstUserId);
        service.surrender(secondUserId);

        assertThat(chat.submit(firstUserId, matchId, "still here", "ALL").status())
                .isEqualTo(MatchChatSubmissionStatus.ACCEPTED);

        clock.advance(Duration.ofSeconds(30));
        assertThat(chat.submit(firstUserId, matchId, "too late", "ALL").status())
                .isEqualTo(MatchChatSubmissionStatus.REJECTED);
    }

    @Test
    void closingMatchChatReturnsTheNoticeRecipientsAndRejectsLaterMessages() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
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
        UUID matchId = savedMatch.getId();

        service.surrender(firstUserId);
        service.surrender(secondUserId);

        MatchChatClosure closure = chat.close(matchId);

        assertThat(closure.message()).isEqualTo("Match chat is now closed.");
        assertThat(closure.recipientPrincipalNames())
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(chat.submit(firstUserId, matchId, "after close", "ALL").status())
                .isEqualTo(MatchChatSubmissionStatus.REJECTED);
    }
}
