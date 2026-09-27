package com.example.botfight.DTO.chatmoderation;

import com.example.botfight.domain.chatmoderation.ChatReportReason;

public record ChatReportRequestDTO(ChatReportReason reason, String note) {
}
