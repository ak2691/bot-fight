package com.example.botfight.controller;

import com.example.botfight.DTO.DuelInviteCreateRequestDTO;
import com.example.botfight.DTO.DuelInviteDTO;
import com.example.botfight.DTO.DuelInviteListDTO;
import com.example.botfight.DTO.NotificationEventDTO;
import com.example.botfight.service.invite.DuelInviteService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.notification.NotificationPublisher;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/duel-invites")
public class DuelInviteController {

    private final DuelInviteService duelInviteService;
    private final NotificationPublisher notificationPublisher;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;

    public DuelInviteController(
            DuelInviteService duelInviteService,
            NotificationPublisher notificationPublisher,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this.duelInviteService = duelInviteService;
        this.notificationPublisher = notificationPublisher;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
    }

    @PostMapping
    public DuelInviteDTO create(
            Authentication authentication,
            @RequestBody DuelInviteCreateRequestDTO request) {
        DuelInviteService.CreatedInvite created = duelInviteService.createInvite(
                authentication,
                request == null ? null : request.username());
        DuelInviteDTO invite = created.invite();
        notificationPublisher.sendIfVisible(
                created.recipientPrincipalName(),
                created.recipientUserId(),
                created.actorUserId(),
                new NotificationEventDTO(
                        "DUEL_INVITE_RECEIVED",
                        invite.inviteId(),
                        invite.inviteId(),
                        invite.inviterUsername(),
                        invite.inviterUsername() + " challenged you to a 1v1.",
                        invite.createdAt() == null ? Instant.now() : invite.createdAt(),
                        invite.expiresAt(),
                        null));
        return invite;
    }

    @GetMapping("/incoming")
    public DuelInviteListDTO incoming(Authentication authentication) {
        authenticatedGetRateLimiter.requireAllowed(
                "duel-invites:" + authentication.getName());
        return new DuelInviteListDTO(duelInviteService.incoming(authentication));
    }

    @PostMapping("/{inviteId}/decline")
    public DuelInviteDTO decline(
            Authentication authentication,
            @PathVariable UUID inviteId) {
        DuelInviteService.DeclinedInvite declined = duelInviteService.decline(authentication, inviteId);
        DuelInviteDTO invite = declined.invite();
        notificationPublisher.sendIfVisible(
                declined.recipientPrincipalName(),
                declined.recipientUserId(),
                declined.actorUserId(),
                new NotificationEventDTO(
                        "DUEL_INVITE_DECLINED",
                        invite.inviteId(),
                        invite.inviteId(),
                        declined.actorUsername(),
                        declined.actorUsername() + " declined your 1v1 invite.",
                        Instant.now(),
                        invite.expiresAt(),
                        null));
        return invite;
    }
}
