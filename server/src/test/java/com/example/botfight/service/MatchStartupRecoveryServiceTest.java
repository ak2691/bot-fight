package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

class MatchStartupRecoveryServiceTest {

    @Test
    void opensTheStartupGateOnlyAfterRecoveryCompletes() {
        MatchPersistenceService persistenceService = mock(MatchPersistenceService.class);
        StartupReadinessService readinessService = new StartupReadinessService();
        when(persistenceService.cancelMatchesInterruptedByServerRestart()).thenReturn(2);
        MatchStartupRecoveryService recoveryService = new MatchStartupRecoveryService(
                persistenceService,
                readinessService);

        recoveryService.recoverInterruptedMatches();

        assertThat(readinessService.isReady()).isTrue();
        verify(persistenceService).cancelMatchesInterruptedByServerRestart();
    }

    @Test
    void keepsTheStartupGateClosedWhenRecoveryFails() {
        MatchPersistenceService persistenceService = mock(MatchPersistenceService.class);
        StartupReadinessService readinessService = new StartupReadinessService();
        IllegalStateException failure = new IllegalStateException("database unavailable");
        when(persistenceService.cancelMatchesInterruptedByServerRestart()).thenThrow(failure);
        MatchStartupRecoveryService recoveryService = new MatchStartupRecoveryService(
                persistenceService,
                readinessService);

        assertThatThrownBy(recoveryService::recoverInterruptedMatches)
                .isSameAs(failure);
        assertThat(readinessService.isReady()).isFalse();
    }
}
