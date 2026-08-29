package com.example.botfight.service.customlobby;

import com.example.botfight.DTO.CustomLobbyStateEventDTO;
import com.example.botfight.DTO.CustomLobbyChatEventDTO;
import java.util.List;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/** Publishes transient custom-lobby state only to its current members. */
@Service
public class CustomLobbyStatePublisher {

    public static final String USER_DESTINATION = "/queue/custom-lobby";

    private final SimpMessagingTemplate messagingTemplate;

    public CustomLobbyStatePublisher(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    public void send(
            List<CustomLobbyService.LobbyRecipient> recipients,
            CustomLobbyStateEventDTO event) {
        if (event == null || recipients == null) return;
        recipients.stream()
                .filter(recipient -> recipient != null
                        && recipient.principalName() != null
                        && !recipient.principalName().isBlank())
                .forEach(recipient -> messagingTemplate.convertAndSendToUser(
                        recipient.principalName(),
                        USER_DESTINATION,
                        event));
    }

    public void sendChat(List<String> recipientPrincipalNames, CustomLobbyChatEventDTO event) {
        if (event == null || recipientPrincipalNames == null) return;
        recipientPrincipalNames.stream()
                .filter(principalName -> principalName != null && !principalName.isBlank())
                .forEach(principalName -> messagingTemplate.convertAndSendToUser(
                        principalName,
                        USER_DESTINATION,
                        event));
    }
}
