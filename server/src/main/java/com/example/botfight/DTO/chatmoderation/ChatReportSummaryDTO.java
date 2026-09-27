package com.example.botfight.DTO.chatmoderation;

import com.example.botfight.domain.chatmoderation.ChatContextType;
import com.example.botfight.domain.chatmoderation.ChatReportReason;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import java.time.Instant;
import java.util.UUID;

public record ChatReportSummaryDTO(
        UUID reportId,
        UUID messageId,
        UUID reporterUserId,
        String reporterUsername,
        String senderUsername,
        ChatContextType contextType,
        UUID contextId,
        ChatReportReason reason,
        ChatReportStatus status,
        Instant createdAt,
        Instant updatedAt,
        Instant resolvedAt) {
}
