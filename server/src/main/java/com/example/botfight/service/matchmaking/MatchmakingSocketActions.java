package com.example.botfight.service.matchmaking;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.DTO.match.MatchAcceptanceDTO;
import com.example.botfight.DTO.match.MatchmakingJoinRequestDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.party.PartyStateEventDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.matchmaking.QueuePool;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;

import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.controller.MatchmakingSocketDestinations;
import org.springframework.stereotype.Service;

@Service
public class MatchmakingSocketActions {
    private final MatchmakingService matchmakingService;
    private final MatchService matchService;
    private final CurrentUserService currentUserService;
    private final PartyService partyService;
    private final PartyStatePublisher partyStatePublisher;
    private final MatchEventPublisher publisher;

    public MatchmakingSocketActions(MatchmakingService matchmakingService, MatchService matchService,
            CurrentUserService currentUserService, PartyService partyService, PartyStatePublisher partyStatePublisher,
            MatchEventPublisher publisher) {
        this.matchmakingService = matchmakingService;
        this.matchService = matchService;
        this.currentUserService = currentUserService;
        this.partyService = partyService;
        this.partyStatePublisher = partyStatePublisher;
        this.publisher = publisher;
    }

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
        PartyService.QueueContext queueContext = partyService.queueContext(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        headers.getSessionId());
        if (user.isGuest()
                && queueContext != null
                && (queueContext.partyId() != null || queueContext.entrants().size() != 1)) {
            throw new AuthException("Guests cannot join parties.");
        }
        if (!user.isGuest() && queueContext != null && queueContext.hasGuest()) {
            throw new AuthException("Guests cannot join parties.");
        }
        List<MatchEntrant> queueGroup = queueContext != null
                ? queueContext.entrants()
                : List.of(new MatchEntrant(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        headers.getSessionId()));
        List<OutboundMatchmakingEvent> events = matchmakingService.joinQueue(new QueueJoinRequest(
                user.getId(),
                user.getUsername(),
                principal.getName(),
                headers.getSessionId(),
                mode,
                queueGroup,
                queueContext == null ? null : queueContext.partyId(),
                user.isGuest() ? QueuePool.GUEST : QueuePool.REGISTERED));
        publisher.publish(events);
        publishPartyQueueState(queueContext, mode, events, "WAITING");
    }

    public void leaveQueue(Principal principal) {
        AppUser user = requireUser(principal);
        PartyService.QueueContext queueContext = partyService.queueContext(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        null);
        matchmakingService.leaveQueue(user.getId());
        publishPartyQueueState(queueContext, null, List.of(), "CANCELLED");
    }

    public void resumeMatch(Principal principal, SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> pendingEvents = matchmakingService.resumePendingMatch(
                user.getId(),
                headers.getSessionId());
        if (!pendingEvents.isEmpty()) {
            publisher.publish(pendingEvents);
                return;
        }
        List<OutboundMatchmakingEvent> queueEvents = matchmakingService.resumeQueuedPlayer(
                user.getId(),
                headers.getSessionId());
        if (!queueEvents.isEmpty()) {
            publisher.publish(queueEvents);
            return;
        }
        publisher.publish(
                matchService.resumeMatch(
                        user.getId(),
                        user.getUsername(),
                        principal.getName(),
                        headers.getSessionId()),
                MatchmakingSocketDestinations.MATCH);
    }

    public void resumeQueue(Principal principal, SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> pendingEvents = matchmakingService.resumePendingMatch(
                user.getId(),
                headers.getSessionId());
        if (!pendingEvents.isEmpty()) {
            publisher.publish(pendingEvents);
                return;
        }
        List<OutboundMatchmakingEvent> queueEvents = matchmakingService.resumeQueuedPlayer(
                user.getId(),
                headers.getSessionId());
        if (!queueEvents.isEmpty()) {
            publisher.publish(queueEvents);
            return;
        }
        sendQueueIdle(principal);
    }

    public void acceptMatch(
            @Payload MatchAcceptanceDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.acceptMatch(
                payload == null ? null : payload.matchId(),
                user.getId(),
                headers.getSessionId());
        publisher.publish(events);
    }

    public void cancelMatch(
            @Payload MatchAcceptanceDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        List<OutboundMatchmakingEvent> events = matchmakingService.cancelPendingMatch(
                payload == null ? null : payload.matchId(),
                user.getId(),
                headers.getSessionId());
        publisher.publish(events);
    }

    private void sendQueueIdle(Principal principal) {
        if (principal == null) {
            return;
        }
        publisher.sendToUser(
                principal.getName(),
                MatchmakingSocketDestinations.MATCHMAKING,
                MatchmakingEventDTO.builder()
                        .type(MatchEventType.QUEUE_IDLE)
                        .status("IDLE")
                        .players(List.of())
                        .serverNow(Instant.now())
                        .roundBrains(List.of())
                        .abilityOffers(List.of()).build());
    }

    private void publishPartyQueueState(
            PartyService.QueueContext queueContext,
            MatchMode mode,
            List<OutboundMatchmakingEvent> events,
            String fallbackStatus) {
        if (queueContext == null
                || queueContext.partyId() == null) {
            return;
        }
        OutboundMatchmakingEvent found = events == null
                ? null
                : events.stream()
                        .filter(event -> MatchEventType.MATCH_FOUND.equals(event.event().type()))
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

    private AppUser requireUser(Principal principal) {
        if (!(principal instanceof Authentication authentication)) {
            throw new AuthException("authentication is required");
        }
        return currentUserService.requireCurrentUser(authentication);
    }

}
