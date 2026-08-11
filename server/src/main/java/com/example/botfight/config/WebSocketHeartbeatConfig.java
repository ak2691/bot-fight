package com.example.botfight.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class WebSocketHeartbeatConfig {

    @Bean(name = "matchmakingHeartbeatScheduler")
    public ThreadPoolTaskScheduler matchmakingHeartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("websocket-heartbeat-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        return scheduler;
    }

    @Bean(name = "matchmakingLifecycleScheduler")
    public ThreadPoolTaskScheduler matchmakingLifecycleScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("matchmaking-lifecycle-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        return scheduler;
    }

    @Bean(name = "matchSimulationExecutor")
    public ThreadPoolTaskExecutor matchSimulationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(Math.max(4, Runtime.getRuntime().availableProcessors()));
        executor.setQueueCapacity(256);
        executor.setThreadNamePrefix("match-simulation-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }
}
