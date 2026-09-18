package com.example.botfight.config;

import static org.springframework.messaging.simp.SimpMessageType.DISCONNECT;
import static org.springframework.messaging.simp.SimpMessageType.MESSAGE;
import static org.springframework.messaging.simp.SimpMessageType.SUBSCRIBE;
import static org.springframework.messaging.simp.SimpMessageType.UNSUBSCRIBE;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.config.annotation.web.socket.EnableWebSocketSecurity;
import org.springframework.security.messaging.access.intercept.MessageMatcherDelegatingAuthorizationManager;

@Configuration
@EnableWebSocketSecurity
public class WebSocketSecurityConfig {

    @Bean
    AuthorizationManager<Message<?>> messageAuthorizationManager(
            MessageMatcherDelegatingAuthorizationManager.Builder messages) {
        messages
                .nullDestMatcher().authenticated()
                .simpDestMatchers(
                        "/app/matchmaking.join",
                        "/app/matchmaking.resume",
                        "/app/matchmaking.resumeQueue",
                        "/app/matchmaking.accept",
                        "/app/matchmaking.cancel",
                        "/app/matchmaking.leave",
                        "/app/matchmaking.selectLoadout",
                        "/app/matchmaking.surrender",
                        "/app/matchmaking.codeView.request",
                        "/app/matchmaking.codeView.response",
                        "/app/matchmaking.chat").authenticated()
                .simpDestMatchers("/app/custom-lobby.chat").hasAnyRole("USER", "ADMIN")
                .simpSubscribeDestMatchers(
                        "/user/queue/matchmaking",
                        "/user/queue/match",
                        "/user/queue/match-chat").authenticated()
                .simpSubscribeDestMatchers(
                        "/user/queue/notifications",
                        "/user/queue/party",
                        "/user/queue/custom-lobby").hasAnyRole("USER", "ADMIN")
                .simpTypeMatchers(UNSUBSCRIBE, DISCONNECT).authenticated()
                .simpTypeMatchers(MESSAGE, SUBSCRIBE).denyAll()
                .anyMessage().denyAll();
        return messages.build();
    }
}
