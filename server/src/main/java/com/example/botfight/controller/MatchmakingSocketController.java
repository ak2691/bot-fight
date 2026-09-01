package com.example.botfight.controller;

import com.example.botfight.DTO.MatchLoadoutSelectionDTO;
import com.example.botfight.DTO.MatchCodeViewRequestDTO;
import com.example.botfight.DTO.MatchCodeViewResponseDTO;
import com.example.botfight.DTO.MatchChatEventDTO;
import com.example.botfight.DTO.MatchChatRequestDTO;
import com.example.botfight.DTO.MatchAcceptanceDTO;
import com.example.botfight.DTO.CustomLobbyStateEventDTO;
import com.example.botfight.DTO.MatchmakingJoinRequestDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.PartyStateEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchChatSubmission;
import com.example.botfight.service.match.model.MatchChatSubmissionStatus;
import com.example.botfight.service.matchmaking.MatchmakingEventsReady;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
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
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

@Controller
public class MatchmakingSocketController {

    private static final Logger log = LoggerFactory.getLogger(MatchmakingSocketController.class);
    private static final int CONNECTION_LOSS_DETECTION_SECONDS = 10;
    private static final Duration MATCHMAKING_QUEUE_SWEEP_INTERVAL = Duration.ofSeconds(2);
    private static final long DEADLINE_CALLBACK_BUFFER_MILLIS = 250L;
    private static final long PHASE_TRANSITION_SCHEDULER_BUFFER_MILLIS = 0L;
    private final MatchmakingService matchmakingService;
    private final MatchService matchService;
    private final SimpMessagingTemplate messagingTemplate;
    private final CurrentUserService currentUserService;
    private final PartyService partyService;
    private final PartyStatePublisher partyStatePublisher;
    private final TaskScheduler matchmakingLifecycleScheduler;
    private final AsyncTaskExecutor matchSimulationExecutor;
    private final SingleUserWebSocketSessionRegistry singleUserWebSocketSessionRegistry;
    private final CustomLobbyService customLobbyService;
    private final CustomLobbyStatePublisher customLobbyStatePublisher;
    private final Set<UUID> scheduledMatchChatClosures = new HashSet<>();
    private final Set<String> scheduledSimulations = new HashSet<>();
    private final Set<String> scheduledBuildingTimeouts = new HashSet<>();
    private final Set<String> scheduledLoadoutSelectionTimeouts = new HashSet<>();
    private final Map<UUID, Set<ScheduledFuture<?>>> scheduledDelayedMatchEvents = new ConcurrentHashMap<>();
    private final Map<String, Map<String, String>> matchSubscriptionsBySession = new ConcurrentHashMap<>();

