package com.example.botfight.service;

import com.example.botfight.service.auth.UnverifiedAccountCleanupService;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class UnverifiedAccountCleanupServiceTest {

    @Test
    void deletesUnverifiedAccountsOlderThanTwentyFourHoursAtStartup() {
        UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
        when(userRepository.deleteUnverifiedAccountsCreatedBefore(Instant.parse("2026-08-01T12:00:00Z")))
                .thenReturn(2);
        UnverifiedAccountCleanupService service = new UnverifiedAccountCleanupService(
                userRepository,
                Clock.fixed(Instant.parse("2026-08-02T12:00:00Z"), ZoneOffset.UTC));

        service.cleanupExpiredUnverifiedAccounts();

        verify(userRepository).deleteUnverifiedAccountsCreatedBefore(
                eq(Instant.parse("2026-08-01T12:00:00Z")));
    }
}
