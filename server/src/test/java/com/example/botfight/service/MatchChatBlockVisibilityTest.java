package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.junit.jupiter.api.Test;

class MatchChatBlockVisibilityTest {

    @Test
    void blockerCannotReceiveBlockedUsersMessagesButBlockedUserCanReceiveTheBlocker() {
        UUID blockerId = UUID.randomUUID();
        UUID blockedId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        Clock clock = Clock.fixed(Instant.parse("2026-08-22T12:00:00Z"), ZoneOffset.UTC);
        MatchSession session = new MatchSession(
                matchId,
                1L,
                List.of(
                        player(blockerId, "alice", "alice@example.test"),
                        player(blockedId, "bob", "bob@example.test")),
                null,
                null,
                null,
                null,
                1,
                2,
                List.of(),
                java.util.Map.of());
        ConcurrentMap<UUID, MatchSession> activeSessions = new ConcurrentHashMap<>();
        activeSessions.put(blockerId, session);
        activeSessions.put(blockedId, session);
        MatchChatService chat = new MatchChatService(
                clock,
                activeSessions,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)),
                (viewerId, actorId) -> blockerId.equals(viewerId) && blockedId.equals(actorId));

        MatchChatSubmission fromBlocked = chat.submit(blockedId, matchId, "hello");
        MatchChatSubmission fromBlocker = chat.submit(blockerId, matchId, "hi");

        assertThat(fromBlocked.recipientPrincipalNames()).containsExactly("bob@example.test");
        assertThat(fromBlocker.recipientPrincipalNames())
                .containsExactly("alice@example.test", "bob@example.test");
    }

    private static MatchPlayer player(UUID userId, String username, String principalName) {
        return new MatchPlayer(userId, username, principalName, 1, false, null, 0, "custom:", false);
    }
}
