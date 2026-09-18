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
    void authenticatedUsersMayResumeMatchmakingState() {
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

        Message<byte[]> queueResumeMessage = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/matchmaking.resumeQueue")
                .build();

        assertThat(manager.authorize(authenticationSupplier, queueResumeMessage).isGranted()).isTrue();

        Message<byte[]> cancelMessage = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/matchmaking.cancel")
                .build();
        assertThat(manager.authorize(authenticationSupplier, cancelMessage).isGranted()).isTrue();
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

    @Test
    void authenticatedUsersMaySubscribeToCustomLobbyState() {
        MessageMatcherDelegatingAuthorizationManager.Builder messages =
                MessageMatcherDelegatingAuthorizationManager.builder();
        AuthorizationManager<Message<?>> manager =
                new WebSocketSecurityConfig().messageAuthorizationManager(messages);
        Authentication authentication = new TestingAuthenticationToken("pilot", "password", "ROLE_USER");
        Message<byte[]> subscribe = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.SUBSCRIBE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/user/queue/custom-lobby")
                .build();

        assertThat(manager.authorize(() -> authentication, subscribe).isGranted()).isTrue();
    }

    @Test
    void authenticatedUsersMaySendCustomLobbyChat() {
        MessageMatcherDelegatingAuthorizationManager.Builder messages =
                MessageMatcherDelegatingAuthorizationManager.builder();
        AuthorizationManager<Message<?>> manager =
                new WebSocketSecurityConfig().messageAuthorizationManager(messages);
        Authentication authentication = new TestingAuthenticationToken("pilot", "password", "ROLE_USER");
        Message<byte[]> send = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/custom-lobby.chat")
                .build();

        assertThat(manager.authorize(() -> authentication, send).isGranted()).isTrue();
    }

    @Test
    void guestsMayUseMatchmakingButNotSocialDestinations() {
        MessageMatcherDelegatingAuthorizationManager.Builder messages =
                MessageMatcherDelegatingAuthorizationManager.builder();
        AuthorizationManager<Message<?>> manager =
                new WebSocketSecurityConfig().messageAuthorizationManager(messages);
        Authentication authentication = new TestingAuthenticationToken("guest", "password", "ROLE_GUEST");

        Message<byte[]> matchmaking = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/matchmaking.join")
                .build();
        Message<byte[]> matchSubscription = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.SUBSCRIBE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/user/queue/match")
                .build();
        assertThat(manager.authorize(() -> authentication, matchmaking).isGranted()).isTrue();
        assertThat(manager.authorize(() -> authentication, matchSubscription).isGranted()).isTrue();

        for (String destination : new String[] {
                "/user/queue/notifications",
                "/user/queue/party",
                "/user/queue/custom-lobby"}) {
            Message<byte[]> subscribe = MessageBuilder.withPayload(new byte[0])
                    .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.SUBSCRIBE)
                    .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, destination)
                    .build();
            assertThat(manager.authorize(() -> authentication, subscribe).isGranted()).isFalse();
        }

        Message<byte[]> customLobbyChat = MessageBuilder.withPayload(new byte[0])
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, "/app/custom-lobby.chat")
                .build();
        assertThat(manager.authorize(() -> authentication, customLobbyChat).isGranted()).isFalse();
    }

    @Test
    void authenticatedUsersMayExchangeReadOnlyCodeViewMessages() {
        MessageMatcherDelegatingAuthorizationManager.Builder messages =
                MessageMatcherDelegatingAuthorizationManager.builder();
        AuthorizationManager<Message<?>> manager =
                new WebSocketSecurityConfig().messageAuthorizationManager(messages);
        Authentication authentication = new TestingAuthenticationToken("pilot", "password", "ROLE_USER");
        Supplier<Authentication> authenticationSupplier = () -> authentication;

        for (String destination : new String[] {
                "/app/matchmaking.codeView.request",
                "/app/matchmaking.codeView.response"}) {
            Message<byte[]> message = MessageBuilder.withPayload(new byte[0])
                    .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                    .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, destination)
                    .build();

            assertThat(manager.authorize(authenticationSupplier, message).isGranted()).isTrue();
        }
    }
}
