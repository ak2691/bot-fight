package com.example.botfight.service.invite;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

/** Periodically expires pending invites and removes old terminal rows. */
@Service
@DependsOn("matchmakingLifecycleScheduler")
public class DuelInviteCleanupService {

    private final DuelInviteService duelInviteService;
    private final TaskScheduler scheduler;

    public DuelInviteCleanupService(
            DuelInviteService duelInviteService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler) {
        this.duelInviteService = duelInviteService;
        this.scheduler = scheduler;
    }

    @jakarta.annotation.PostConstruct
    void scheduleCleanup() {
        scheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        duelInviteService.cleanupExpiredInvites();
                    } catch (RuntimeException ignored) {
                        // Cleanup is best-effort; request paths still enforce expiry.
                    }
                },
                Duration.ofHours(1));
    }
}
