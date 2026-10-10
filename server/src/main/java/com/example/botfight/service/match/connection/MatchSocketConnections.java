package com.example.botfight.service.match.connection;

import com.example.botfight.DTO.party.PartyStateEventDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import com.example.botfight.service.websocket.WebSocketSessionDisconnectedEvent;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

import com.example.botfight.service.match.MatchScheduler;
import com.example.botfight.controller.MatchmakingSocketDestinations;
import org.springframework.stereotype.Service;

@Service
public class MatchSocketConnections {
    private final MatchmakingService matchmakingService;
    private final MatchService matchService;
    private final CurrentUserService currentUserService;
    private final PartyService partyService;
    private final PartyStatePublisher partyStatePublisher;
    private final SingleUserWebSocketSessionRegistry singleUserWebSocketSessionRegistry;
    private final MatchScheduler scheduler;
    private final Map<String, Map<String, String>> matchSubscriptionsBySession = new ConcurrentHashMap<>();

    public MatchSocketConnections(MatchmakingService matchmakingService, MatchService matchService,
            CurrentUserService currentUserService, PartyService partyService, PartyStatePublisher partyStatePublisher,
            SingleUserWebSocketSessionRegistry registry, MatchScheduler scheduler) {
        this.matchmakingService = matchmakingService;
        this.matchService = matchService;
        this.currentUserService = currentUserService;
        this.partyService = partyService;
        this.partyStatePublisher = partyStatePublisher;
        this.singleUserWebSocketSessionRegistry = registry;
        this.scheduler = scheduler;
    }

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
            if (principal == null || principal.getName() == null) return;
            partyService.registerSocket(principal.getName(), sessionId);

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

            return;
        }
        if (!MatchmakingSocketDestinations.isMatchSubscription(headers.getDestination())) {
            return;
        }
        String principalName = principal == null ? "" : principal.getName();
        if (principal instanceof Authentication authentication) {
            AppUser user = currentUserService.requireCurrentUser(authentication);
            matchService.registerSocketSession(user.getId(), sessionId);
        }
        matchSubscriptionsBySession
                .computeIfAbsent(sessionId, ignored -> new ConcurrentHashMap<>())
                .put(subscriptionId, principalName == null ? "" : principalName);
    }

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
            return;
        }
    }

    public void handleDisconnect(WebSocketSessionDisconnectedEvent event) {
        if (event == null || event.principalName() == null || event.principalName().isBlank()) return;
        String principalName = event.principalName();
        String sessionId = event.sessionId();
        matchSubscriptionsBySession.remove(sessionId);
        matchService.unregisterSocketSession(principalName, sessionId);
        PartyService.LeaveResult partyChange = new PartyService.LeaveResult(
                null,
                null,
                List.of());

            partyChange = partyService.removeDisconnected(
                    principalName,
                    sessionId);
            if (!partyChange.recipients().isEmpty()) {
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

        if (event.finalSession()
                && (!singleUserWebSocketSessionRegistry.hasActiveSessionForPrincipal(principalName))) {
            matchmakingService.markDisconnected(principalName, sessionId);
            scheduler.detectDisconnect(principalName, sessionId,
                    () -> !singleUserWebSocketSessionRegistry.hasActiveSessionForPrincipal(principalName)
                            && !hasMatchSubscription(sessionId));
        }
    }

    private boolean hasMatchSubscription(String socketSessionId) {
        Map<String, String> subscriptions = matchSubscriptionsBySession.get(socketSessionId);
        return subscriptions != null && !subscriptions.isEmpty();
    }

}
