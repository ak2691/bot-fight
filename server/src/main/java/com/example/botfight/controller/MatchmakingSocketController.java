package com.example.botfight.controller;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.DTO.match.MatchLoadoutSelectionDTO;
import com.example.botfight.DTO.match.MatchTimeoutFallbackDTO;
import com.example.botfight.DTO.match.MatchCodeViewRequestDTO;
import com.example.botfight.DTO.match.MatchCodeViewResponseDTO;
import com.example.botfight.DTO.match.MatchChatEventDTO;
import com.example.botfight.DTO.match.MatchChatRequestDTO;
import com.example.botfight.DTO.match.MatchAcceptanceDTO;
import com.example.botfight.DTO.match.MatchmakingJoinRequestDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.service.match.connection.MatchSocketConnections;
import com.example.botfight.service.matchmaking.MatchmakingSocketActions;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.matchmaking.MatchmakingEventsReady;
import com.example.botfight.service.websocket.WebSocketSessionDisconnectedEvent;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

@Controller
public class MatchmakingSocketController {

    private final MatchService matchService;
    private final CurrentUserService currentUserService;
    private final MatchEventPublisher publisher;
    private final MatchmakingSocketActions actions;
    private final MatchSocketConnections connections;
    private static final Logger log = LoggerFactory.getLogger(MatchmakingSocketController.class);

    public MatchmakingSocketController(MatchService matchService, CurrentUserService currentUserService,
            MatchEventPublisher publisher, MatchmakingSocketActions actions, MatchSocketConnections connections) {
        this.matchService = matchService;
        this.currentUserService = currentUserService;
        this.publisher = publisher;
        this.actions = actions;
        this.connections = connections;
    }

    @MessageMapping("/matchmaking.join")
    public void joinQueue(
            @Payload MatchmakingJoinRequestDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        actions.joinQueue(payload, principal, headers);
    }

    @MessageMapping("/matchmaking.leave")
    public void leaveQueue(Principal principal) {
        actions.leaveQueue(principal);
    }

    @MessageMapping("/matchmaking.resume")
    public void resumeMatch(Principal principal, SimpMessageHeaderAccessor headers) {
        actions.resumeMatch(principal, headers);
    }

    /** Rebinds a refreshed/reconnected browser to its waiting queue entry. */
    @MessageMapping("/matchmaking.resumeQueue")
    public void resumeQueue(Principal principal, SimpMessageHeaderAccessor headers) {
        actions.resumeQueue(principal, headers);
    }

    @MessageMapping("/matchmaking.accept")
    public void acceptMatch(
            @Payload MatchAcceptanceDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        actions.acceptMatch(payload, principal, headers);
    }

