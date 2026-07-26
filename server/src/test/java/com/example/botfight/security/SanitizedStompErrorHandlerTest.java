package com.example.botfight.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;

class SanitizedStompErrorHandlerTest {

    @Test
    void errorFrameDoesNotExposeInternalExceptionDetails() {
        SanitizedStompErrorHandler handler = new SanitizedStompErrorHandler();

        Message<byte[]> message = handler.handleClientMessageProcessingError(
                null,
                new IllegalStateException("sensitive database implementation detail"));

        assertThat(message).isNotNull();
        String payload = new String(message.getPayload(), StandardCharsets.UTF_8);
        assertThat(payload).contains("WebSocket command rejected");
        assertThat(payload).doesNotContain("database", "IllegalStateException");
    }
}
