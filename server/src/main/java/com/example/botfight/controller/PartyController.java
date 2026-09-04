package com.example.botfight.controller;

import com.example.botfight.DTO.notification.NotificationEventDTO;
import com.example.botfight.DTO.party.PartyDTO;
import com.example.botfight.DTO.party.PartyInviteCreateRequestDTO;
import com.example.botfight.DTO.party.PartyStateEventDTO;
import com.example.botfight.service.notification.NotificationPublisher;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/parties")
public class PartyController {

    private final PartyService partyService;
    private final NotificationPublisher notificationPublisher;
    private final PartyStatePublisher partyStatePublisher;

    public PartyController(
            PartyService partyService,
            NotificationPublisher notificationPublisher,
            PartyStatePublisher partyStatePublisher) {
        this.partyService = partyService;
        this.notificationPublisher = notificationPublisher;
        this.partyStatePublisher = partyStatePublisher;
    }

    @PostMapping
    public PartyDTO create(Authentication authentication) {
        PartyDTO party = partyService.create(authentication);
        if (party != null) {
            partyStatePublisher.send(
                    partyService.recipientsForParty(party.partyId()),
                    new PartyStateEventDTO(
                            "PARTY_STATE_UPDATED",
                            party.partyId(),
                            party,
                            "IDLE",
                            null,
                            null,
                            Instant.now()));
        }
        return party;
    }

    @PostMapping("/{partyId}/invites")
    public com.example.botfight.DTO.party.PartyInviteDTO invite(
            Authentication authentication,
            @PathVariable UUID partyId,
            @RequestBody PartyInviteCreateRequestDTO request) {
        PartyService.CreatedInvite created = partyService.invite(
                authentication,
                partyId,
                request == null ? null : request.username());
        notificationPublisher.sendIfVisible(
                created.recipientPrincipalName(),
                created.recipientUserId(),
                created.actorUserId(),
                new NotificationEventDTO(
                        "PARTY_INVITE_RECEIVED",
                        created.invite().inviteId(),
                        created.invite().inviteId(),
                        created.actorUsername(),
                        created.actorUsername() + " invited you to a party.",
                        created.invite().createdAt() == null ? Instant.now() : created.invite().createdAt(),
                        created.invite().expiresAt(),
                        null,
                        created.invite().partyId()));
        return created.invite();
    }

    @PostMapping("/{partyId}/leave")
    public PartyDTO leave(
            Authentication authentication,
            @PathVariable UUID partyId) {
        PartyService.LeaveResult result = partyService.leave(authentication, partyId);
        publishMembershipChange(result);
        return result.party();
    }

    @PostMapping("/{partyId}/members/{userId}/kick")
    public PartyDTO kick(
            Authentication authentication,
            @PathVariable UUID partyId,
            @PathVariable UUID userId) {
        PartyService.LeaveResult result = partyService.kick(authentication, partyId, userId);
        publishMembershipChange(result);
        return result.party();
    }

    private void publishMembershipChange(PartyService.LeaveResult result) {
        PartyStateEventDTO remainingMembersEvent = new PartyStateEventDTO(
                "PARTY_STATE_UPDATED",
                result.partyId(),
                result.party(),
                "IDLE",
                null,
                null,
                Instant.now());
        partyStatePublisher.send(result.recipients(), remainingMembersEvent);

        if (result.removedRecipient() != null) {
            partyStatePublisher.send(
                    java.util.List.of(result.removedRecipient()),
                    new PartyStateEventDTO(
                            "PARTY_STATE_UPDATED",
                            result.partyId(),
                            null,
                            "IDLE",
                            null,
                            null,
                            Instant.now()));
        }
    }
}
