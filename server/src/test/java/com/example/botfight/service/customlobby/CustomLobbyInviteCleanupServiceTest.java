package com.example.botfight.service.customlobby;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;

class CustomLobbyInviteCleanupServiceTest {

    @Test
    void schedulesCustomLobbyInviteCleanupEveryMinute() {
        CustomLobbyService customLobbyService = mock(CustomLobbyService.class);
        TaskScheduler scheduler = mock(TaskScheduler.class);
        CustomLobbyInviteCleanupService cleanupService =
                new CustomLobbyInviteCleanupService(customLobbyService, scheduler);

        cleanupService.scheduleCleanup();

        verify(scheduler).scheduleWithFixedDelay(any(Runnable.class), eq(Duration.ofMinutes(1)));
    }
}
