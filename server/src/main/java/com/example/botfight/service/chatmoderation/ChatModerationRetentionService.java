package com.example.botfight.service.chatmoderation;

import com.example.botfight.config.ChatModerationProperties;
import com.example.botfight.domain.chatmoderation.ChatMessageEvidence;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import com.example.botfight.repository.ChatMessageEvidenceRepository;
import com.example.botfight.repository.ChatReportRepository;
import java.time.Clock;
import java.time.Instant;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Applies separate short evidence and longer resolved-report retention clocks. */
@Service
public class ChatModerationRetentionService {
    private final ChatMessageEvidenceRepository evidenceRepository;
    private final ChatReportRepository reportRepository;
    private final ChatReportAdminService adminService;
    private final ChatModerationProperties properties;
    private final Clock clock;

    public ChatModerationRetentionService(
            ChatMessageEvidenceRepository evidenceRepository,
            ChatReportRepository reportRepository,
            ChatReportAdminService adminService,
            ChatModerationProperties properties,
            Clock clock) {
        this.evidenceRepository = evidenceRepository;
        this.reportRepository = reportRepository;
        this.adminService = adminService;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${botfight.chat-moderation.cleanup-delay-ms:3600000}")
    @Transactional
    public void cleanupExpiredRecords() {
        Instant now = Instant.now(clock);
        removeExpiredEvidence(now);
        adminService.purgeResolvedBefore(now.minus(properties.getResolvedReportRetention()));
    }

    @Transactional
    public int removeExpiredEvidence(Instant now) {
        var expired = evidenceRepository.findByExpiresAtLessThanEqualOrderByExpiresAtAsc(
                now, PageRequest.of(0, 500));
        int deleted = 0;
        for (ChatMessageEvidence evidence : expired) {
            if (reportRepository.existsByMessageIdAndStatus(evidence.getMessageId(), ChatReportStatus.OPEN)) {
                continue;
            }
            evidenceRepository.delete(evidence);
            deleted++;
        }
        return deleted;
    }
}
