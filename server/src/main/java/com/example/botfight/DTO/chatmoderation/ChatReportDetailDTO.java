package com.example.botfight.DTO.chatmoderation;

import com.example.botfight.domain.chatmoderation.ChatContextType;
import com.example.botfight.domain.chatmoderation.ChatReportReason;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record ChatReportDetailDTO(
        UUID reportId,
        UUID messageId,
        UUID reporterUserId,
        String reporterUsername,
        ChatReportReason reason,
        String note,
        ChatReportStatus status,
        Instant createdAt,
        Instant updatedAt,
        Instant resolvedAt,
        UUID resolverUserId,
        String resolverUsername,
        String resolutionNote,
        ChatContextType contextType,
        UUID contextId,
        UUID senderUserId,
        String senderUsername,
        Instant messageSentAt,
        String message,
        Set<UUID> recipientUserIds) {
}
