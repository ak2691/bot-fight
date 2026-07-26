package com.example.botfight.controller;

import com.example.botfight.DTO.MatchClassSelectionDTO;
import com.example.botfight.DTO.MatchChatEventDTO;
import com.example.botfight.DTO.MatchChatRequestDTO;
import com.example.botfight.DTO.MatchFinishDTO;
import com.example.botfight.DTO.MatchObjectPlacementDTO;
import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.AuthException;
import com.example.botfight.service.CurrentUserService;
import com.example.botfight.service.MatchService;
import com.example.botfight.service.MatchmakingService;
import com.example.botfight.service.MatchService.OutboundMatchmakingEvent;
import com.example.botfight.service.MatchService.MatchChatSubmission;
import com.example.botfight.service.MatchService.MatchChatSubmissionStatus;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Qualifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Controller
public class MatchmakingSocketController {

    private static final Logger log = LoggerFactory.getLogger(MatchmakingSocketController.class);
    private static final int CONNECTION_LOSS_DETECTION_SECONDS = 10;
    private static final long DEADLINE_CALLBACK_BUFFER_MILLIS = 250L;
    private final MatchmakingService matchmakingService;
    private final MatchService matchService;
    private final SimpMessagingTemplate messagingTemplate;
    private final CurrentUserService currentUserService;
    private final TaskScheduler matchmakingLifecycleScheduler;

    public MatchmakingSocketController(
            MatchmakingService matchmakingService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            CurrentUserService currentUserService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler matchmakingLifecycleScheduler) {
        this.matchmakingService = matchmakingService;
        this.matchService = matchService;
        this.messagingTemplate = messagingTemplate;
        this.currentUserService = currentUserService;
        this.matchmakingLifecycleScheduler = matchmakingLifecycleScheduler;
    }

