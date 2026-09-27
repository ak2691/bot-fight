package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.domain.chatmoderation.ChatContextType;
import com.example.botfight.service.chatmoderation.ChatEvidenceRecorder;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.chat.MatchChatService;
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
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class MatchChatEvidenceTest {

    @Test
    void evidenceUsesTheServerDeliveryRosterAndNormalizedMessage() {
        UUID senderId = UUID.randomUUID();
        UUID teammateId = UUID.randomUUID();
        UUID opponentId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        Clock clock = Clock.fixed(Instant.parse("2026-09-26T12:00:00Z"), ZoneOffset.UTC);
        MatchSession session = new MatchSession(
                matchId,
                1L,
                List.of(
                        player(senderId, "sender", 1, 1),
                        player(teammateId, "teammate", 2, 1),
                        player(opponentId, "opponent", 3, 2)),
                null,
                null,
                null,
                null,
                1,
                1,
                List.of(),
                Map.of());
        var sessions = new ConcurrentHashMap<UUID, MatchSession>();
        sessions.put(senderId, session);
        sessions.put(teammateId, session);
        sessions.put(opponentId, session);
        AtomicReference<CapturedEvidence> captured = new AtomicReference<>();
        ChatEvidenceRecorder recorder = (messageId, contextType, contextId, userId, username, sentAt, text, recipients) ->
                captured.set(new CapturedEvidence(messageId, contextType, contextId, userId, username, sentAt, text, List.copyOf(recipients)));
        MatchChatService service = new MatchChatService(
                clock,
                sessions,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)),
                (viewerId, actorId) -> false,
                recorder);

        var submission = service.submit(senderId, matchId, "  team evidence  ", MatchChatService.TEAM_CHANNEL);

        assertThat(submission.recipientUserIds()).containsExactlyInAnyOrder(senderId, teammateId);
        assertThat(captured.get()).isEqualTo(new CapturedEvidence(
                submission.messageId(),
                ChatContextType.MATCH,
                matchId,
                senderId,
                "sender",
                Instant.now(clock),
                "team evidence",
                List.of(senderId, teammateId)));
    }

    private static MatchPlayer player(UUID userId, String username, int slot, int team) {
        return new MatchPlayer(userId, username, username + "@example.test", slot, team, false, null, 0, "custom:", false);
    }

    private record CapturedEvidence(
            UUID messageId,
            ChatContextType contextType,
            UUID contextId,
            UUID senderId,
            String senderUsername,
            Instant sentAt,
            String text,
            List<UUID> recipients) {
    }
}
