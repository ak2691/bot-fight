package com.example.botfight.service.chatmoderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.config.ChatModerationProperties;
import com.example.botfight.DTO.chatmoderation.ChatReportRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.auth.UserRole;
import com.example.botfight.domain.chatmoderation.ChatContextType;
import com.example.botfight.domain.chatmoderation.ChatReportReason;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import com.example.botfight.repository.ChatMessageEvidenceRepository;
import com.example.botfight.repository.ChatModerationAuditRepository;
import com.example.botfight.repository.ChatReportRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.show-sql=false"
})
@Import({
        ChatEvidenceService.class,
        ChatReportPersistenceService.class,
        ChatReportService.class,
        ChatReportAdminService.class,
        ChatModerationRetentionService.class,
        ChatModerationPersistenceTest.TestConfig.class
})
class ChatModerationPersistenceTest {
    private static final Instant NOW = Instant.parse("2026-09-26T12:00:00Z");

    @Autowired private UserRepository userRepository;
    @Autowired private ChatMessageEvidenceRepository evidenceRepository;
    @Autowired private ChatReportRepository reportRepository;
    @Autowired private ChatModerationAuditRepository auditRepository;
    @Autowired private ChatEvidenceService evidenceService;
    @Autowired private ChatReportService reportService;
    @Autowired private ChatReportAdminService adminService;
    @Autowired private ChatModerationRetentionService retentionService;
    @Autowired private ChatModerationProperties moderationProperties;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;

    private AppUser sender;
    private AppUser senderTwo;
    private AppUser recipient;
    private AppUser outsider;
    private AppUser admin;

    @BeforeEach
    void createUsers() {
        reportRepository.deleteAll();
        evidenceRepository.deleteAll();
        auditRepository.deleteAll();
        userRepository.deleteAll();
        jdbcTemplate.execute("alter table users alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table users alter column updated_at set default current_timestamp");
        sender = saveUser("chat-sender", UserRole.USER);
        senderTwo = saveUser("chat-sender-two", UserRole.USER);
        recipient = saveUser("chat-recipient", UserRole.USER);
        outsider = saveUser("chat-outsider", UserRole.USER);
        admin = saveUser("chat-admin", UserRole.ADMIN);
    }

    @Test
    void forgedMessageAndNonRecipientReceiveTheSameAcknowledgementWithoutCreatingReports() {
        UUID realMessage = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        var forgedAck = reportService.report(
                recipient.getId(), UUID.randomUUID(), ChatReportReason.SPAM, null);
        var nonRecipientAck = reportService.report(
                outsider.getId(), realMessage, ChatReportReason.SPAM, null);

        assertThat(forgedAck).isEqualTo(nonRecipientAck);
        assertThat(forgedAck.acknowledged()).isTrue();
        assertThat(reportRepository.count()).isZero();
    }

    @Test
    void reportSnapshotSurvivesEvidenceExpiryAndResolvedDeletionLeavesAudit() {
        UUID messageId = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        reportService.report(recipient.getId(), messageId, ChatReportReason.HARASSMENT, "context");
        var report = reportRepository.findAll().getFirst();
        jdbcTemplate.update("update chat_message_evidence set expires_at = ? where message_id = ?", NOW.minusSeconds(1), messageId);

        assertThat(retentionService.removeExpiredEvidence(NOW)).isZero();
        assertThat(evidenceRepository.existsById(messageId)).isTrue();
        assertThat(adminService.detail(admin.getId(), report.getReportId()).message()).isEqualTo("verified chat text");

        adminService.resolve(admin.getId(), report.getReportId(), ChatReportStatus.ACTIONED, "Reviewed");
        assertThat(adminService.detail(admin.getId(), report.getReportId()).updatedAt()).isEqualTo(NOW);
        assertThat(retentionService.removeExpiredEvidence(NOW)).isEqualTo(1);
        assertThat(evidenceRepository.existsById(messageId)).isFalse();
        assertThat(adminService.detail(admin.getId(), report.getReportId()).message()).isEqualTo("verified chat text");

        adminService.delete(admin.getId(), report.getReportId());
        assertThat(reportRepository.existsById(report.getReportId())).isFalse();
        assertThat(auditRepository.findByReportIdOrderByCreatedAtAsc(report.getReportId()))
                .extracting(audit -> audit.getAction())
                .contains("REPORT_SUBMITTED", "REPORT_RESOLVED", "REPORT_DELETED");
    }

    @Test
    void unreportedEvidenceExpiresAndResolvedReportsArePurgedWithAnAuditEntry() {
        UUID messageId = capture(sender, recipient, NOW.minusSeconds(1));
        assertThat(retentionService.removeExpiredEvidence(NOW)).isEqualTo(1);
        assertThat(evidenceRepository.existsById(messageId)).isFalse();

        UUID reportedMessage = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        reportService.report(recipient.getId(), reportedMessage, ChatReportReason.SPAM, null);
        UUID reportId = reportRepository.findAll().getFirst().getReportId();
        adminService.resolve(admin.getId(), reportId, ChatReportStatus.DISMISSED, null);

        assertThat(adminService.purgeResolvedBefore(NOW.plusSeconds(1))).isEqualTo(1);
        assertThat(reportRepository.existsById(reportId)).isFalse();
        assertThat(auditRepository.findByReportIdOrderByCreatedAtAsc(reportId))
                .extracting(audit -> audit.getAction())
                .contains("REPORT_RETENTION_PURGED");
    }

