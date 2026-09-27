package com.example.botfight.DTO.chatmoderation;

import com.example.botfight.domain.chatmoderation.ChatReportStatus;

public record ChatReportResolutionRequestDTO(ChatReportStatus status, String note) {
}