    @PostConstruct
    void scheduleExpiredClassSelectionSweep() {
        matchmakingLifecycleScheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        publish(matchService.resolveExpiredClassSelections());
                    } catch (RuntimeException exception) {
                        log.error("Matchmaking expired class selection sweep failed", exception);
                    }
                },
                Duration.ofMillis(250));
    }

    @MessageMapping("/matchmaking.join")
    public void joinQueue(Principal principal, SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.joinQueue(
                user.getId(),
                user.getUsername(),
                principal.getName(),
                headers.getSessionId());
        publish(events);
        beginMatchFoundSelections(events);
        scheduleClassSelectionTimeouts(events);
    }

    @MessageMapping("/matchmaking.leave")
    public void leaveQueue(Principal principal) {
        AppUser user = requireUser(principal);
        matchmakingService.leaveQueue(user.getId());
    }

    @MessageMapping("/matchmaking.resume")
    public void resumeMatch(Principal principal, SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        publish(matchService.resumeMatch(
                user.getId(),
                user.getUsername(),
                principal.getName(),
                headers.getSessionId()));
    }

    @MessageMapping("/matchmaking.finish")
    public void finish(@Payload MatchFinishDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchService.markFinished(user.getId(), payload == null ? null : payload.modelSubmissionId());
        publish(events);
        scheduleClassSelectionTimeouts(events);
        scheduleObjectPlacementTimeouts(events);
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "SIMULATION_PREPARING".equals(event.type()))
                .map(MatchmakingEventDTO::matchId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .forEach(matchId -> scheduleSafely(
                        Instant.now(),
                        "authoritative replay simulation",
                        () -> {
                            List<OutboundMatchmakingEvent> replayEvents = matchService.completeSimulation(matchId);
                            publish(replayEvents);
                            scheduleClassSelectionTimeouts(replayEvents);
                            scheduleObjectPlacementTimeouts(replayEvents);
                        }));
    }

    @MessageExceptionHandler(AuthException.class)
    public void handleMatchmakingError(AuthException exception, Principal principal) {
        sendError(principal, exception.getMessage());
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
        messagingTemplate.convertAndSendToUser(
                principal.getName(),
                "/queue/matchmaking",
                new MatchmakingEventDTO(
                        "MATCH_ERROR",
                        null,
                        null,
                        "TRAINING",
                        null,
                        null,
                        List.of(),
                        Instant.now(),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        message,
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        null));
    }

    @MessageMapping("/matchmaking.selectClass")
    public void selectClass(@Payload MatchClassSelectionDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchService.selectClass(user.getId(), payload == null ? null : payload.selectedClass());
        publish(events);
        scheduleObjectPlacementTimeouts(events);
    }

    @MessageMapping("/matchmaking.placeObjects")
    public void placeObjects(@Payload MatchObjectPlacementDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchService.submitObjectPlacements(
                user.getId(),
                toPlaybackObjects(payload));
        publish(events);
        scheduleObjectPlacementTimeouts(events);
    }

    @MessageMapping("/matchmaking.surrender")
    public void surrender(Principal principal) {
        AppUser user = requireUser(principal);
        publish(matchService.surrender(user.getId()));
    }

    @MessageMapping("/matchmaking.chat")
    public void chat(@Payload MatchChatRequestDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        MatchChatSubmission submission = matchService.submitChatMessage(
                user.getId(),
                payload == null ? null : payload.matchId(),
                payload == null ? null : payload.message());
        if (submission.status() == MatchChatSubmissionStatus.ACCEPTED) {
            MatchChatEventDTO event = chatEvent("MATCH_CHAT_MESSAGE", submission);
            submission.recipientPrincipalNames().forEach(recipient ->
                    messagingTemplate.convertAndSendToUser(recipient, "/queue/match-chat", event));
            return;
        }
        String type = submission.status() == MatchChatSubmissionStatus.RATE_LIMITED
                ? "MATCH_CHAT_RATE_LIMITED"
                : "MATCH_CHAT_REJECTED";
        messagingTemplate.convertAndSendToUser(
                principal.getName(),
                "/queue/match-chat",
                chatEvent(type, submission));
    }

    private MatchChatEventDTO chatEvent(String type, MatchChatSubmission submission) {
        return new MatchChatEventDTO(
                type,
                submission.messageId(),
                submission.matchId(),
                submission.username(),
                submission.message(),
                submission.sentAt());
    }

    @EventListener
    public void handleDisconnect(SessionDisconnectEvent event) {
        Principal principal = event.getUser();
        if (principal == null) {
            log.warn("Ignoring WebSocket disconnect without an authenticated principal. sessionId={}",
                    event.getSessionId());
            return;
        }
        scheduleDisconnectDetection(principal.getName(), event.getSessionId());
    }

    private void scheduleDisconnectDetection(String principalName, String socketSessionId) {
        log.info("Scheduling connection-loss detection. principal={}, sessionId={}",
                principalName,
                socketSessionId);
        scheduleSafely(
                Instant.now().plusSeconds(CONNECTION_LOSS_DETECTION_SECONDS),
                "connection loss detection",
                () -> {
                    matchmakingService.removeDisconnected(principalName, socketSessionId);
                    publishDisconnect(
                            principalName,
                            matchService.markDisconnected(principalName, socketSessionId));
                });
    }

    private void publishDisconnect(String principalName, List<OutboundMatchmakingEvent> events) {
        if (events.isEmpty()) {
            log.info("Connection-loss detection produced no match event; the socket was replaced or the match ended. principal={}",
                    principalName);
            return;
        }
        publish(events);
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(matchEvent -> "PLAYER_DISCONNECTED".equals(matchEvent.type()))
                .map(MatchmakingEventDTO::disconnectEndsAt)
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .ifPresent(deadline -> {
                    log.info("Disconnect grace period started. principal={}, deadline={}",
                            principalName,
                            deadline);
                    scheduleSafely(
                            deadline.plusMillis(DEADLINE_CALLBACK_BUFFER_MILLIS),
                            "disconnect timeout",
                            () -> {
                                List<OutboundMatchmakingEvent> resolutionEvents =
                                        matchService.resolveDisconnectTimeout(principalName, deadline);
                                log.info("Disconnect grace period resolved. principal={}, eventCount={}",
                                        principalName,
                                        resolutionEvents.size());
                                publish(resolutionEvents);
                            });
                });
    }

    private AppUser requireUser(Principal principal) {
        if (!(principal instanceof Authentication authentication)) {
            throw new AuthException("authentication is required");
        }
        return currentUserService.requireCurrentUser(authentication);
    }

    private List<MatchPlaybackDTO.ObstaclePlacementDTO> toPlaybackObjects(MatchObjectPlacementDTO payload) {
        if (payload == null || payload.objects() == null) {
            return List.of();
        }
        return payload.objects().stream()
                .filter(object -> object != null)
                .map(object -> new MatchPlaybackDTO.ObstaclePlacementDTO(
                        object.id(),
                        object.type(),
                        object.x(),
                        object.y(),
                        object.size(),
                        object.rotation()))
                .toList();
    }

    private void publish(List<OutboundMatchmakingEvent> events) {
        for (OutboundMatchmakingEvent event : events) {
            if (event.delayMillis() > 0) {
                scheduleSafely(
                        Instant.now().plusMillis(event.delayMillis()),
                        "delayed matchmaking event",
                        () -> publish(event));
            } else {
                publish(event);
            }
        }
    }

    private void scheduleClassSelectionTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> ("MATCH_CLASS_SELECTION_READY".equals(event.type()) || "MATCH_ROUND_READY".equals(event.type()))
                        && "CLASS_SELECT".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .collect(java.util.stream.Collectors.toMap(
                        MatchmakingEventDTO::matchId,
                        event -> event,
                        (first, second) -> first))
                .forEach((matchId, event) -> {
                    long delayMillis = event.classSelectionEndsAt() == null
                            ? TimeUnit.SECONDS.toMillis(60)
                            : delayUntil(event.classSelectionEndsAt());
                    scheduleSafely(
                            Instant.now().plusMillis(delayMillis),
                            "class selection timeout",
                            () -> {
                            List<OutboundMatchmakingEvent> timeoutEvents = matchService.resolveClassSelectionTimeout(matchId);
                            publish(timeoutEvents);
                            scheduleObjectPlacementTimeouts(timeoutEvents);
                        });
                });
    }

    private void scheduleObjectPlacementTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "OBJECT_PLACEMENT".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .forEach(event -> {
                    long delayMillis = event.objectPlacementEndsAt() == null
                            ? TimeUnit.SECONDS.toMillis(20)
                            : delayUntil(event.objectPlacementEndsAt());
                    scheduleSafely(
                            Instant.now().plusMillis(delayMillis),
                            "object placement timeout",
                            () -> publish(matchService.resolveObjectPlacementTimeout(event.matchId())));
                });
    }

    private void beginMatchFoundSelections(List<OutboundMatchmakingEvent> events) {
        List<OutboundMatchmakingEvent> readyEvents = events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "MATCH_FOUND".equals(event.type()) && "MATCH_FOUND".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .map(MatchmakingEventDTO::matchId)
                .distinct()
                .flatMap(matchId -> matchService.beginInitialClassSelection(matchId).stream())
                .toList();
        publish(readyEvents);
        scheduleClassSelectionTimeouts(readyEvents);
    }

    private void scheduleSafely(Instant runAt, String taskName, Runnable task) {
        matchmakingLifecycleScheduler.schedule(() -> {
            try {
                task.run();
            } catch (RuntimeException exception) {
                log.error("Matchmaking {} failed", taskName, exception);
            }
        }, runAt);
    }

    private static long delayUntil(Instant deadline) {
        Duration remaining = Duration.between(Instant.now(), deadline);
        if (remaining.isNegative() || remaining.isZero()) return 0;
        long wholeMillis = remaining.toMillis();
        return remaining.compareTo(Duration.ofMillis(wholeMillis)) > 0 ? wholeMillis + 1 : wholeMillis;
    }

    private void publish(OutboundMatchmakingEvent event) {
        messagingTemplate.convertAndSendToUser(
                event.principalName(),
                "/queue/matchmaking",
                event.event());
    }
}
