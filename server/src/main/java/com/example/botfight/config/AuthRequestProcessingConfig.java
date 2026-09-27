package com.example.botfight.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** Keeps account-state-dependent work off public acknowledgement response paths. */
@Configuration
public class AuthRequestProcessingConfig {

    @Bean(name = "authRequestExecutor")
    public ThreadPoolTaskExecutor authRequestExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(128);
        executor.setThreadNamePrefix("auth-request-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }
}
