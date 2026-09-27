package com.example.botfight.service.customlobby;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

/** Periodically removes expired and terminal custom-lobby invites. */
@Service
@DependsOn("matchmakingLifecycleScheduler")
public class CustomLobbyInviteCleanupService {

    private final CustomLobbyService customLobbyService;
    private final TaskScheduler scheduler;

    public CustomLobbyInviteCleanupService(
            CustomLobbyService customLobbyService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler) {
        this.customLobbyService = customLobbyService;
        this.scheduler = scheduler;
    }

    @jakarta.annotation.PostConstruct
    void scheduleCleanup() {
        scheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        customLobbyService.cleanupExpiredInvites();
                    } catch (RuntimeException ignored) {
                        // Cleanup is best-effort; request paths still enforce expiry.
                    }
                },
                Duration.ofMinutes(1));
    }
}
