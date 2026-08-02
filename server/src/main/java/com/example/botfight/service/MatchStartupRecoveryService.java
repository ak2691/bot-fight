package com.example.botfight.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Reconciles persisted match state after the process-local match sessions have
 * been discarded by a server restart.
 */
@Service
public class MatchStartupRecoveryService {

    private static final Logger log = LoggerFactory.getLogger(MatchStartupRecoveryService.class);

    private final MatchPersistenceService matchPersistenceService;
    private final StartupReadinessService startupReadinessService;

    public MatchStartupRecoveryService(
            MatchPersistenceService matchPersistenceService,
            StartupReadinessService startupReadinessService) {
        this.matchPersistenceService = matchPersistenceService;
        this.startupReadinessService = startupReadinessService;
    }

    /**
     * Run while the application context is being built and release the
     * request gate only after the reconciliation transaction commits. If the
     * database cannot be reconciled, the exception is allowed to fail startup
     * rather than exposing a partially recovered server.
     */
    @PostConstruct
    public void recoverInterruptedMatches() {
        int cancelledMatches = matchPersistenceService.cancelMatchesInterruptedByServerRestart();
        if (cancelledMatches > 0) {
            log.warn("Cancelled {} match(es) left RUNNING by the previous server process", cancelledMatches);
        }
        startupReadinessService.markReady();
    }
}
