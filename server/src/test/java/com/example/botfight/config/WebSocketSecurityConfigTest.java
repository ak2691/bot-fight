package com.example.botfight.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.messaging.access.intercept.MessageMatcherDelegatingAuthorizationManager;

class WebSocketSecurityConfigTest {

    @Test
    void authenticatedUsersMayResumeAnActiveMatchSocket() {
        MessageMatcherDelegatingAuthorizationManager.Builder messages =
                MessageMatcherDelegatingAuthorizationManager.builder();
        AuthorizationManager<Message<?>> manager =
                new WebSocketSecurityConfig().messageAuthorizationManager(messages);
        Message<byte[]> resumeMessage = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/matchmaking.resume")
                .build();
        Authentication authentication = new TestingAuthenticationToken("pilot", "password", "ROLE_USER");
        Supplier<Authentication> authenticationSupplier = () -> authentication;

        assertThat(manager.authorize(authenticationSupplier, resumeMessage).isGranted()).isTrue();
    }

    @Test
    void authenticatedUsersMaySendAndSubscribeToMatchChat() {
        MessageMatcherDelegatingAuthorizationManager.Builder messages =
                MessageMatcherDelegatingAuthorizationManager.builder();
        AuthorizationManager<Message<?>> manager =
                new WebSocketSecurityConfig().messageAuthorizationManager(messages);
        Authentication authentication = new TestingAuthenticationToken("pilot", "password", "ROLE_USER");
        Supplier<Authentication> authenticationSupplier = () -> authentication;
        Message<byte[]> send = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/matchmaking.chat")
                .build();
        Message<byte[]> subscribe = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.SUBSCRIBE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/user/queue/match-chat")
                .build();

        assertThat(manager.authorize(authenticationSupplier, send).isGranted()).isTrue();
        assertThat(manager.authorize(authenticationSupplier, subscribe).isGranted()).isTrue();
    }
}
