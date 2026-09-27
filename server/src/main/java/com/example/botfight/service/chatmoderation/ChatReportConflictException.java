package com.example.botfight.service.chatmoderation;

public class ChatReportConflictException extends RuntimeException {
    public ChatReportConflictException(String message) {
        super(message);
    }
}
