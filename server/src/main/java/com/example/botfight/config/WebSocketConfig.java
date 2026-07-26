package com.example.botfight.config;

import com.example.botfight.security.SanitizedStompErrorHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final BotFightSecurityProperties securityProperties;
    private final TaskScheduler matchmakingHeartbeatScheduler;

    public WebSocketConfig(
            BotFightSecurityProperties securityProperties,
            @Qualifier("matchmakingHeartbeatScheduler") TaskScheduler matchmakingHeartbeatScheduler) {
        this.securityProperties = securityProperties;
        this.matchmakingHeartbeatScheduler = matchmakingHeartbeatScheduler;
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
                .setAllowedOrigins(securityProperties.getAllowedOrigins().toArray(String[]::new));
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        int messageLimit = securityProperties.getMaxWebSocketMessageBytes();
        registration
                .setMessageSizeLimit(messageLimit)
                .setSendBufferSizeLimit(securityProperties.getMaxWebSocketSendBufferBytes())
                .setSendTimeLimit(10_000);
    }
}