    @MessageMapping("/matchmaking.cancel")
    public void cancelMatch(
            @Payload MatchAcceptanceDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        actions.cancelMatch(payload, principal, headers);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleMatchmakingEventsReady(MatchmakingEventsReady ready) {
        List<OutboundMatchmakingEvent> events = ready.events();
        publisher.publish(events);
    }

    @MessageExceptionHandler(AuthException.class)
    public void handleMatchmakingError(AuthException exception, Principal principal) {
        sendError(principal, exception.getMessage());
    }

    @MessageExceptionHandler(RateLimitExceededException.class)
    public void handleMatchmakingRateLimit(
            RateLimitExceededException ignored,
            Principal principal) {
        sendError(principal, RateLimitExceededException.GENERIC_MESSAGE);
    }

    @MessageExceptionHandler(Exception.class)
    public void handleUnexpectedMatchmakingError(Exception exception, Principal principal) {
        log.error("Unexpected matchmaking command failure", exception);
        sendError(principal, "The matchmaking command could not be processed");
    }

    private void sendError(Principal principal, String message) {
        if (principal == null) {
            return;
        }
        publisher.sendToUser(
                principal.getName(),
                MatchmakingSocketDestinations.MATCHMAKING,
                MatchmakingEventDTO.builder()
                        .type(MatchEventType.MATCH_ERROR)
                        .status("BUILDING")
                        .players(List.of())
                        .serverNow(Instant.now())
                        .message(message)
                        .roundBrains(List.of())
                        .abilityOffers(List.of()).build());
    }

    @MessageMapping("/matchmaking.selectLoadout")
    public void selectLoadout(@Payload MatchLoadoutSelectionDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = payload == null
                ? List.of()
                : matchService.selectLoadout(
                        user.getId(),
                        payload.matchId(),
                        payload.roundNumber(),
                        payload.selectedLoadout());
        publisher.publish(events);
    }

    @MessageMapping("/matchmaking.timeoutFallback")
    public void setTimeoutFallback(@Payload MatchTimeoutFallbackDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        if (payload == null) return;
        publisher.publish(matchService.setTimeoutFallback(
                user.getId(),
                payload.matchId(),
                payload.roundNumber(),
                payload.timeoutFallback()));
    }

    @MessageMapping("/matchmaking.leaveCompletedMatch")
    public void leaveCompletedMatch(Principal principal) {
        AppUser user = requireUser(principal);
        matchService.leaveCompletedMatch(user.getId());
    }

    @MessageMapping("/matchmaking.surrender")
    public void surrender(Principal principal) {
        AppUser user = requireUser(principal);
        publisher.publish(matchService.surrender(user.getId()));
    }

    @MessageMapping("/matchmaking.codeView.request")
    public void requestCodeView(
            @Payload MatchCodeViewRequestDTO payload,
            Principal principal) {
        AppUser user = requireUser(principal);
        if (payload == null) {
            throw new AuthException("the code view request is invalid");
        }
        publisher.publish(matchService.requestCodeView(
                user.getId(),
                payload.matchId(),
                payload.targetUserId(),
                payload.roundNumber()));
    }

    @MessageMapping("/matchmaking.codeView.response")
    public void respondCodeView(
            @Payload MatchCodeViewResponseDTO payload,
            Principal principal) {
        AppUser user = requireUser(principal);
        publisher.publish(matchService.respondCodeView(user.getId(), payload));
    }

    @MessageMapping("/matchmaking.chat")
    public void chat(@Payload MatchChatRequestDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        if (user.isGuest()) {
            throw new AuthException("Guest chat is disabled.");
        }
        MatchChatSubmission submission = payload == null || payload.channel() == null
                ? matchService.submitChatMessage(user.getId(), payload == null ? null : payload.matchId(), payload == null ? null : payload.message(), "ALL")
                : matchService.submitChatMessage(
                        user.getId(),
                        payload.matchId(),
                        payload.message(),
                        payload.channel());
        if (submission.status() == MatchChatSubmissionStatus.ACCEPTED) {
            MatchChatEventDTO event = chatEvent("MATCH_CHAT_MESSAGE", submission);
            submission.recipientPrincipalNames().forEach(recipient ->
                    publisher.sendToUser(
                            recipient, MatchmakingSocketDestinations.MATCH_CHAT, event));
            return;
        }
        String type = submission.status() == MatchChatSubmissionStatus.RATE_LIMITED
                ? "MATCH_CHAT_RATE_LIMITED"
                : "MATCH_CHAT_REJECTED";
        publisher.sendToUser(
                principal.getName(),
                MatchmakingSocketDestinations.MATCH_CHAT,
                chatEvent(type, submission));
    }

    private MatchChatEventDTO chatEvent(String type, MatchChatSubmission submission) {
        return new MatchChatEventDTO(
                type,
                submission.messageId(),
                submission.matchId(),
                submission.username(),
                submission.message(),
                submission.sentAt(),
                null,
                null,
                submission.channel());
    }

    @EventListener
    public void handleSubscribe(SessionSubscribeEvent event) {
        connections.handleSubscribe(event);
    }

    @EventListener
    public void handleUnsubscribe(SessionUnsubscribeEvent event) {
        connections.handleUnsubscribe(event);
    }

    @EventListener
    public void handleDisconnect(WebSocketSessionDisconnectedEvent event) {
        connections.handleDisconnect(event);
    }

    private AppUser requireUser(Principal principal) {
        if (!(principal instanceof Authentication authentication)) {
            throw new AuthException("authentication is required");
        }
        return currentUserService.requireCurrentUser(authentication);
    }

}
