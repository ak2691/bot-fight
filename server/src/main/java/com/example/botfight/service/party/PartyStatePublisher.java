package com.example.botfight.service.party;

import com.example.botfight.DTO.PartyStateEventDTO;
import java.util.List;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/** Publishes transient party membership and queue state to authenticated users. */
@Service
public class PartyStatePublisher {

    public static final String USER_DESTINATION = "/queue/party";

    private final SimpMessagingTemplate messagingTemplate;

    public PartyStatePublisher(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    public void send(
            List<PartyService.PartyRecipient> recipients,
            PartyStateEventDTO event) {
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
}
