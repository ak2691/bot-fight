package com.example.botfight.config;

import com.example.botfight.security.SanitizedStompErrorHandler;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.server.standard.StandardWebSocketUpgradeStrategy;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final BotFightSecurityProperties securityProperties;
    private final TaskScheduler matchmakingHeartbeatScheduler;
    private final SingleUserWebSocketSessionRegistry singleUserWebSocketSessionRegistry;

    public WebSocketConfig(
            BotFightSecurityProperties securityProperties,
            @Qualifier("matchmakingHeartbeatScheduler") TaskScheduler matchmakingHeartbeatScheduler,
            SingleUserWebSocketSessionRegistry singleUserWebSocketSessionRegistry) {
        this.securityProperties = securityProperties;
        this.matchmakingHeartbeatScheduler = matchmakingHeartbeatScheduler;
        this.singleUserWebSocketSessionRegistry = singleUserWebSocketSessionRegistry;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/queue")
                .setHeartbeatValue(new long[] {10_000L, 10_000L})
                .setTaskScheduler(matchmakingHeartbeatScheduler);
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.setErrorHandler(new SanitizedStompErrorHandler());
        registry.addEndpoint("/ws")
                // Tomcat advertises permessage-deflate through the standard JSR-356 strategy.
                .setHandshakeHandler(new DefaultHandshakeHandler(new StandardWebSocketUpgradeStrategy()))
                .setAllowedOrigins(securityProperties.getAllowedOrigins().toArray(String[]::new));
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        int messageLimit = securityProperties.getMaxWebSocketMessageBytes();
        registration
                .setMessageSizeLimit(messageLimit)
                .setSendBufferSizeLimit(securityProperties.getMaxWebSocketSendBufferBytes())
                .setSendTimeLimit(10_000)
                .addDecoratorFactory(singleUserWebSocketSessionRegistry.decoratorFactory());
    }
}
