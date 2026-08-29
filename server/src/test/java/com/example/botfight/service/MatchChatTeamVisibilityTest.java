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
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.junit.jupiter.api.Test;

class MatchChatTeamVisibilityTest {

    @Test
    void teamMessagesOnlyReachTheSenderTeamWhileAllChatReachesTheWholeMatch() {
        UUID blueLeader = UUID.randomUUID();
        UUID blueTeammate = UUID.randomUUID();
        UUID redLeader = UUID.randomUUID();
        UUID redTeammate = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        Clock clock = Clock.fixed(Instant.parse("2026-08-28T12:00:00Z"), ZoneOffset.UTC);
        MatchSession session = new MatchSession(
                matchId,
                1L,
                List.of(
                        player(blueLeader, "blue-one", "blue-one@example.test", 1, 1),
                        player(blueTeammate, "blue-two", "blue-two@example.test", 2, 1),
                        player(redLeader, "red-one", "red-one@example.test", 3, 2),
                        player(redTeammate, "red-two", "red-two@example.test", 4, 2)),
                null,
                null,
                null,
                null,
                1,
                1,
                List.of(),
                Map.of());
        ConcurrentMap<UUID, MatchSession> activeSessions = new ConcurrentHashMap<>();
        activeSessions.put(blueLeader, session);
        activeSessions.put(blueTeammate, session);
        activeSessions.put(redLeader, session);
        activeSessions.put(redTeammate, session);
        MatchChatService chat = new MatchChatService(
                clock,
                activeSessions,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)));

        MatchChatSubmission teamMessage = chat.submit(
                blueLeader,
                matchId,
                "blue side",
                MatchChatService.TEAM_CHANNEL);
        MatchChatSubmission allMessage = chat.submit(
                blueLeader,
                matchId,
                "everyone",
                MatchChatService.ALL_CHANNEL);

        assertThat(teamMessage.channel()).isEqualTo(MatchChatService.TEAM_CHANNEL);
        assertThat(teamMessage.recipientPrincipalNames())
                .containsExactlyInAnyOrder("blue-one@example.test", "blue-two@example.test");
        assertThat(allMessage.channel()).isEqualTo(MatchChatService.ALL_CHANNEL);
        assertThat(allMessage.recipientPrincipalNames())
                .containsExactlyInAnyOrder(
                        "blue-one@example.test",
                        "blue-two@example.test",
                        "red-one@example.test",
                        "red-two@example.test");
    }

    private static MatchPlayer player(
            UUID userId,
            String username,
            String principalName,
            int slot,
            int teamNumber) {
        return new MatchPlayer(
                userId,
                username,
                principalName,
                slot,
                teamNumber,
                false,
                null,
                0,
                "custom:",
                false);
    }
}