    @Autowired
    public MatchmakingSocketController(
            MatchmakingService matchmakingService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            CurrentUserService currentUserService,
            PartyService partyService,
            PartyStatePublisher partyStatePublisher,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler matchmakingLifecycleScheduler,
            @Qualifier("matchSimulationExecutor") AsyncTaskExecutor matchSimulationExecutor,
            SingleUserWebSocketSessionRegistry singleUserWebSocketSessionRegistry,
            CustomLobbyService customLobbyService,
            CustomLobbyStatePublisher customLobbyStatePublisher) {
        this.matchmakingService = matchmakingService;
        this.matchService = matchService;
        this.messagingTemplate = messagingTemplate;
        this.currentUserService = currentUserService;
        this.partyService = partyService;
        this.partyStatePublisher = partyStatePublisher;
        this.matchmakingLifecycleScheduler = matchmakingLifecycleScheduler;
        this.matchSimulationExecutor = matchSimulationExecutor;
        this.singleUserWebSocketSessionRegistry = singleUserWebSocketSessionRegistry;
        this.customLobbyService = customLobbyService;
        this.customLobbyStatePublisher = customLobbyStatePublisher;
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
                null,
                null,
                matchmakingLifecycleScheduler,
                task -> matchmakingLifecycleScheduler.schedule(task, Instant.now()),
                new SingleUserWebSocketSessionRegistry(),
                null,
                null);
    }

    MatchmakingSocketController(
            MatchmakingService matchmakingService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            CurrentUserService currentUserService,
            TaskScheduler matchmakingLifecycleScheduler,
            SingleUserWebSocketSessionRegistry singleUserWebSocketSessionRegistry) {
        this(
                matchmakingService,
                matchService,
                messagingTemplate,
                currentUserService,
                null,
                null,
                matchmakingLifecycleScheduler,
                task -> matchmakingLifecycleScheduler.schedule(task, Instant.now()),
                singleUserWebSocketSessionRegistry,
                null,
                null);
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

    @PostConstruct
    void scheduleQueueMatchmakingSweep() {
        matchmakingLifecycleScheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        List<OutboundMatchmakingEvent> events = matchmakingService.sweepQueues();
                        if (events.isEmpty()) return;
                        publish(events);
                        scheduleMatchAcceptanceTimeouts(events);
                    } catch (RuntimeException exception) {
                        log.error("Ranked matchmaking queue sweep failed", exception);
                    }
                },
                MATCHMAKING_QUEUE_SWEEP_INTERVAL);
    }

    @MessageMapping("/matchmaking.join")
    public void joinQueue(
            @Payload MatchmakingJoinRequestDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        MatchMode mode;
        try {
            mode = MatchMode.fromWire(payload == null ? null : payload.mode());
        } catch (IllegalArgumentException exception) {
            throw new AuthException("The selected match mode is not available.");
        }
        PartyService.QueueContext queueContext = partyService != null
                ? partyService.queueContext(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        headers.getSessionId())
                : null;
        List<MatchEntrant> queueGroup = queueContext != null
                ? queueContext.entrants()
                : List.of(new MatchEntrant(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        headers.getSessionId()));
        List<OutboundMatchmakingEvent> events = matchmakingService.joinQueue(
                user.getId(),
                user.getUsername(),
                principal.getName(),
                headers.getSessionId(),
                mode,
                queueGroup,
                queueContext == null ? null : queueContext.partyId(),
                payload == null ? List.of() : payload.guaranteedAbilityIds());
        publish(events);
        publishPartyQueueState(queueContext, mode, events, "WAITING");
        scheduleMatchAcceptanceTimeouts(events);
        scheduleSelectionTimeouts(events);
    }

    /** Compatibility entry point for existing direct callers and old clients. */
    public void joinQueue(Principal principal, SimpMessageHeaderAccessor headers) {
        joinQueue(null, principal, headers);
    }

    @MessageMapping("/matchmaking.leave")
    public void leaveQueue(Principal principal) {
        AppUser user = requireUser(principal);
        PartyService.QueueContext queueContext = partyService != null
                ? partyService.queueContext(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        null)
                : null;
        matchmakingService.leaveQueue(user.getId());
        publishPartyQueueState(queueContext, null, List.of(), "CANCELLED");
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
        List<OutboundMatchmakingEvent> queueEvents = matchmakingService.resumeQueuedPlayer(
                user.getId(),
                headers.getSessionId());
        if (!queueEvents.isEmpty()) {
            publish(queueEvents);
            return;
        }
        publishToDestination(
                matchService.resumeMatch(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        headers.getSessionId()),
                MatchmakingSocketDestinations.MATCH);
    }

    /** Rebinds a refreshed/reconnected browser to its waiting queue entry. */
    @MessageMapping("/matchmaking.resumeQueue")
    public void resumeQueue(Principal principal, SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> pendingEvents = matchmakingService.resumePendingMatch(
                user.getId(),
                headers.getSessionId());
        if (!pendingEvents.isEmpty()) {
            publish(pendingEvents);
            scheduleMatchAcceptanceTimeouts(pendingEvents);
            return;
        }
        List<OutboundMatchmakingEvent> queueEvents = matchmakingService.resumeQueuedPlayer(
                user.getId(),
                headers.getSessionId());
        if (!queueEvents.isEmpty()) {
            publish(queueEvents);
            return;
        }
        sendQueueIdle(principal);
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
        scheduleSelectionTimeouts(events);
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
        scheduleSelectionTimeouts(events);
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
        messagingTemplate.convertAndSendToUser(
                principal.getName(),
                MatchmakingSocketDestinations.MATCHMAKING,
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

    private void sendQueueIdle(Principal principal) {
        if (principal == null) {
            return;
        }
        messagingTemplate.convertAndSendToUser(
                principal.getName(),
                MatchmakingSocketDestinations.MATCHMAKING,
                new MatchmakingEventDTO(
                        "QUEUE_IDLE",
                        null,
                        null,
                        "IDLE",
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
                        null,
                        null,
                        List.of(),
                        List.of(),
                        List.of(),
                        null,
                        List.of(),
                        null));
    }

    private void publishPartyQueueState(
            PartyService.QueueContext queueContext,
            MatchMode mode,
            List<OutboundMatchmakingEvent> events,
            String fallbackStatus) {
        if (partyStatePublisher == null
                || queueContext == null
                || queueContext.partyId() == null) {
            return;
        }
        OutboundMatchmakingEvent found = events == null
                ? null
                : events.stream()
                        .filter(event -> "MATCH_FOUND".equals(event.event().type()))
                        .findFirst()
                        .orElse(null);
        String queueStatus = found == null ? fallbackStatus : "MATCH_FOUND";
        UUID matchId = found == null ? null : found.event().matchId();
        String queueMode = mode == null ? null : mode.name();
        partyStatePublisher.send(
                queueContext.recipients(),
                new PartyStateEventDTO(
                        "PARTY_QUEUE_STATE",
                        queueContext.partyId(),
                        queueContext.party(),
                        queueStatus,
                        queueMode,
                        matchId,
                        Instant.now()));
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
        publish(events);
    }

    @MessageMapping("/matchmaking.leaveCompletedMatch")
    public void leaveCompletedMatch(Principal principal) {
        AppUser user = requireUser(principal);
        matchService.leaveCompletedMatch(user.getId());
    }

    @MessageMapping("/matchmaking.surrender")
    public void surrender(Principal principal) {
        AppUser user = requireUser(principal);
        publish(matchService.surrender(user.getId()));
    }

    @MessageMapping("/matchmaking.codeView.request")
    public void requestCodeView(
            @Payload MatchCodeViewRequestDTO payload,
            Principal principal) {
        AppUser user = requireUser(principal);
        if (payload == null) {
            throw new AuthException("the code view request is invalid");
        }
        publish(matchService.requestCodeView(
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
        publish(matchService.respondCodeView(user.getId(), payload));
    }

    @MessageMapping("/matchmaking.chat")
    public void chat(@Payload MatchChatRequestDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        MatchChatSubmission submission = payload == null || payload.channel() == null
                ? matchService.submitChatMessage(
                        user.getId(),
                        payload == null ? null : payload.matchId(),
                        payload == null ? null : payload.message())
                : matchService.submitChatMessage(
                        user.getId(),
                        payload.matchId(),
                        payload.message(),
                        payload.channel());
        if (submission.status() == MatchChatSubmissionStatus.ACCEPTED) {
            MatchChatEventDTO event = chatEvent("MATCH_CHAT_MESSAGE", submission);
            submission.recipientPrincipalNames().forEach(recipient ->
                    messagingTemplate.convertAndSendToUser(
                            recipient, MatchmakingSocketDestinations.MATCH_CHAT, event));
            return;
        }
        String type = submission.status() == MatchChatSubmissionStatus.RATE_LIMITED
                ? "MATCH_CHAT_RATE_LIMITED"
                : "MATCH_CHAT_REJECTED";
        messagingTemplate.convertAndSendToUser(
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
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.wrap(event.getMessage());
        String sessionId = headers.getSessionId();
        String subscriptionId = headers.getSubscriptionId();
        if (sessionId == null || subscriptionId == null) {
            return;
        }
        Principal principal = event.getUser();
        if (principal == null) {
            principal = headers.getUser();
        }
        if (MatchmakingSocketDestinations.isPartySubscription(headers.getDestination())) {
            if (partyService == null || principal == null || principal.getName() == null) return;
            partyService.registerSocket(principal.getName(), sessionId);
            if (partyStatePublisher != null) {
                var party = partyService.currentForPrincipal(principal.getName());
                List<PartyService.PartyRecipient> recipients = party == null
                        ? List.of(new PartyService.PartyRecipient(principal.getName(), null))
                        : partyService.recipientsForParty(party.partyId());
                partyStatePublisher.send(
                        recipients,
                        new PartyStateEventDTO(
                                "PARTY_STATE_UPDATED",
                                party == null ? null : party.partyId(),
                                party,
                                "IDLE",
                                null,
                                null,
                                Instant.now()));
            }
            return;
        }
        if (!MatchmakingSocketDestinations.isMatchSubscription(headers.getDestination())) {
            return;
        }
        String principalName = principal == null ? "" : principal.getName();
        matchSubscriptionsBySession
                .computeIfAbsent(sessionId, ignored -> new ConcurrentHashMap<>())
                .put(subscriptionId, principalName == null ? "" : principalName);
    }

    @EventListener
    public void handleUnsubscribe(SessionUnsubscribeEvent event) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.wrap(event.getMessage());
        String sessionId = headers.getSessionId();
        String subscriptionId = headers.getSubscriptionId();
        if (sessionId == null || subscriptionId == null) {
            return;
        }
        AtomicBoolean removed = new AtomicBoolean(false);
        AtomicReference<String> subscribedPrincipalName = new AtomicReference<>();
        Map<String, String> remaining = matchSubscriptionsBySession.computeIfPresent(
                sessionId,
                (ignored, subscriptions) -> {
                    if (!subscriptions.containsKey(subscriptionId)) return subscriptions;
                    subscribedPrincipalName.set(subscriptions.remove(subscriptionId));
                    removed.set(true);
                    return subscriptions.isEmpty() ? null : subscriptions;
                });
        if (!removed.get() || remaining != null) {
            return;
        }
        Principal principal = event.getUser();
        if (principal == null) {
            principal = headers.getUser();
        }
        String principalName = principal == null
                ? subscribedPrincipalName.get()
                : principal.getName();
        if (principalName == null || principalName.isBlank()) {
            log.warn("Ignoring match subscription removal without an authenticated principal. sessionId={}",
                    sessionId);
            return;
        }
        scheduleDisconnectDetection(principalName, sessionId);
    }

    @EventListener
    public void handleDisconnect(SessionDisconnectEvent event) {
        matchSubscriptionsBySession.remove(event.getSessionId());
        Principal principal = event.getUser();
        if (principal == null) {
            log.warn("Ignoring WebSocket disconnect without an authenticated principal. sessionId={}",
                    event.getSessionId());
            return;
        }
        PartyService.LeaveResult partyChange = new PartyService.LeaveResult(
                null,
                null,
                List.of());
        if (partyService != null) {
            partyChange = partyService.removeDisconnected(
                    principal.getName(),
                    event.getSessionId());
            if (partyStatePublisher != null && !partyChange.recipients().isEmpty()) {
                partyStatePublisher.send(
                        partyChange.recipients(),
                        new PartyStateEventDTO(
                                "PARTY_STATE_UPDATED",
                                partyChange.partyId(),
                                partyChange.party(),
                                "IDLE",
                                null,
                                null,
                                Instant.now()));
            }
        }
        matchmakingService.markDisconnected(
                principal.getName(),
                event.getSessionId());
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
                    if (hasMatchSubscription(socketSessionId)) {
                        log.info("Skipping connection-loss detection because the match subscription was restored. principal={}, sessionId={}",
                                principalName,
                                socketSessionId);
                        return;
                    }
                    publishDisconnect(
                            principalName,
                            matchService.markDisconnected(principalName, socketSessionId));
                });
    }

    private boolean hasMatchSubscription(String socketSessionId) {
        Map<String, String> subscriptions = matchSubscriptionsBySession.get(socketSessionId);
        return subscriptions != null && !subscriptions.isEmpty();
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
        // Delayed replay and round-boundary events are intentionally not
        // current until their scheduled publish time. Immediate events,
        // however, must pass the authoritative snapshot check before any
        // timeout, chat-closure, or simulation work is scheduled from them.
        List<OutboundMatchmakingEvent> currentImmediateEvents = events.stream()
                .filter(event -> event.delayMillis() <= 0)
                .filter(matchService::isCurrentEvent)
                .toList();
        currentImmediateEvents.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "MATCH_RESULT_READY".equals(event.type()))
                .map(MatchmakingEventDTO::matchId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .forEach(this::cancelScheduledDelayedMatchEvents);
        scheduleLoadoutSelectionTimeouts(currentImmediateEvents);
        scheduleBuildingTimeouts(currentImmediateEvents);
        scheduleMatchChatClosures(currentImmediateEvents);
        Set<UUID> terminalMatchIds = currentImmediateEvents.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> "MATCH_RESULT_READY".equals(event.type()))
                .map(MatchmakingEventDTO::matchId)
                .filter(java.util.Objects::nonNull)
                .collect(java.util.stream.Collectors.toSet());
        for (OutboundMatchmakingEvent event : events) {
            boolean terminalResult = "MATCH_RESULT_READY".equals(event.event().type());
            if (event.delayMillis() > 0
                    && (terminalResult || !terminalMatchIds.contains(event.event().matchId()))) {
                scheduleDelayedMatchEvent(
                        event,
                        event.publishAt() != null
                                ? event.publishAt()
                        : Instant.now().plusMillis(event.delayMillis()),
                        "delayed matchmaking event");
            } else if (currentImmediateEvents.contains(event)) {
                publish(event);
            }
        }
        scheduleAuthoritativeSimulations(currentImmediateEvents);
    }

    private void scheduleDelayedMatchEvent(
            OutboundMatchmakingEvent event,
            Instant runAt,
        String taskName) {
        UUID matchId = event.event().matchId();
        boolean phaseTransition = isScheduledPhaseTransition(event);
        Instant authoritativeRunAt = phaseTransition
                ? authoritativePhaseTransitionAt(event, runAt)
                : runAt;
        boolean enforceBoundary = phaseTransition
                && (event.publishAt() != null
                        || event.event().roundReadyAt() != null
                        || event.event().resultRevealsAt() != null);
        Instant schedulerRunAt = enforceBoundary
                ? runAt.isAfter(authoritativeRunAt)
                        ? runAt
                        : authoritativeRunAt.plusMillis(PHASE_TRANSITION_SCHEDULER_BUFFER_MILLIS)
                : runAt;
        AtomicReference<ScheduledFuture<?>> futureRef = new AtomicReference<>();
        ScheduledFuture<?> future = scheduleSafely(
                schedulerRunAt,
                taskName,
                () -> {
                    Instant firedAt = Instant.now();
                    ScheduledFuture<?> scheduledFuture = futureRef.get();
                    if (matchId != null && scheduledFuture != null) {
                        removeScheduledDelayedMatchEvent(matchId, scheduledFuture);
                    }
                    if (enforceBoundary && firedAt.isBefore(authoritativeRunAt)) {
                        long earlyByMillis = Duration.between(firedAt, authoritativeRunAt).toMillis();
                        scheduleDelayedMatchEvent(
                                event,
                                authoritativeRunAt.plusMillis(
                                        Math.max(0, earlyByMillis)
                                                + PHASE_TRANSITION_SCHEDULER_BUFFER_MILLIS),
                                taskName);
                        return;
                    }
                    publish(event);
                });
        futureRef.set(future);
        if (matchId != null && future != null) {
            scheduledDelayedMatchEvents
                    .computeIfAbsent(matchId, ignored -> ConcurrentHashMap.newKeySet())
                    .add(future);
        }
    }

    private static boolean isScheduledPhaseTransition(OutboundMatchmakingEvent event) {
        String type = event.event().type();
        return "MATCH_ROUND_READY".equals(type) || "MATCH_RESULT_READY".equals(type);
    }

    private static Instant authoritativePhaseTransitionAt(
            OutboundMatchmakingEvent event,
            Instant fallback) {
        if (event.publishAt() != null) return event.publishAt();
        if ("MATCH_ROUND_READY".equals(event.event().type())
                && event.event().roundReadyAt() != null) {
            return event.event().roundReadyAt();
        }
        if ("MATCH_RESULT_READY".equals(event.event().type())
                && event.event().resultRevealsAt() != null) {
            return event.event().resultRevealsAt();
        }
        return fallback;
    }

    private void cancelScheduledDelayedMatchEvents(UUID matchId) {
        if (matchId == null) return;
        Set<ScheduledFuture<?>> scheduled = scheduledDelayedMatchEvents.remove(matchId);
        if (scheduled == null) return;
        scheduled.forEach(future -> {
            if (!future.isDone()) future.cancel(false);
        });
    }

    private void removeScheduledDelayedMatchEvent(UUID matchId, ScheduledFuture<?> future) {
        scheduledDelayedMatchEvents.computeIfPresent(matchId, (ignored, scheduled) -> {
            scheduled.remove(future);
            return scheduled.isEmpty() ? null : scheduled;
        });
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
                    Map<String, String> expectedChatSocketIds = new HashMap<>();
                    events.stream()
                            .filter(outbound -> matchId.equals(outbound.event().matchId()))
                            .forEach(outbound -> expectedChatSocketIds.putIfAbsent(
                                    outbound.principalName(),
                                    singleUserWebSocketSessionRegistry.currentSessionIdForPrincipal(
                                            outbound.principalName())));
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
                                closure.recipientPrincipalNames().forEach(
                                        recipient -> {
                                            String expectedSessionId = expectedChatSocketIds.get(recipient);
                                            if (expectedSessionId == null || expectedSessionId.isBlank()) {
                                                return;
                                            }
                                            messagingTemplate.convertAndSendToUser(
                                                    recipient,
                                                    MatchmakingSocketDestinations.MATCH_CHAT,
                                                    event,
                                                    Map.of(SimpMessageHeaderAccessor.SESSION_ID_HEADER,
                                                            expectedSessionId));
                                            // Match chat is a subscription-level concern. Keep
                                            // the authenticated transport alive for notifications;
                                            // the match route will remove its match subscriptions.
                                        });
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

    private void scheduleSelectionTimeouts(List<OutboundMatchmakingEvent> events) {
        scheduleLoadoutSelectionTimeouts(events);
    }

    private ScheduledFuture<?> scheduleSafely(Instant runAt, String taskName, Runnable task) {
        try {
            return matchmakingLifecycleScheduler.schedule(() -> {
                try {
                    task.run();
                } catch (RuntimeException exception) {
                    log.error("Matchmaking {} failed runAt={}", taskName, runAt, exception);
                }
            }, runAt);
        } catch (RuntimeException exception) {
            log.error("Unable to schedule matchmaking task taskName={} runAt={}", taskName, runAt, exception);
            throw exception;
        }
    }

    private static long delayUntil(Instant deadline) {
        Duration remaining = Duration.between(Instant.now(), deadline);
        if (remaining.isNegative() || remaining.isZero()) return 0;
        long wholeMillis = remaining.toMillis();
        return remaining.compareTo(Duration.ofMillis(wholeMillis)) > 0 ? wholeMillis + 1 : wholeMillis;
    }

    private void publishToDestination(
            List<OutboundMatchmakingEvent> events,
            String destination) {
        events.forEach(event -> publish(event, destination));
    }

    private void publish(OutboundMatchmakingEvent event) {
        publish(event, null);
    }

    private void publish(
            OutboundMatchmakingEvent event,
            String destinationOverride) {
        if (!matchService.isCurrentEvent(event)) return;
        boolean roundBoundary = "MATCH_ROUND_READY".equals(event.event().type());
        OutboundMatchmakingEvent eventAtPhaseBoundary = roundBoundary
                ? matchService.activateRoundLoadoutSelection(event)
                : event;
        if (eventAtPhaseBoundary == null) {
            return;
        }
        if (!matchService.isCurrentEvent(eventAtPhaseBoundary)) return;
        if ("MATCH_RESULT_READY".equals(eventAtPhaseBoundary.event().type())) {
            matchService.revealCompletedMatchResult(eventAtPhaseBoundary.event().matchId());
            matchService.expireCompletedMatch(eventAtPhaseBoundary.event().matchId());
            releaseCompletedCustomLobby(eventAtPhaseBoundary.event().matchId());
        }
        MatchmakingEventDTO payload = "SIMULATION_PREPARING".equals(eventAtPhaseBoundary.event().type())
                    ? eventAtPhaseBoundary.event()
                    : eventAtPhaseBoundary.event().withServerNow(Instant.now());
        String destination = destinationOverride != null
                ? destinationOverride
                : MatchmakingSocketDestinations.forMatchmakingEvent(payload);
        messagingTemplate.convertAndSendToUser(
                eventAtPhaseBoundary.principalName(),
                destination,
                payload);
        if ("MATCH_ROUND_READY".equals(eventAtPhaseBoundary.event().type())) {
            scheduleSelectionTimeouts(List.of(eventAtPhaseBoundary));
            List<OutboundMatchmakingEvent> pendingDisconnectEvents =
                    matchService.promotePendingDisconnect(eventAtPhaseBoundary.principalName());
            if (!pendingDisconnectEvents.isEmpty()) {
                publishDisconnect(eventAtPhaseBoundary.principalName(), pendingDisconnectEvents);
            }
        }
    }

    private void releaseCompletedCustomLobby(UUID matchId) {
        if (customLobbyService == null || customLobbyStatePublisher == null || matchId == null) {
            return;
        }
        CustomLobbyService.LobbyChange change = customLobbyService.finishMatch(matchId);
        if (change == null || change.lobby() == null) {
            return;
        }
        customLobbyStatePublisher.send(
                change.recipients(),
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_STATE",
                        change.lobbyId(),
                        change.lobby(),
                        null,
                        null));
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
                        if (!scheduledSimulations.add(key)) {
                            return;
                        }
                    }
                    matchSimulationExecutor.execute(() -> {
                        try {
                                List<OutboundMatchmakingEvent> replayEvents = matchService.completeSimulation(event.matchId());
                                publish(replayEvents);
                                scheduleSelectionTimeouts(replayEvents);
                        } catch (RuntimeException exception) {
                            log.error(
                                    "Matchmaking authoritative replay simulation failed matchId={} round={}",
                                    event.matchId(),
                                    event.roundNumber(),
                                    exception);
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
