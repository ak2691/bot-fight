package com.example.botfight.controller;

import com.example.botfight.DTO.notification.NotificationEventDTO;
import com.example.botfight.DTO.party.PartyDTO;
import com.example.botfight.DTO.party.PartyInviteDTO;
import com.example.botfight.DTO.party.PartyInviteListDTO;
import com.example.botfight.DTO.party.PartyStateEventDTO;
import com.example.botfight.service.notification.NotificationPublisher;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/party-invites")
public class PartyInviteController {

    private final PartyService partyService;
    private final NotificationPublisher notificationPublisher;
    private final PartyStatePublisher partyStatePublisher;

    public PartyInviteController(
            PartyService partyService,
            NotificationPublisher notificationPublisher,
            PartyStatePublisher partyStatePublisher) {
        this.partyService = partyService;
        this.notificationPublisher = notificationPublisher;
        this.partyStatePublisher = partyStatePublisher;
    }

    @GetMapping("/incoming")
    public PartyInviteListDTO incoming(Authentication authentication) {
        return new PartyInviteListDTO(partyService.incoming(authentication));
    }

    @PostMapping("/{inviteId}/accept")
    public PartyDTO accept(
            Authentication authentication,
            @PathVariable UUID inviteId) {
        PartyService.AcceptedInvite accepted = partyService.accept(authentication, inviteId);
        for (PartyService.PartyRecipient recipient : accepted.recipients()) {
            notificationPublisher.sendIfVisible(
                    recipient.principalName(),
                    recipient.userId(),
                    accepted.actorUserId(),
                    new NotificationEventDTO(
                            "PARTY_MEMBER_JOINED",
                            accepted.invite().inviteId(),
                            accepted.invite().inviteId(),
                            accepted.actorUsername(),
                            accepted.actorUsername() + " joined your party.",
                            Instant.now(),
                            null,
                            null,
                            accepted.invite().partyId()));
        }
        partyStatePublisher.send(
                accepted.partyRecipients(),
                new PartyStateEventDTO(
                        "PARTY_STATE_UPDATED",
                        accepted.invite().partyId(),
                        accepted.party(),
                        "IDLE",
                        null,
                        null,
                        Instant.now()));
        return accepted.party();
    }

    @PostMapping("/{inviteId}/decline")
    public PartyInviteDTO decline(
            Authentication authentication,
            @PathVariable UUID inviteId) {
        PartyService.DeclinedInvite declined = partyService.decline(authentication, inviteId);
        notificationPublisher.sendIfVisible(
                declined.recipientPrincipalName(),
                declined.recipientUserId(),
                declined.actorUserId(),
                new NotificationEventDTO(
                        "PARTY_INVITE_DECLINED",
                        declined.invite().inviteId(),
                        declined.invite().inviteId(),
                        declined.actorUsername(),
                        declined.actorUsername() + " declined your party invite.",
                        Instant.now(),
                        null,
                        null,
                        declined.invite().partyId()));
        return declined.invite();
    }
}
