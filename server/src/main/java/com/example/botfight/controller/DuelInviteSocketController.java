package com.example.botfight.controller;

import com.example.botfight.DTO.DuelInviteCommandDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.NotificationEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.invite.DuelInviteService;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.notification.NotificationPublisher;
import java.time.Instant;
import java.security.Principal;
import java.util.List;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Controller;

@Controller
public class DuelInviteSocketController {

    private static final long DEADLINE_CALLBACK_BUFFER_MILLIS = 250L;

    private final DuelInviteService duelInviteService;
    private final CurrentUserService currentUserService;
    private final MatchService matchService;
    private final SimpMessagingTemplate messagingTemplate;
    private final NotificationPublisher notificationPublisher;
    private final TaskScheduler lifecycleScheduler;

    public DuelInviteSocketController(
            DuelInviteService duelInviteService,
            CurrentUserService currentUserService,
            MatchService matchService,
            SimpMessagingTemplate messagingTemplate,
            NotificationPublisher notificationPublisher,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler lifecycleScheduler) {
        this.duelInviteService = duelInviteService;
        this.currentUserService = currentUserService;
        this.matchService = matchService;
        this.messagingTemplate = messagingTemplate;
        this.notificationPublisher = notificationPublisher;
        this.lifecycleScheduler = lifecycleScheduler;
    }

    @MessageMapping("/matchmaking.acceptInvite")
    public void acceptInvite(
            @Payload DuelInviteCommandDTO payload,
            Principal principal,
            SimpMessageHeaderAccessor headers) {
        AppUser user = requireUser(principal);
        DuelInviteService.AcceptedInvite accepted = duelInviteService.acceptAndStartMatch(
                payload == null ? null : payload.inviteId(),
                user.getId(),
                principal.getName(),
                headers.getSessionId());
        publishMatchEvents(accepted.events());
        Instant now = Instant.now();
        notificationPublisher.sendIfVisible(
                accepted.inviteePrincipalName(),
                accepted.inviteeUserId(),
                accepted.inviterUserId(),
                new NotificationEventDTO(
                        "DUEL_INVITE_MATCH_READY",
                        accepted.inviteId(),
                        accepted.inviteId(),
                        accepted.inviterUsername(),
                        "The 1v1 is ready.",
                        now,
                        null,
                        accepted.matchId()));
        notificationPublisher.sendIfVisible(
                accepted.inviterPrincipalName(),
                accepted.inviterUserId(),
                accepted.inviteeUserId(),
                new NotificationEventDTO(
                        "DUEL_INVITE_ACCEPTED",
                        accepted.inviteId(),
                        accepted.inviteId(),
                        accepted.inviteeUsername(),
                        accepted.inviteeUsername() + " accepted your 1v1 invite.",
                        now,
                        null,
                        accepted.matchId()));
    }

    @MessageExceptionHandler(AuthException.class)
    public void handleInviteError(AuthException exception, Principal principal) {
        if (principal == null) return;
        notificationPublisher.send(
                principal.getName(),
                new NotificationEventDTO(
                        "DUEL_INVITE_ERROR",
                        null,
                        null,
                        null,
                        exception.getMessage(),
                        Instant.now(),
                        null,
                        null));
    }

    @MessageExceptionHandler(Exception.class)
    public void handleUnexpectedInviteError(Exception exception, Principal principal) {
        if (principal == null) return;
        notificationPublisher.send(
                principal.getName(),
                new NotificationEventDTO(
                        "DUEL_INVITE_ERROR",
                        null,
                        null,
                        null,
                        "The duel invite could not be processed.",
                        Instant.now(),
                        null,
                        null));
    }

    private void publishMatchEvents(List<OutboundMatchmakingEvent> events) {
        events.stream()
                .filter(matchService::isCurrentEvent)
                .forEach(event -> {
                    MatchmakingEventDTO payload = event.event().withServerNow(Instant.now());
                    messagingTemplate.convertAndSendToUser(
                            event.principalName(),
                            MatchmakingSocketDestinations.forMatchmakingEvent(payload),
                            payload);
                    MatchmakingEventDTO matchEvent = event.event();
                    if ("MATCH_STARTED".equals(matchEvent.type())
                            && "LOADOUT_SELECT".equals(matchEvent.status())
                            && matchEvent.matchId() != null
                            && matchEvent.loadoutSelectionEndsAt() != null) {
                        lifecycleScheduler.schedule(
                                () -> publishMatchEvents(matchService.resolveLoadoutSelectionTimeout(matchEvent.matchId())),
                                matchEvent.loadoutSelectionEndsAt().plusMillis(DEADLINE_CALLBACK_BUFFER_MILLIS));
                    }
                });
    }

    private AppUser requireUser(Principal principal) {
        if (!(principal instanceof org.springframework.security.core.Authentication authentication)) {
            throw new AuthException("authentication is required");
        }
        return currentUserService.requireCurrentUser(authentication);
    }
}
