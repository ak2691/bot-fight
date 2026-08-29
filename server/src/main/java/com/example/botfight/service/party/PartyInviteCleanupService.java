package com.example.botfight.service.party;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

/** Periodically expires pending party invites and removes old terminal rows. */
@Service
@DependsOn("matchmakingLifecycleScheduler")
public class PartyInviteCleanupService {

    private final PartyService partyService;
    private final TaskScheduler scheduler;

    public PartyInviteCleanupService(
            PartyService partyService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler) {
        this.partyService = partyService;
        this.scheduler = scheduler;
    }

    @jakarta.annotation.PostConstruct
    void scheduleCleanup() {
        scheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        partyService.cleanupExpiredInvites();
                    } catch (RuntimeException ignored) {
                        // Cleanup is best-effort; request paths still enforce expiry.
                    }
                },
                Duration.ofHours(1));
    }
}
