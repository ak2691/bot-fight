package com.example.botfight.service.customlobby;

import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

/** Validates and routes all-chat messages to the current custom-lobby members. */
@Service
public class CustomLobbyChatService {

    private static final int MAX_CODE_POINTS = 280;
    private static final String UNAVAILABLE_MESSAGE = "Custom lobby chat is unavailable.";

    private final Clock clock;
    private final CustomLobbyService customLobbyService;
    private final TokenBucketRateLimiter<String> rateLimiter;
    private final BlockLookup blockLookup;

    @Autowired
    public CustomLobbyChatService(
            Clock clock,
            CustomLobbyService customLobbyService,
            @Qualifier("customLobbyChatRateLimiter") TokenBucketRateLimiter<String> rateLimiter,
            BlockLookup blockLookup) {
        this.clock = clock;
        this.customLobbyService = customLobbyService;
        this.rateLimiter = rateLimiter;
        this.blockLookup = blockLookup;
    }

    public CustomLobbyChatSubmission submit(
            UUID userId,
            String principalName,
            UUID lobbyId,
            String rawMessage) {
        CustomLobbyService.LobbyChatContext context = customLobbyService.chatContextFor(
                lobbyId,
                userId,
                principalName);
        if (context == null) {
            return CustomLobbyChatSubmission.rejected(lobbyId, UNAVAILABLE_MESSAGE);
        }

        String message = rawMessage == null ? "" : rawMessage.strip();
        if (message.isBlank()
                || message.codePointCount(0, message.length()) > MAX_CODE_POINTS
                || message.codePoints().anyMatch(Character::isISOControl)) {
            return CustomLobbyChatSubmission.rejected(lobbyId, "Message was not accepted.");
        }

        try {
            rateLimiter.requireAllowed(rateLimitKey(context.lobbyId(), userId));
        } catch (RateLimitExceededException exception) {
            return CustomLobbyChatSubmission.rateLimited(context.lobbyId());
        }

        Instant now = Instant.now(clock);
        return new CustomLobbyChatSubmission(
                CustomLobbyChatSubmissionStatus.ACCEPTED,
                UUID.randomUUID(),
                context.lobbyId(),
                context.username(),
                message,
                now,
                context.recipients().stream()
                        .filter(recipient -> !blockLookup.isBlocked(recipient.userId(), userId))
                        .map(CustomLobbyService.LobbyRecipient::principalName)
                        .toList());
    }

    private String rateLimitKey(UUID lobbyId, UUID userId) {
        return lobbyId + ":" + userId;
    }
}