    @Test
    void nonAdminsCannotReadOrResolveReports() {
        UUID messageId = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        reportService.report(recipient.getId(), messageId, ChatReportReason.OTHER, null);
        UUID reportId = reportRepository.findAll().getFirst().getReportId();

        assertThatThrownBy(() -> adminService.detail(outsider.getId(), reportId))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> adminService.resolve(
                outsider.getId(), reportId, ChatReportStatus.ACTIONED, "forged admin"))
                .isInstanceOf(AccessDeniedException.class);
        assertThat(adminService.detail(admin.getId(), reportId).reporterUserId()).isEqualTo(recipient.getId());
    }

    @Test
    void reportRequestHasNoClientEvidenceFieldsAndOpenReportsAreCapped() {
        assertThat(java.util.Arrays.stream(ChatReportRequestDTO.class.getRecordComponents())
                .map(component -> component.getName())
                .toList())
                .containsExactly("reason", "note");
        moderationProperties.setMaxOpenReportsPerUser(1);
        try {
            UUID firstMessage = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
            UUID secondMessage = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));

            reportService.report(recipient.getId(), firstMessage, ChatReportReason.SPAM, null);
            reportService.report(recipient.getId(), secondMessage, ChatReportReason.SPAM, null);

            assertThat(reportRepository.countByReporterUserIdAndStatus(recipient.getId(), ChatReportStatus.OPEN))
                    .isEqualTo(1);
        } finally {
            moderationProperties.setMaxOpenReportsPerUser(5);
        }
    }

    @Test
    void targetRateLimitUsesReportedUserAcrossDifferentMessages() {
        UUID firstMessage = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        UUID secondMessage = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        UUID differentSenderMessage = capture(senderTwo, recipient, NOW.plus(Duration.ofDays(1)));

        reportService.report(recipient.getId(), firstMessage, ChatReportReason.SPAM, null);
        reportService.report(recipient.getId(), secondMessage, ChatReportReason.SPAM, null);
        reportService.report(recipient.getId(), differentSenderMessage, ChatReportReason.SPAM, null);

        assertThat(reportRepository.countByReporterUserIdAndStatus(recipient.getId(), ChatReportStatus.OPEN))
                .isEqualTo(2);
    }

    @Test
    void concurrentDuplicateReportsCreateOneReportAndAlwaysAcknowledge() throws Exception {
        UUID messageId = capture(sender, recipient, NOW.plus(Duration.ofDays(1)));
        TestTransaction.flagForCommit();
        TestTransaction.end();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        try {
            var first = executor.submit(() -> concurrentReport(messageId, ready, start));
            var second = executor.submit(() -> concurrentReport(messageId, ready, start));
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(first.get(10, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(10, TimeUnit.SECONDS)).isTrue();
        } finally {
            executor.shutdownNow();
        }
        long count = new TransactionTemplate(transactionManager).execute(status -> reportRepository.count());
        assertThat(count).isEqualTo(1);
    }

    private boolean concurrentReport(UUID messageId, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        if (!start.await(5, TimeUnit.SECONDS)) return false;
        return reportService.report(recipient.getId(), messageId, ChatReportReason.SPAM, null).acknowledged();
    }

    private UUID capture(AppUser source, AppUser target, Instant expiresAt) {
        UUID messageId = UUID.randomUUID();
        evidenceService.capture(
                messageId,
                ChatContextType.MATCH,
                UUID.randomUUID(),
                source.getId(),
                source.getUsername(),
                NOW.minusSeconds(1),
                "verified chat text",
                java.util.List.of(source.getId(), target.getId()));
        evidenceRepository.flush();
        jdbcTemplate.update("update chat_message_evidence set expires_at = ? where message_id = ?", expiresAt, messageId);
        return messageId;
    }

    private AppUser saveUser(String username, UserRole role) {
        AppUser user = new AppUser();
        user.setUsername(username);
        user.setEmail(username + "@example.test");
        user.setNormalizedEmail(username + "@example.test");
        user.setRole(role);
        return userRepository.saveAndFlush(user);
    }

    @TestConfiguration
    static class TestConfig {
        @Bean
        Clock clock() { return Clock.fixed(NOW, ZoneOffset.UTC); }

        @Bean
        ChatModerationProperties chatModerationProperties() { return new ChatModerationProperties(); }

        @Bean(name = "chatReportReporterRateLimiter")
        TokenBucketRateLimiter<UUID> reporterLimiter(Clock clock) {
            return new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1));
        }

        @Bean(name = "chatReportTargetRateLimiter")
        TokenBucketRateLimiter<String> targetLimiter(Clock clock) {
            return new TokenBucketRateLimiter<>(clock, 1, Duration.ofMinutes(10));
        }
    }
}
