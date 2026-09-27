package com.example.botfight.DTO.chatmoderation;

public record ChatReportAcknowledgementDTO(boolean acknowledged) {
    public static ChatReportAcknowledgementDTO generic() {
        return new ChatReportAcknowledgementDTO(true);
    }
}
