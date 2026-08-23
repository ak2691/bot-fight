package com.example.botfight.service.notification;

import com.example.botfight.DTO.NotificationEventDTO;
import com.example.botfight.service.block.BlockLookup;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/** Sends transient notifications; durable state remains owned by its feature service. */
@Service
public class NotificationPublisher {

    public static final String USER_DESTINATION = "/queue/notifications";

    private final SimpMessagingTemplate messagingTemplate;
    private final BlockLookup blockLookup;

    @Autowired
    public NotificationPublisher(
            SimpMessagingTemplate messagingTemplate,
            BlockLookup blockLookup) {
        this.messagingTemplate = messagingTemplate;
        this.blockLookup = blockLookup;
    }

    public NotificationPublisher(SimpMessagingTemplate messagingTemplate) {
        this(messagingTemplate, BlockLookup.none());
    }

    public void send(String principalName, NotificationEventDTO event) {
        if (principalName == null || principalName.isBlank() || event == null) {
            return;
        }
        messagingTemplate.convertAndSendToUser(principalName, USER_DESTINATION, event);
    }

    public void sendIfVisible(
            String principalName,
            UUID recipientUserId,
            UUID actorUserId,
            NotificationEventDTO event) {
        if (recipientUserId != null
                && actorUserId != null
                && blockLookup.isBlocked(recipientUserId, actorUserId)) {
            return;
        }
        send(principalName, event);
    }
}
