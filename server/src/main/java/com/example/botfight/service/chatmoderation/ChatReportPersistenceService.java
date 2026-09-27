package com.example.botfight.service.chatmoderation;

import com.example.botfight.config.ChatModerationProperties;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.chatmoderation.ChatMessageEvidence;
import com.example.botfight.domain.chatmoderation.ChatModerationAudit;
import com.example.botfight.domain.chatmoderation.ChatReport;
import com.example.botfight.domain.chatmoderation.ChatReportReason;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import com.example.botfight.repository.ChatMessageEvidenceRepository;
import com.example.botfight.repository.ChatModerationAuditRepository;
import com.example.botfight.repository.ChatReportRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Serializes each reporter's open-report cap and copies immutable evidence in one transaction. */
@Service
public class ChatReportPersistenceService {

    @PersistenceContext
    private EntityManager entityManager;
    private final ChatMessageEvidenceRepository evidenceRepository;
    private final ChatReportRepository reportRepository;
    private final ChatModerationAuditRepository auditRepository;
    private final ChatModerationProperties properties;
    private final Clock clock;

    public ChatReportPersistenceService(
            ChatMessageEvidenceRepository evidenceRepository,
            ChatReportRepository reportRepository,
            ChatModerationAuditRepository auditRepository,
            ChatModerationProperties properties,
            Clock clock) {
        this.evidenceRepository = evidenceRepository;
        this.reportRepository = reportRepository;
        this.auditRepository = auditRepository;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public boolean submit(
            UUID reporterId,
            UUID messageId,
            ChatReportReason reason,
            String note) {
        AppUser reporter = entityManager.find(AppUser.class, reporterId, LockModeType.PESSIMISTIC_WRITE);
        if (reporter == null || reporter.isGuest()
                || reportRepository.existsByReporterUserIdAndMessageId(reporterId, messageId)) {
            return false;
        }
        if (reportRepository.countByReporterUserIdAndStatus(reporterId, ChatReportStatus.OPEN)
                >= properties.getMaxOpenReportsPerUser()) {
            return false;
        }

        Instant now = Instant.now(clock);
        ChatMessageEvidence evidence = evidenceRepository.findById(messageId).orElse(null);
        if (evidence == null
                || !now.isBefore(evidence.getExpiresAt())
                || reporterId.equals(evidence.getSenderUserId())
                || !evidence.getRecipientUserIds().contains(reporterId)) {
            return false;
        }

        ChatReport report = new ChatReport(
                UUID.randomUUID(), reporterId, reporter.getUsername(), reason, note, now, evidence);
        reportRepository.saveAndFlush(report);
        auditRepository.save(new ChatModerationAudit(
                report.getReportId(), reporterId, reporter.getUsername(), "REPORT_SUBMITTED", now, "OPEN"));
        return true;
    }
}
