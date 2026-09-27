package com.example.botfight.service;

import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import com.example.botfight.service.websocket.WebSocketSessionDisconnectedEvent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.security.Principal;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.messaging.SessionConnectEvent;

class SingleUserWebSocketSessionRegistryTest {

    @Test
    void multipleTransportsForOnePrincipalRemainActiveAndOneCloseIsNotFinal()
            throws Exception {
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry();
        Principal principal = () -> "pilot@example.com";
        WebSocketSession oldSession = session("socket-old", principal, true);
        WebSocketSession currentSession = session("socket-current", principal, true);
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());

        decorated.afterConnectionEstablished(oldSession);
        decorated.afterConnectionEstablished(currentSession);

        verify(oldSession, never()).close(any(CloseStatus.class));
        verify(currentSession, never()).close(any(CloseStatus.class));
        assertThat(registry.sessionIdsForPrincipal(principal.getName()))
                .containsExactlyInAnyOrder("socket-old", "socket-current");

        decorated.afterConnectionClosed(oldSession, CloseStatus.NORMAL);
        assertThat(registry.hasActiveSessionForPrincipal(principal.getName())).isTrue();
        assertThat(registry.sessionIdsForPrincipal(principal.getName())).containsExactly("socket-current");
        decorated.afterConnectionClosed(currentSession, CloseStatus.NORMAL);
        assertThat(registry.hasActiveSessionForPrincipal(principal.getName())).isFalse();
    }

    @Test
    void stompConnectAddsItsPrincipalWithoutReplacingAnOlderTransport()
            throws Exception {
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry();
        Principal principal = () -> "pilot@example.com";
        WebSocketSession oldSession = session("socket-old", principal, true);
        WebSocketSession newSession = session("socket-new", null, true);
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());

        decorated.afterConnectionEstablished(oldSession);
        decorated.afterConnectionEstablished(newSession);

        StompHeaderAccessor headers = StompHeaderAccessor.create(StompCommand.CONNECT);
        headers.setSessionId("socket-new");
        Message<byte[]> connectMessage = MessageBuilder.createMessage(
                new byte[0],
                headers.getMessageHeaders());
        registry.handleSessionConnect(new SessionConnectEvent(this, connectMessage, principal));

        verify(oldSession, never()).close(any(CloseStatus.class));
        verify(newSession, never()).close(any(CloseStatus.class));
        assertThat(registry.sessionIdsForPrincipal(principal.getName()))
                .containsExactlyInAnyOrder("socket-old", "socket-new");
    }

    @Test
    void finalDisconnectLifecycleIsPublishedExactlyOnce()
            throws Exception {
        ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry(publisher, 5);
        Principal principal = () -> "pilot@example.com";
        WebSocketSession currentSession = session("socket-current", principal, true);
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());

        decorated.afterConnectionEstablished(currentSession);
        decorated.afterConnectionClosed(currentSession, CloseStatus.NORMAL);
        org.springframework.web.socket.messaging.SessionDisconnectEvent disconnectEvent =
                mock(org.springframework.web.socket.messaging.SessionDisconnectEvent.class);
        when(disconnectEvent.getSessionId()).thenReturn("socket-current");
        registry.handleSessionDisconnect(disconnectEvent);

        verify(currentSession, never()).close(any(CloseStatus.class));
        ArgumentCaptor<WebSocketSessionDisconnectedEvent> eventCaptor =
                ArgumentCaptor.forClass(WebSocketSessionDisconnectedEvent.class);
        verify(publisher).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue().finalSession()).isTrue();
        assertThat(eventCaptor.getValue().sessionId()).isEqualTo("socket-current");
        assertThat(eventCaptor.getValue().principal()).isEqualTo(principal);
    }

    @Test
    void sixthSessionIsRejectedWithTerminalCloseStatusWithoutClosingExistingTabs() throws Exception {
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry(null, 5);
        Principal principal = () -> "pilot@example.com";
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());
        List<WebSocketSession> sessions = new ArrayList<>();
        for (int index = 0; index < 6; index++) {
            WebSocketSession session = session("socket-" + index, principal, true);
            sessions.add(session);
            decorated.afterConnectionEstablished(session);
        }

        assertThat(registry.sessionIdsForPrincipal(principal.getName())).hasSize(5);
        for (int index = 0; index < 5; index++) {
            verify(sessions.get(index), never()).close(any(CloseStatus.class));
        }
        ArgumentCaptor<CloseStatus> statusCaptor = ArgumentCaptor.forClass(CloseStatus.class);
        verify(sessions.get(5)).close(statusCaptor.capture());
        assertThat(statusCaptor.getValue().getCode()).isEqualTo(1008);
        assertThat(statusCaptor.getValue().getReason())
                .isEqualTo(SingleUserWebSocketSessionRegistry.SESSION_LIMIT_CLOSE_REASON);
    }

    @Test
    void concurrentRegistrationsAndDisconnectsLeaveNoStaleSessionEntries() throws Exception {
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry(null, 5);
        Principal principal = () -> "pilot@example.com";
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());
        int count = 20;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            List<Future<?>> work = new ArrayList<>();
            for (int index = 0; index < count; index++) {
                String id = "socket-" + index;
                WebSocketSession session = session(id, principal, true);
                work.add(executor.submit(() -> {
                    start.await();
                    decorated.afterConnectionEstablished(session);
                    decorated.afterConnectionClosed(session, CloseStatus.NORMAL);
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> future : work) future.get();
        } finally {
            executor.shutdownNow();
        }
        assertThat(registry.sessionIdsForPrincipal(principal.getName())).isEmpty();
        assertThat(registry.hasActiveSessionForPrincipal(principal.getName())).isFalse();
    }

    @Test
    void aNewSocketWaitsForFinalDisconnectCleanupBeforeBecomingActive() throws Exception {
        CountDownLatch cleanupStarted = new CountDownLatch(1);
        CountDownLatch finishCleanup = new CountDownLatch(1);
        ApplicationEventPublisher publisher = event -> {
            if (event instanceof WebSocketSessionDisconnectedEvent disconnected
                    && disconnected.finalSession()) {
                cleanupStarted.countDown();
                try {
                    finishCleanup.await();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                }
            }
        };
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry(publisher, 5);
        Principal principal = () -> "pilot@example.com";
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());
        WebSocketSession oldSession = session("socket-old", principal, true);
        WebSocketSession newSession = session("socket-new", principal, true);
        decorated.afterConnectionEstablished(oldSession);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> disconnect = executor.submit(() -> {
                decorated.afterConnectionClosed(oldSession, CloseStatus.NORMAL);
                return null;
            });
            assertThat(cleanupStarted.await(2, TimeUnit.SECONDS)).isTrue();

            CountDownLatch registrationStarted = new CountDownLatch(1);
            CountDownLatch registrationCompleted = new CountDownLatch(1);
            Future<?> registration = executor.submit(() -> {
                registrationStarted.countDown();
                decorated.afterConnectionEstablished(newSession);
                registrationCompleted.countDown();
                return null;
            });
            assertThat(registrationStarted.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(registrationCompleted.await(100, TimeUnit.MILLISECONDS)).isFalse();

            finishCleanup.countDown();
            disconnect.get(2, TimeUnit.SECONDS);
            registration.get(2, TimeUnit.SECONDS);
        } finally {
            finishCleanup.countDown();
            executor.shutdownNow();
        }
        assertThat(registry.sessionIdsForPrincipal(principal.getName())).containsExactly("socket-new");
    }

    private static WebSocketSession session(String id, Principal principal, boolean open) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.getPrincipal()).thenReturn(principal);
        when(session.isOpen()).thenReturn(open);
        return session;
    }
}
