package com.example.botfight.controller;

import com.example.botfight.DTO.customlobby.CustomLobbyDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyChatEventDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyChatRequestDTO;
import com.example.botfight.DTO.customlobby.CustomLobbyStateEventDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.customlobby.CustomLobbyChatService;
import com.example.botfight.service.customlobby.CustomLobbyChatSubmission;
import com.example.botfight.service.customlobby.CustomLobbyChatSubmissionStatus;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import java.security.Principal;
import java.util.List;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.security.core.Authentication;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;

/** Binds the live custom-lobby snapshot to its own authenticated user queue. */
@Controller
public class CustomLobbySocketController {

    private final CustomLobbyService customLobbyService;
    private final CustomLobbyStatePublisher customLobbyStatePublisher;
    private final CustomLobbyChatService customLobbyChatService;
    private final CurrentUserService currentUserService;

    public CustomLobbySocketController(
            CustomLobbyService customLobbyService,
            CustomLobbyStatePublisher customLobbyStatePublisher,
            CustomLobbyChatService customLobbyChatService,
            CurrentUserService currentUserService) {
        this.customLobbyService = customLobbyService;
        this.customLobbyStatePublisher = customLobbyStatePublisher;
        this.customLobbyChatService = customLobbyChatService;
        this.currentUserService = currentUserService;
    }

    @MessageMapping("/custom-lobby.chat")
    public void chat(@Payload CustomLobbyChatRequestDTO payload, Principal principal) {
        AppUser user = requireUser(principal);
        CustomLobbyChatSubmission submission = customLobbyChatService.submit(
                user.getId(),
                principal.getName(),
                payload == null ? null : payload.lobbyId(),
                payload == null ? null : payload.message());
        if (submission.status() == CustomLobbyChatSubmissionStatus.ACCEPTED) {
            customLobbyStatePublisher.sendChat(
                    submission.recipientPrincipalNames(),
                    new CustomLobbyChatEventDTO(
                            "CUSTOM_LOBBY_CHAT_MESSAGE",
                            submission.messageId(),
                            submission.lobbyId(),
                            submission.username(),
                            submission.message(),
                            submission.sentAt()));
            return;
        }
        String type = submission.status() == CustomLobbyChatSubmissionStatus.RATE_LIMITED
                ? "CUSTOM_LOBBY_CHAT_RATE_LIMITED"
                : "CUSTOM_LOBBY_CHAT_REJECTED";
        customLobbyStatePublisher.sendChat(
                List.of(principal.getName()),
                new CustomLobbyChatEventDTO(
                        type,
                        null,
                        submission.lobbyId(),
                        null,
                        submission.message(),
                        null));
    }

    @EventListener
    public void handleSubscribe(SessionSubscribeEvent event) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.wrap(event.getMessage());
        if (!MatchmakingSocketDestinations.isCustomLobbySubscription(headers.getDestination())) {
            return;
        }
        String sessionId = headers.getSessionId();
        Principal principal = event.getUser() == null ? headers.getUser() : event.getUser();
        if (sessionId == null || principal == null || principal.getName() == null) return;

        customLobbyService.registerSocket(principal.getName(), sessionId);
        CustomLobbyDTO lobby = customLobbyService.currentForPrincipal(principal.getName());
        List<CustomLobbyService.LobbyRecipient> recipients = lobby == null
                ? List.of(new CustomLobbyService.LobbyRecipient(principal.getName(), null))
                : customLobbyService.recipientsForLobby(lobby.lobbyId());
        customLobbyStatePublisher.send(
                recipients,
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_STATE",
                        lobby == null ? null : lobby.lobbyId(),
                        lobby,
                        null,
                        null));
    }

    @EventListener
    public void handleDisconnect(SessionDisconnectEvent event) {
        Principal principal = event.getUser();
        if (principal == null) return;
        CustomLobbyService.LobbyChange change = customLobbyService.removeDisconnected(
                principal.getName(),
                event.getSessionId());
        if (change.recipients().isEmpty()) return;
        customLobbyStatePublisher.send(
                change.recipients(),
                new CustomLobbyStateEventDTO(
                        "CUSTOM_LOBBY_STATE",
                        change.lobbyId(),
                        change.lobby(),
                        null,
                        null));
    }

    private AppUser requireUser(Principal principal) {
        if (!(principal instanceof Authentication authentication)) {
            throw new AuthException("authentication is required");
        }
        return currentUserService.requireCurrentUser(authentication);
    }
}
