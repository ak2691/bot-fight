package com.example.botfight.service.chatmoderation;

import com.example.botfight.DTO.chatmoderation.ChatModerationAuditDTO;
import com.example.botfight.DTO.chatmoderation.ChatReportDetailDTO;
import com.example.botfight.DTO.chatmoderation.ChatReportSummaryDTO;
import com.example.botfight.config.ChatModerationProperties;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.auth.UserRole;
import com.example.botfight.domain.chatmoderation.ChatModerationAudit;
import com.example.botfight.domain.chatmoderation.ChatReport;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import com.example.botfight.repository.ChatModerationAuditRepository;
import com.example.botfight.repository.ChatReportRepository;
import com.example.botfight.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Admin-only report review operations with a durable, content-free action trail. */
@Service
public class ChatReportAdminService {
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_PAGE_INDEX = 10_000;

    private final UserRepository userRepository;
    private final ChatReportRepository reportRepository;
    private final ChatModerationAuditRepository auditRepository;
    private final Clock clock;

    public ChatReportAdminService(
            UserRepository userRepository,
            ChatReportRepository reportRepository,
            ChatModerationAuditRepository auditRepository,
            Clock clock) {
        this.userRepository = userRepository;
        this.reportRepository = reportRepository;
        this.auditRepository = auditRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<ChatReportSummaryDTO> list(UUID actorId, ChatReportStatus status, int page, int size) {
        requireAdmin(actorId);
        Pageable pageable = PageRequest.of(
                Math.max(0, Math.min(page, MAX_PAGE_INDEX)),
                Math.max(1, Math.min(size, MAX_PAGE_SIZE)));
        return reportRepository.findForAdmin(status, pageable).map(ChatReportAdminService::summary);
    }

    @Transactional(readOnly = true)
    public ChatReportDetailDTO detail(UUID actorId, UUID reportId) {
        requireAdmin(actorId);
        return detail(reportRepository.findById(reportId).orElseThrow(ChatReportNotFoundException::new));
    }

    @Transactional(readOnly = true)
    public List<ChatModerationAuditDTO> audit(UUID actorId, UUID reportId) {
        requireAdmin(actorId);
        if (!reportRepository.existsById(reportId)
                && auditRepository.findByReportIdOrderByCreatedAtAsc(reportId).isEmpty()) {
            throw new ChatReportNotFoundException();
        }
        return auditRepository.findByReportIdOrderByCreatedAtAsc(reportId).stream()
                .map(ChatReportAdminService::auditDTO)
                .toList();
    }

    @Transactional
    public ChatReportDetailDTO resolve(
            UUID actorId,
            UUID reportId,
            ChatReportStatus status,
            String rawNote) {
        AppUser admin = requireAdmin(actorId);
        if (status == null || status == ChatReportStatus.OPEN) {
            throw new ChatReportValidationException("Choose a terminal report status.");
        }
        String note = ChatReportService.normalizeNote(rawNote, 500);
        ChatReport report = reportRepository.findById(reportId).orElseThrow(ChatReportNotFoundException::new);
        if (report.getStatus() != ChatReportStatus.OPEN) {
            throw new ChatReportConflictException("Only open reports can be resolved.");
        }
        Instant now = Instant.now(clock);
        report.resolve(status, admin.getId(), admin.getUsername(), note, now);
        auditRepository.save(new ChatModerationAudit(
                reportId, admin.getId(), admin.getUsername(), "REPORT_RESOLVED", now, status.name()));
        return detail(report);
    }

    @Transactional
    public void delete(UUID actorId, UUID reportId) {
        AppUser admin = requireAdmin(actorId);
        ChatReport report = reportRepository.findById(reportId).orElseThrow(ChatReportNotFoundException::new);
        if (report.getStatus() == ChatReportStatus.OPEN) {
            throw new ChatReportConflictException("Resolve an open report before deleting it.");
        }
        Instant now = Instant.now(clock);
        auditRepository.save(new ChatModerationAudit(
                reportId,
                admin.getId(),
                admin.getUsername(),
                "REPORT_DELETED",
                now,
                report.getStatus().name()));
        reportRepository.delete(report);
    }

    @Transactional
    public int purgeResolvedBefore(Instant cutoff) {
        List<ChatReport> expired = reportRepository.findByStatusNotAndResolvedAtLessThanEqualOrderByResolvedAtAsc(
                ChatReportStatus.OPEN, cutoff, PageRequest.of(0, 100));
        Instant now = Instant.now(clock);
        for (ChatReport report : expired) {
            auditRepository.save(new ChatModerationAudit(
                    report.getReportId(), null, null, "REPORT_RETENTION_PURGED", now, report.getStatus().name()));
            reportRepository.delete(report);
        }
        return expired.size();
    }

    private AppUser requireAdmin(UUID actorId) {
        AppUser actor = actorId == null ? null : userRepository.findById(actorId).orElse(null);
        if (actor == null || actor.getRole() != UserRole.ADMIN || actor.isGuest()) {
            throw new AccessDeniedException("admin role is required");
        }
        return actor;
    }

    private static ChatReportSummaryDTO summary(ChatReport report) {
        return new ChatReportSummaryDTO(
                report.getReportId(),
                report.getMessageId(),
                report.getReporterUserId(),
                report.getReporterUsername(),
                report.getEvidenceSenderUsername(),
                report.getEvidenceContextType(),
                report.getEvidenceContextId(),
                report.getReason(),
                report.getStatus(),
                report.getCreatedAt(),
                report.getUpdatedAt(),
                report.getResolvedAt());
    }

    private static ChatReportDetailDTO detail(ChatReport report) {
        return new ChatReportDetailDTO(
                report.getReportId(),
                report.getMessageId(),
                report.getReporterUserId(),
                report.getReporterUsername(),
                report.getReason(),
                report.getNote(),
                report.getStatus(),
                report.getCreatedAt(),
                report.getUpdatedAt(),
                report.getResolvedAt(),
                report.getResolverUserId(),
                report.getResolverUsername(),
                report.getResolutionNote(),
                report.getEvidenceContextType(),
                report.getEvidenceContextId(),
                report.getEvidenceSenderUserId(),
                report.getEvidenceSenderUsername(),
                report.getEvidenceSentAt(),
                report.getEvidenceText(),
                report.getEvidenceRecipientUserIds());
    }

    private static ChatModerationAuditDTO auditDTO(ChatModerationAudit audit) {
        return new ChatModerationAuditDTO(
                audit.getAuditId(),
                audit.getReportId(),
                audit.getActorUserId(),
                audit.getActorUsername(),
                audit.getAction(),
                audit.getCreatedAt(),
                audit.getDetail());
    }
}
