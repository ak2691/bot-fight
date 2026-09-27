package com.example.botfight.service.chatmoderation;

public class ChatReportValidationException extends RuntimeException {
    public ChatReportValidationException(String message) {
        super(message);
    }
}
