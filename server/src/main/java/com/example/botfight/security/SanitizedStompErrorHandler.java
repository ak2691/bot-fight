package com.example.botfight.security;

import java.nio.charset.StandardCharsets;
import org.springframework.messaging.Message;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.web.socket.messaging.StompSubProtocolErrorHandler;

public class SanitizedStompErrorHandler extends StompSubProtocolErrorHandler {

    private static final byte[] GENERIC_ERROR =
            "{\"message\":\"WebSocket command rejected\"}".getBytes(StandardCharsets.UTF_8);

    @Override
    public Message<byte[]> handleClientMessageProcessingError(Message<byte[]> clientMessage, Throwable exception) {
        return genericErrorMessage();
    }

    @Override
    public Message<byte[]> handleErrorMessageToClient(Message<byte[]> errorMessage) {
        return genericErrorMessage();
    }

    private Message<byte[]> genericErrorMessage() {
        StompHeaderAccessor headers = StompHeaderAccessor.create(StompCommand.ERROR);
        headers.setMessage("WebSocket command rejected");
        headers.setContentType(org.springframework.util.MimeTypeUtils.APPLICATION_JSON);
        headers.setContentLength(GENERIC_ERROR.length);
        headers.setLeaveMutable(true);
        return MessageBuilder.createMessage(GENERIC_ERROR, headers.getMessageHeaders());
    }
}
