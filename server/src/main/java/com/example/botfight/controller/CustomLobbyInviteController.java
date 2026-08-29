package com.example.botfight.controller;

import com.example.botfight.DTO.CustomLobbyDTO;
import com.example.botfight.DTO.CustomLobbyInviteDTO;
import com.example.botfight.DTO.CustomLobbyInviteListDTO;
import com.example.botfight.DTO.CustomLobbyStateEventDTO;
import com.example.botfight.DTO.NotificationEventDTO;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.notification.NotificationPublisher;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/custom-lobby-invites")
public class CustomLobbyInviteController {

    private final CustomLobbyService customLobbyService;
    private final CustomLobbyStatePublisher customLobbyStatePublisher;
    private final NotificationPublisher notificationPublisher;

    public CustomLobbyInviteController(
            CustomLobbyService customLobbyService,
            CustomLobbyStatePublisher customLobbyStatePublisher,
            NotificationPublisher notificationPublisher) {
        this.customLobbyService = customLobbyService;
        this.customLobbyStatePublisher = customLobbyStatePublisher;
        this.notificationPublisher = notificationPublisher;
    }

    @GetMapping("/incoming")
    public CustomLobbyInviteListDTO incoming(Authentication authentication) {
        return new CustomLobbyInviteListDTO(customLobbyService.incoming(authentication));
    }

    @PostMapping("/{inviteId}/accept")
    public CustomLobbyDTO accept(
            Authentication authentication,
            @PathVariable UUID inviteId) {
        CustomLobbyService.AcceptedInvite accepted = customLobbyService.accept(authentication, inviteId);
        customLobbyStatePublisher.send(
                accepted.recipients(),
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_STATE",
                        accepted.lobby().lobbyId(),
                        accepted.lobby(),
                        null,
                        null));
        return accepted.lobby();
    }

    @PostMapping("/{inviteId}/decline")
    public CustomLobbyInviteDTO decline(
            Authentication authentication,
            @PathVariable UUID inviteId) {
        CustomLobbyService.DeclinedInvite declined = customLobbyService.decline(authentication, inviteId);
        notificationPublisher.sendIfVisible(
                declined.recipientPrincipalName(),
                declined.recipientUserId(),
                declined.actorUserId(),
                new NotificationEventDTO(
                        "CUSTOM_LOBBY_INVITE_DECLINED",
                        declined.invite().inviteId(),
                        declined.invite().inviteId(),
                        declined.actorUsername(),
                        declined.actorUsername() + " declined your Custom Lobby invite.",
                        Instant.now(),
                        declined.invite().expiresAt(),
                        null,
                        null,
                        declined.invite().lobbyId()));
        return declined.invite();
    }
}
