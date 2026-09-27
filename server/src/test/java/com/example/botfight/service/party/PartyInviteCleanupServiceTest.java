package com.example.botfight.service.party;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;

class PartyInviteCleanupServiceTest {

    @Test
    void schedulesPartyInviteCleanupEveryMinute() {
        PartyService partyService = mock(PartyService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        PartyInviteCleanupService cleanupService = new PartyInviteCleanupService(partyService, scheduler);

        cleanupService.scheduleCleanup();

        verify(scheduler).scheduleWithFixedDelay(any(Runnable.class), eq(Duration.ofMinutes(1)));
    }
}
