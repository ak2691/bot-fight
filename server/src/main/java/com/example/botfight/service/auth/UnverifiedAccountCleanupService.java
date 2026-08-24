package com.example.botfight.service.auth;

import com.example.botfight.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Removes abandoned incomplete accounts once when the application starts.
 *
 * <p>This includes normal registrations that never verified their email and
 * Google-only accounts that never completed username setup.</p>
 */
@Service
public class UnverifiedAccountCleanupService {

    private static final Duration RETENTION = Duration.ofHours(24);
    private static final Logger log = LoggerFactory.getLogger(UnverifiedAccountCleanupService.class);

    private final UserRepository userRepository;
    private final Clock clock;

    public UnverifiedAccountCleanupService(UserRepository userRepository, Clock clock) {
        this.userRepository = userRepository;
        this.clock = clock;
    }

    @PostConstruct
    public void cleanupExpiredUnverifiedAccounts() {
        Instant cutoff = clock.instant().minus(RETENTION);
        int deletedAccounts = userRepository.deleteUnverifiedAccountsCreatedBefore(cutoff);
        if (deletedAccounts > 0) {
            log.info("Deleted {} abandoned incomplete account(s) older than 24 hours", deletedAccounts);
        }
    }
}
