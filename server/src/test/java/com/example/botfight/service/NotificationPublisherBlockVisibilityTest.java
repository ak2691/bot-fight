package com.example.botfight.service;

import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.example.botfight.DTO.notification.NotificationEventDTO;
import com.example.botfight.service.notification.NotificationPublisher;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class NotificationPublisherBlockVisibilityTest {

    @Test
    void blockedActorNotificationIsNotDeliveredToTheBlocker() {
        SimpMessagingTemplate template = Mockito.mock(SimpMessagingTemplate.class);
        UUID blockerId = UUID.randomUUID();
        UUID blockedId = UUID.randomUUID();
        NotificationPublisher publisher = new NotificationPublisher(
                template,
                (viewerId, actorId) -> blockerId.equals(viewerId) && blockedId.equals(actorId));

        publisher.sendIfVisible(
                "alice@example.test",
                blockerId,
                blockedId,
                event());

        verify(template, never()).convertAndSendToUser(
                ArgumentMatchers.anyString(),
                ArgumentMatchers.anyString(),
                ArgumentMatchers.any());
    }

    @Test
    void unrelatedNotificationStillUsesTheNormalUserDestination() {
        SimpMessagingTemplate template = Mockito.mock(SimpMessagingTemplate.class);
        NotificationPublisher publisher = new NotificationPublisher(
                template,
                (viewerId, actorId) -> false);

        publisher.sendIfVisible("alice@example.test", UUID.randomUUID(), UUID.randomUUID(), event());

        verify(template).convertAndSendToUser(
                ArgumentMatchers.eq("alice@example.test"),
                ArgumentMatchers.eq("/queue/notifications"),
                ArgumentMatchers.any(NotificationEventDTO.class));
    }

    private static NotificationEventDTO event() {
        return new NotificationEventDTO("TEST", UUID.randomUUID(), null, "bob", "hello", Instant.parse("2026-08-22T12:00:00Z"), null, null, null, null);
    }
}
