package com.example.botfight.config;

import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(ChatModerationProperties.class)
public class ChatModerationConfig {

    @Bean(name = "chatReportReporterRateLimiter")
    TokenBucketRateLimiter<UUID> chatReportReporterRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 5, Duration.ofMinutes(1), 20_000);
    }

    @Bean(name = "chatReportTargetRateLimiter")
    TokenBucketRateLimiter<String> chatReportTargetRateLimiter(Clock clock) {
        return new TokenBucketRateLimiter<>(clock, 1, Duration.ofMinutes(10), 50_000);
    }
}
