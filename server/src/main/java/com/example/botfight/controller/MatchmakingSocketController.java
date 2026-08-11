package com.example.botfight.controller;

import com.example.botfight.DTO.MatchLoadoutSelectionDTO;
import com.example.botfight.DTO.MatchChatEventDTO;
import com.example.botfight.DTO.MatchChatRequestDTO;
import com.example.botfight.DTO.MatchAcceptanceDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.AuthException;
import com.example.botfight.service.CurrentUserService;
import com.example.botfight.service.MatchService;
import com.example.botfight.service.MatchmakingEventsReady;
import com.example.botfight.service.MatchmakingService;
import com.example.botfight.service.RateLimitExceededException;
import com.example.botfight.service.MatchService.OutboundMatchmakingEvent;
import com.example.botfight.service.MatchService.MatchChatClosure;
import com.example.botfight.service.MatchService.MatchChatSubmission;
import com.example.botfight.service.MatchService.MatchChatSubmissionStatus;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.core.task.AsyncTaskExecutor;
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
    private final AsyncTaskExecutor matchSimulationExecutor;
    private final Set<UUID> scheduledMatchChatClosures = new HashSet<>();
    private final Set<String> scheduledSimulations = new HashSet<>();
    private final Set<String> scheduledBuildingTimeouts = new HashSet<>();
    private final Set<String> scheduledLoadoutSelectionTimeouts = new HashSet<>();

    @Autowired
    public MatchmakingSocketController(
            MatchmakingService matchmakingService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            CurrentUserService currentUserService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler matchmakingLifecycleScheduler,
            @Qualifier("matchSimulationExecutor") AsyncTaskExecutor matchSimulationExecutor) {
        this.matchmakingService = matchmakingService;
        this.matchService = matchService;
        this.messagingTemplate = messagingTemplate;
        this.currentUserService = currentUserService;
        this.matchmakingLifecycleScheduler = matchmakingLifecycleScheduler;
        this.matchSimulationExecutor = matchSimulationExecutor;
    }

    MatchmakingSocketController(
            MatchmakingService matchmakingService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            CurrentUserService currentUserService,
            TaskScheduler matchmakingLifecycleScheduler) {
        this(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                matchmakingLifecycleScheduler,
                task -> matchmakingLifecycleScheduler.schedule(task, Instant.now()));
    }

    @PostConstruct
    void scheduleExpiredLoadoutSelectionSweep() {
        matchmakingLifecycleScheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        publish(matchService.resolveExpiredLoadoutSelections());
                        publish(matchService.resolveExpiredBuildingSessions());
                    } catch (RuntimeException exception) {
                        log.error("Matchmaking lifecycle deadline sweep failed", exception);
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
        scheduleMatchAcceptanceTimeouts(events);
        scheduleLoadoutSelectionTimeouts(events);
    }

    @MessageMapping("/matchmaking.leave")
    public void leaveQueue(Principal principal) {
        AppUser user = requireUser(principal);
        matchmakingService.leaveQueue(user.getId());
    }

    @MessageMapping("/matchmaking.resume")
    public void resumeMatch(Principal principal, SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> pendingEvents = matchmakingService.resumePendingMatch(
                user.getId(),
                headers.getSessionId());
        if (!pendingEvents.isEmpty()) {
            publish(pendingEvents);
            scheduleMatchAcceptanceTimeouts(pendingEvents);
            return;
        }
        publish(matchService.resumeMatch(
                user.getId(),
                user.getUsername(),
                principal.getName(),
                headers.getSessionId()));
    }

    @MessageMapping("/matchmaking.accept")
    public void acceptMatch(
            @Payload MatchAcceptanceDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.acceptMatch(
                payload == null ? null : payload.matchId(),
                user.getId(),
                headers.getSessionId());
        publish(events);
        scheduleLoadoutSelectionTimeouts(events);
    }

    @MessageMapping("/matchmaking.cancel")
    public void cancelMatch(
            @Payload MatchAcceptanceDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.cancelPendingMatch(
                payload == null ? null : payload.matchId(),
                user.getId(),
                headers.getSessionId());
        publish(events);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleMatchmakingEventsReady(MatchmakingEventsReady ready) {
        List<OutboundMatchmakingEvent> events = ready.events();
        publish(events);
        scheduleLoadoutSelectionTimeouts(events);
    }

    @MessageExceptionHandler(AuthException.class)
    public void handleMatchmakingError(AuthException exception, Principal principal) {
        sendError(principal, exception.getMessage());
    }

    @MessageExceptionHandler(RateLimitExceededException.class)
    public void handleMatchmakingRateLimit(
            RateLimitExceededException exception,
            Principal principal) {
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
                        "BUILDING",
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

    @MessageMapping("/matchmaking.selectLoadout")
    public void selectLoadout(@Payload MatchLoadoutSelectionDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchService.selectLoadout(user.getId(), payload == null ? null : payload.selectedLoadout());
        publish(events);
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
        matchmakingService.removeDisconnected(principal.getName(), event.getSessionId());
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

    private void publish(List<OutboundMatchmakingEvent> events) {
        scheduleBuildingTimeouts(events);
        scheduleMatchChatClosures(events);
        for (OutboundMatchmakingEvent event : events) {
            if (event.delayMillis() > 0) {
                scheduleSafely(
                        event.publishAt() != null
                                ? event.publishAt()
                                : Instant.now().plusMillis(event.delayMillis()),
                        "delayed matchmaking event",
                        () -> publish(event));
            } else {
                publish(event);
            }
        }
        scheduleAuthoritativeSimulations(events);
    }

    private void scheduleBuildingTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> event.matchId() != null
                        && event.buildingEndsAt() != null
                        && "PREP".equals(event.status()))
                .collect(java.util.stream.Collectors.toMap(
                        event -> event.matchId() + ":" + event.buildingEndsAt(),
                        event -> event,
                        (first, second) -> first))
                .forEach((key, event) -> {
                    synchronized (scheduledBuildingTimeouts) {
                        if (!scheduledBuildingTimeouts.add(key)) return;
                    }
                    Instant deadline = event.buildingEndsAt();
                    scheduleSafely(
                            deadline.plusMillis(DEADLINE_CALLBACK_BUFFER_MILLIS),
                            "building timeout",
                            () -> publish(matchService.resolveBuildingTimeout(event.matchId(), deadline)));
                });
    }

    private void scheduleMatchChatClosures(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "SIMULATION_PREPARING".equals(event.type())
                        || "MATCH_RESULT_READY".equals(event.type()))
                .map(MatchmakingEventDTO::matchId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .forEach(matchId -> {
                    synchronized (scheduledMatchChatClosures) {
                        if (!scheduledMatchChatClosures.add(matchId)) return;
                    }
                    Instant closeAt = events.stream()
                            .map(OutboundMatchmakingEvent::event)
                            .filter(event -> matchId.equals(event.matchId()))
                            .map(MatchmakingEventDTO::matchChatEndsAt)
                            .filter(java.util.Objects::nonNull)
                            .findFirst()
                            .orElseGet(() -> matchService.matchChatCloseAt(matchId));
                    if (closeAt == null) {
                        synchronized (scheduledMatchChatClosures) {
                            scheduledMatchChatClosures.remove(matchId);
                        }
                        return;
                    }
                    scheduleSafely(
                            closeAt,
                            "match chat close",
                            () -> {
                                MatchChatClosure closure = matchService.closeMatchChat(matchId);
                                synchronized (scheduledMatchChatClosures) {
                                    scheduledMatchChatClosures.remove(matchId);
                                }
                                if (closure == null) return;
                                MatchChatEventDTO event = new MatchChatEventDTO(
                                        "MATCH_CHAT_CLOSED",
                                        null,
                                        closure.matchId(),
                                        null,
                                        closure.message(),
                                        Instant.now(),
                                        closeAt,
                                        Instant.now());
                                closure.recipientPrincipalNames().forEach(recipient ->
                                        messagingTemplate.convertAndSendToUser(
                                                recipient,
                                                "/queue/match-chat",
                                                event));
                            });
                });
    }

    private void scheduleLoadoutSelectionTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> ("MATCH_STARTED".equals(event.type())
                        || "MATCH_LOADOUT_SELECTION_READY".equals(event.type())
                        || ("MATCH_ROUND_READY".equals(event.type())
                                && event.loadoutSelectionEndsAt() != null))
                        && "LOADOUT_SELECT".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .collect(java.util.stream.Collectors.toMap(
                        MatchmakingEventDTO::matchId,
                        event -> event,
                        (first, second) -> first))
                .forEach((matchId, event) -> {
                    String scheduleKey = matchId + ":" + event.loadoutSelectionEndsAt();
                    synchronized (scheduledLoadoutSelectionTimeouts) {
                        if (!scheduledLoadoutSelectionTimeouts.add(scheduleKey)) return;
                    }
                    long delayMillis = event.loadoutSelectionEndsAt() == null
                            ? TimeUnit.SECONDS.toMillis(60)
                            : delayUntil(event.loadoutSelectionEndsAt());
                    scheduleSafely(
                            Instant.now().plusMillis(delayMillis),
                            "loadout selection timeout",
                            () -> {
                            List<OutboundMatchmakingEvent> timeoutEvents = matchService.resolveLoadoutSelectionTimeout(matchId);
                            publish(timeoutEvents);
                        });
                });
    }

    private void beginMatchFoundSelections(List<OutboundMatchmakingEvent> events) {
        List<OutboundMatchmakingEvent> readyEvents = events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "MATCH_FOUND".equals(event.type()) && "MATCH_FOUND".equals(event.status()))
                .filter(event -> event.matchId() != null)
                .map(MatchmakingEventDTO::matchId)
                .distinct()
                .flatMap(matchId -> matchService.beginInitialLoadoutSelection(matchId).stream())
                .toList();
        publish(readyEvents);
        scheduleLoadoutSelectionTimeouts(readyEvents);
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
        OutboundMatchmakingEvent eventAtPhaseBoundary = "MATCH_ROUND_READY".equals(event.event().type())
                ? matchService.activateRoundLoadoutSelection(event)
                : event;
        if (eventAtPhaseBoundary == null) return;
        MatchmakingEventDTO payload = "SIMULATION_PREPARING".equals(eventAtPhaseBoundary.event().type())
                    ? eventAtPhaseBoundary.event()
                    : eventAtPhaseBoundary.event().withServerNow(Instant.now());
        messagingTemplate.convertAndSendToUser(
                eventAtPhaseBoundary.principalName(),
                "/queue/matchmaking",
                payload);
        if ("MATCH_ROUND_READY".equals(eventAtPhaseBoundary.event().type())) {
            scheduleLoadoutSelectionTimeouts(List.of(eventAtPhaseBoundary));
        }
    }

    private void scheduleAuthoritativeSimulations(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "SIMULATION_LOADING".equals(event.type()))
                .filter(event -> event.matchId() != null)
                .collect(java.util.stream.Collectors.toMap(
                        event -> event.matchId() + ":" + event.roundNumber(),
                        event -> event,
                        (first, second) -> first))
                .forEach((key, event) -> {
                    synchronized (scheduledSimulations) {
                        if (!scheduledSimulations.add(key)) return;
                    }
                    matchSimulationExecutor.execute(() -> {
                        try {
                                List<OutboundMatchmakingEvent> replayEvents = matchService.completeSimulation(event.matchId());
                                publish(replayEvents);
                                scheduleLoadoutSelectionTimeouts(replayEvents);
                        } catch (RuntimeException exception) {
                            log.error("Matchmaking authoritative replay simulation failed", exception);
                        }
                    });
                });
    }

    private void scheduleMatchAcceptanceTimeouts(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "MATCH_FOUND".equals(event.type())
                        && "MATCH_ACCEPT".equals(event.status()))
                .filter(event -> event.matchId() != null
                        && event.matchAcceptanceEndsAt() != null)
                .collect(java.util.stream.Collectors.toMap(
                        MatchmakingEventDTO::matchId,
                        event -> event,
                        (first, second) -> first))
                .forEach((matchId, event) -> {
                    Instant deadline = event.matchAcceptanceEndsAt();
                    scheduleSafely(
                            deadline,
                            "match acceptance timeout",
                            () -> publish(matchmakingService.resolvePendingMatchTimeout(matchId, deadline)));
                });
    }

}
