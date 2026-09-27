package com.example.botfight.service.chatmoderation;

import com.example.botfight.domain.chatmoderation.ChatContextType;
import java.time.Instant;
import java.util.Collection;
import java.util.UUID;

@FunctionalInterface
public interface ChatEvidenceRecorder {

    void capture(
            UUID messageId,
            ChatContextType contextType,
            UUID contextId,
            UUID senderUserId,
            String senderUsername,
            Instant sentAt,
            String normalizedText,
            Collection<UUID> recipientUserIds);

    static ChatEvidenceRecorder noOp() {
        return (messageId, contextType, contextId, senderUserId, senderUsername, sentAt, text, recipients) -> { };
    }
}
