package com.example.botfight.service.match.chat;

import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/** Owns match chat windows, validation, recipients, and per-user throttling. */
public final class MatchChatService {
    private static final int MAX_CODE_POINTS = 280;
    private static final String CLOSED_MESSAGE = "Match chat is now closed.";
    public static final String ALL_CHANNEL = "ALL";
    public static final String TEAM_CHANNEL = "TEAM";

    private final Clock clock;
    private final ConcurrentMap<UUID, MatchSession> activeSessionsByUserId;
    private final TokenBucketRateLimiter<String> rateLimiter;
    private final BlockLookup blockLookup;
    private final ConcurrentMap<UUID, MatchChatWindow> chatWindowsByMatchId = new ConcurrentHashMap<>();

    public MatchChatService(
            Clock clock,
            ConcurrentMap<UUID, MatchSession> activeSessionsByUserId,
            TokenBucketRateLimiter<String> rateLimiter) {
        this(clock, activeSessionsByUserId, rateLimiter, BlockLookup.none());
    }

    public MatchChatService(
            Clock clock,
            ConcurrentMap<UUID, MatchSession> activeSessionsByUserId,
            TokenBucketRateLimiter<String> rateLimiter,
            BlockLookup blockLookup) {
        this.clock = clock;
        this.activeSessionsByUserId = activeSessionsByUserId;
        this.rateLimiter = rateLimiter;
        this.blockLookup = blockLookup;
    }

    public MatchChatSubmission submit(UUID userId, UUID matchId, String rawMessage) {
        return submit(userId, matchId, rawMessage, ALL_CHANNEL);
    }

    public MatchChatSubmission submit(
            UUID userId,
            UUID matchId,
            String rawMessage,
            String requestedChannel) {
        String channel = normalizeChannel(requestedChannel);
        if (channel == null) {
            return MatchChatSubmission.rejected(matchId, "Chat channel was not accepted.", ALL_CHANNEL);
        }
        if (matchId == null) return MatchChatSubmission.rejected(null, CLOSED_MESSAGE, channel);

        MatchSession session = activeSessionsByUserId.get(userId);
        Instant now = Instant.now(clock);
        MatchChatParticipant sender;
        List<MatchChatParticipant> recipients;
        if (session != null && session.matchId().equals(matchId)) {
            MatchPlayer activeSender = playerForUser(session, userId);
            sender = new MatchChatParticipant(
                    activeSender.userId(),
                    activeSender.username(),
                    activeSender.principalName(),
                    activeSender.teamNumber());
            recipients = session.players().stream()
                    .map(player -> new MatchChatParticipant(
                            player.userId(),
                            player.username(),
                            player.principalName(),
                            player.teamNumber()))
                    .toList();
        } else {
            MatchChatWindow chatWindow = chatWindowsByMatchId.get(matchId);
            if (chatWindow == null
                    || !now.isBefore(chatWindow.closesAt())
                    || !chatWindow.participantsByUserId().containsKey(userId)) {
                return MatchChatSubmission.rejected(matchId, CLOSED_MESSAGE, channel);
            }
            sender = chatWindow.participantsByUserId().get(userId);
            recipients = chatWindow.participantsByUserId().values().stream().toList();
        }

        String message = rawMessage == null ? "" : rawMessage.strip();
        if (message.isBlank()
                || message.codePointCount(0, message.length()) > MAX_CODE_POINTS
                || message.codePoints().anyMatch(Character::isISOControl)) {
            return MatchChatSubmission.rejected(matchId, "Message was not accepted.", channel);
        }

        try {
            rateLimiter.requireAllowed(rateLimitKey(matchId, userId));
        } catch (RateLimitExceededException exception) {
            return MatchChatSubmission.rateLimited(matchId, channel);
        }
        return new MatchChatSubmission(
                MatchChatSubmissionStatus.ACCEPTED,
                UUID.randomUUID(),
                matchId,
                sender.username(),
                message,
                now,
                recipients.stream()
                        .filter(recipient -> !TEAM_CHANNEL.equals(channel)
                                || recipient.teamNumber() == sender.teamNumber())
                        .filter(recipient -> !blockLookup.isBlocked(recipient.userId(), userId))
                        .map(MatchChatParticipant::principalName)
                        .toList(),
                channel);
    }

    public Instant closeAt(UUID matchId) {
        MatchChatWindow chatWindow = chatWindowsByMatchId.get(matchId);
        return chatWindow == null ? null : chatWindow.closesAt();
    }

    public MatchChatClosure close(UUID matchId) {
        MatchChatWindow chatWindow = chatWindowsByMatchId.remove(matchId);
        if (chatWindow == null) return null;
        chatWindow.participantsByUserId().keySet().forEach(userId ->
                rateLimiter.forget(rateLimitKey(matchId, userId)));
        return new MatchChatClosure(
                matchId,
                CLOSED_MESSAGE,
                chatWindow.participantsByUserId().values().stream()
                        .map(MatchChatParticipant::principalName)
                        .toList());
    }

    public void leave(UUID matchId, UUID userId) {
        chatWindowsByMatchId.computeIfPresent(matchId, (ignored, window) -> {
            if (!window.participantsByUserId().containsKey(userId)) return window;
            Map<UUID, MatchChatParticipant> participants = new HashMap<>(window.participantsByUserId());
            participants.remove(userId);
            return new MatchChatWindow(window.closesAt(), Map.copyOf(participants));
        });
        rateLimiter.forget(rateLimitKey(matchId, userId));
    }

    public void open(MatchSession session) {
        open(session, Instant.now(clock).plusMillis(30_000L));
    }

    public void open(MatchSession session, Instant closesAt) {
        Map<UUID, MatchChatParticipant> participants = new HashMap<>();
        for (MatchPlayer player : session.players()) {
            participants.put(
                    player.userId(),
                    new MatchChatParticipant(
                            player.userId(),
                            player.username(),
                            player.principalName(),
                            player.teamNumber()));
        }
        chatWindowsByMatchId.put(
                session.matchId(),
                new MatchChatWindow(closesAt, Map.copyOf(participants)));
    }

    private MatchPlayer playerForUser(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new AuthException("player is not in this match"));
    }

    private String rateLimitKey(UUID matchId, UUID userId) {
        return matchId + ":" + userId;
    }

    private String normalizeChannel(String requestedChannel) {
        if (requestedChannel == null || requestedChannel.isBlank()) return ALL_CHANNEL;
        String channel = requestedChannel.strip().toUpperCase(java.util.Locale.ROOT);
        return switch (channel) {
            case ALL_CHANNEL, TEAM_CHANNEL -> channel;
            default -> null;
        };
    }

    private record MatchChatParticipant(
            UUID userId,
            String username,
            String principalName,
            int teamNumber) {
    }

    private record MatchChatWindow(
            Instant closesAt,
            Map<UUID, MatchChatParticipant> participantsByUserId) {
    }
}
