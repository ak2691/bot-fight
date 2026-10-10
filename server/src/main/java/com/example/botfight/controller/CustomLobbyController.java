package com.example.botfight.controller;

import com.example.botfight.DTO.customlobby.CustomLobbyDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyInviteCreateRequestDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyClockRequestDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyStartDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyStateEventDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyTeamRequestDTO;
import com.example.botfight.DTO.party.PartyStateEventDTO;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.notification.NotificationPublisher;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/custom-lobbies")
public class CustomLobbyController {


    private final CustomLobbyService customLobbyService;
    private final CustomLobbyStatePublisher customLobbyStatePublisher;
    private final NotificationPublisher notificationPublisher;
    private final PartyStatePublisher partyStatePublisher;
    private final com.example.botfight.service.match.event.MatchEventPublisher matchEventPublisher;

    public CustomLobbyController(
            CustomLobbyService customLobbyService,
            CustomLobbyStatePublisher customLobbyStatePublisher,
            NotificationPublisher notificationPublisher,
            PartyStatePublisher partyStatePublisher,
            com.example.botfight.service.match.event.MatchEventPublisher matchEventPublisher) {
        this.customLobbyService = customLobbyService;
        this.customLobbyStatePublisher = customLobbyStatePublisher;
        this.notificationPublisher = notificationPublisher;
        this.partyStatePublisher = partyStatePublisher;
        this.matchEventPublisher = matchEventPublisher;
    }

    @PostMapping
    public CustomLobbyDTO create(Authentication authentication) {
        return customLobbyService.create(authentication);
    }

    @GetMapping("/current")
    public ResponseEntity<CustomLobbyDTO> current(Authentication authentication) {
        return Optional.ofNullable(customLobbyService.currentForPrincipal(authentication.getName()))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{lobbyId}/invites")
    public com.example.botfight.DTO.customlobby.CustomLobbyInviteDTO invite(
            Authentication authentication,
            @PathVariable UUID lobbyId,
            @RequestBody CustomLobbyInviteCreateRequestDTO request) {
        CustomLobbyService.CreatedInvite created = customLobbyService.invite(
                authentication,
                lobbyId,
                request == null ? null : request.username());
        com.example.botfight.DTO.customlobby.CustomLobbyInviteDTO invite = created.invite();
        notificationPublisher.sendIfVisible(
                created.recipientPrincipalName(),
                created.recipientUserId(),
                created.actorUserId(),
                new com.example.botfight.DTO.notification.NotificationEventDTO(
                        "CUSTOM_LOBBY_INVITE_RECEIVED",
                        invite.inviteId(),
                        invite.inviteId(),
                        created.actorUsername(),
                        created.actorUsername() + " invited you to a Custom Lobby.",
                        invite.createdAt(),
                        invite.expiresAt(),
                        null,
                        null,
                        invite.lobbyId()));
        return invite;
    }

    @PostMapping("/{lobbyId}/team")
    public CustomLobbyDTO setTeam(
            Authentication authentication,
            @PathVariable UUID lobbyId,
            @RequestBody CustomLobbyTeamRequestDTO request) {
        CustomLobbyService.LobbyChange change = customLobbyService.setTeam(
                authentication,
                lobbyId,
                request == null ? null : request.teamNumber());
        publishLobbyChange(change);
        return change.lobby();
    }

    @PostMapping("/{lobbyId}/settings")
    public CustomLobbyDTO updateSettings(
            Authentication authentication,
            @PathVariable UUID lobbyId,
            @RequestBody CustomLobbyClockRequestDTO request) {
        CustomLobbyService.LobbyChange change = customLobbyService.updateClock(
                authentication,
                lobbyId,
                request == null ? null : request.baseClockSeconds(),
                request == null ? null : request.incrementSeconds());
        publishLobbyChange(change);
        return change.lobby();
    }

    @PostMapping("/{lobbyId}/leave")
    public CustomLobbyDTO leave(
            Authentication authentication,
            @PathVariable UUID lobbyId) {
        CustomLobbyService.LobbyChange change = customLobbyService.leave(authentication, lobbyId);
        publishLobbyChange(change);
        return change.lobby();
    }

    @PostMapping("/{lobbyId}/members/{userId}/kick")
    public CustomLobbyDTO kick(
            Authentication authentication,
            @PathVariable UUID lobbyId,
            @PathVariable UUID userId) {
        CustomLobbyService.LobbyChange change = customLobbyService.kick(authentication, lobbyId, userId);
        publishLobbyChange(change);
        return change.lobby();
    }

    @PostMapping("/{lobbyId}/start")
    public CustomLobbyStartDTO start(
            Authentication authentication,
            @PathVariable UUID lobbyId) {
        CustomLobbyService.StartedMatch started = customLobbyService.start(authentication, lobbyId);
        publishMatchEvents(started.events());
        customLobbyStatePublisher.send(
                started.lobbyRecipients(),
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_MATCH_STARTED",
                        started.lobbyId(),
                        started.lobby(),
                        started.matchId(),
                        "The custom match is starting."));
        publishPartyChanges(started.partyChanges());
        return new CustomLobbyStartDTO(started.matchId());
    }

    private void publishLobbyChange(CustomLobbyService.LobbyChange change) {
        if (change == null) return;
        customLobbyStatePublisher.send(
                change.recipients(),
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_STATE",
                        change.lobbyId(),
                        change.lobby(),
                        null,
                        null));
        customLobbyStatePublisher.send(
                change.detachedRecipients(),
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_STATE",
                        change.lobbyId(),
                        null,
                        null,
                        "You are no longer in this custom lobby."));
    }

    private void publishPartyChanges(List<PartyService.CustomMatchPartyChange> changes) {
        if (changes == null) return;
        changes.forEach(change -> {
            partyStatePublisher.send(
                    change.recipients(),
                    new PartyStateEventDTO(
                            "PARTY_STATE_UPDATED",
                            change.partyId(),
                            change.party(),
                            "IDLE",
                            null,
                            null,
                            Instant.now()));
            partyStatePublisher.send(
                    change.detachedRecipients(),
                    new PartyStateEventDTO(
                            "PARTY_STATE_UPDATED",
                            change.partyId(),
                            null,
                            "IDLE",
                            null,
                            null,
                            Instant.now()));
        });
    }

    private void publishMatchEvents(List<OutboundMatchmakingEvent> events) {
        matchEventPublisher.publish(events);
    }
}
