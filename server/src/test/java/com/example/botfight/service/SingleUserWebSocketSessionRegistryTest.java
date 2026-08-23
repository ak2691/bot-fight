package com.example.botfight.service;

import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.security.Principal;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.messaging.SessionConnectEvent;

class SingleUserWebSocketSessionRegistryTest {

    @Test
    void openingASecondTransportClosesTheFirstAndStaleCloseCannotRemoveTheCurrentSession()
            throws Exception {
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry();
        Principal principal = () -> "pilot@example.com";
        WebSocketSession oldSession = session("socket-old", principal, true);
        WebSocketSession currentSession = session("socket-current", principal, true);
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());

        decorated.afterConnectionEstablished(oldSession);
        decorated.afterConnectionEstablished(currentSession);

        ArgumentCaptor<CloseStatus> closeStatusCaptor = ArgumentCaptor.forClass(CloseStatus.class);
        verify(oldSession).close(closeStatusCaptor.capture());
        assertThat(closeStatusCaptor.getValue().getCode()).isEqualTo(1000);
        assertThat(closeStatusCaptor.getValue().getReason()).isEqualTo("Replaced by a newer connection");

        decorated.afterConnectionClosed(oldSession, CloseStatus.NORMAL);

        WebSocketSession nextSession = session("socket-next", principal, true);
        decorated.afterConnectionEstablished(nextSession);
        verify(currentSession).close(any(CloseStatus.class));
    }

    @Test
    void stompConnectClosesAnOlderTransportWhenItsPrincipalArrivesAtTheProtocolLayer()
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

        verify(oldSession).close(any(CloseStatus.class));
        verify(newSession, never()).close(any(CloseStatus.class));
    }

    @Test
    void closingTheCurrentTransportAllowsTheNextConnectionToBecomeCurrent()
            throws Exception {
        SingleUserWebSocketSessionRegistry registry = new SingleUserWebSocketSessionRegistry();
        Principal principal = () -> "pilot@example.com";
        WebSocketSession currentSession = session("socket-current", principal, true);
        WebSocketSession nextSession = session("socket-next", principal, true);
        WebSocketHandler decorated = registry.decoratorFactory().decorate(new TextWebSocketHandler());

        decorated.afterConnectionEstablished(currentSession);
        decorated.afterConnectionClosed(currentSession, CloseStatus.NORMAL);
        decorated.afterConnectionEstablished(nextSession);

        verify(currentSession, never()).close(any(CloseStatus.class));
    }

    private static WebSocketSession session(String id, Principal principal, boolean open) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.getPrincipal()).thenReturn(principal);
        when(session.isOpen()).thenReturn(open);
        return session;
    }
}
