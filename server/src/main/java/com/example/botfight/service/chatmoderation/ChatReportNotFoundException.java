package com.example.botfight.service.chatmoderation;

public class ChatReportNotFoundException extends RuntimeException {
    public ChatReportNotFoundException() {
        super("Chat report was not found.");
    }
}
