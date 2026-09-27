package com.example.botfight.DTO.chatmoderation;

import java.time.Instant;
import java.util.UUID;

public record ChatModerationAuditDTO(
        UUID auditId,
        UUID reportId,
        UUID actorUserId,
        String actorUsername,
        String action,
        Instant createdAt,
        String detail) {
}
