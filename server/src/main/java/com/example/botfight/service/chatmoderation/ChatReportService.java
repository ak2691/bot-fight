package com.example.botfight.service.chatmoderation;

import com.example.botfight.DTO.chatmoderation.ChatReportAcknowledgementDTO;
import com.example.botfight.domain.chatmoderation.ChatReportReason;
import com.example.botfight.repository.ChatReportRepository;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/** Public report API deliberately has a single generic acknowledgement shape. */
@Service
public class ChatReportService {

    private final ChatReportRepository reportRepository;
    private final ChatReportPersistenceService persistenceService;
    private final ChatEvidenceService evidenceService;
    private final TokenBucketRateLimiter<UUID> reporterRateLimiter;
    private final TokenBucketRateLimiter<String> targetRateLimiter;
    private final Clock clock;

    public ChatReportService(
            ChatReportRepository reportRepository,
            ChatReportPersistenceService persistenceService,
            ChatEvidenceService evidenceService,
            @Qualifier("chatReportReporterRateLimiter") TokenBucketRateLimiter<UUID> reporterRateLimiter,
            @Qualifier("chatReportTargetRateLimiter") TokenBucketRateLimiter<String> targetRateLimiter,
            Clock clock) {
        this.reportRepository = reportRepository;
        this.persistenceService = persistenceService;
        this.evidenceService = evidenceService;
        this.reporterRateLimiter = reporterRateLimiter;
        this.targetRateLimiter = targetRateLimiter;
        this.clock = clock;
    }

    public ChatReportAcknowledgementDTO report(
            UUID reporterId,
            UUID messageId,
            ChatReportReason reason,
            String rawNote) {
        if (reporterId == null || messageId == null || reason == null) {
            throw new ChatReportValidationException("Choose a report reason.");
        }
        String note = normalizeNote(rawNote, 300);

        // Repeated clicks stay idempotent even after the reporter exhausts the request buckets.
        if (reportRepository.existsByReporterUserIdAndMessageId(reporterId, messageId)) {
            return ChatReportAcknowledgementDTO.generic();
        }
        try {
            reporterRateLimiter.requireAllowed(reporterId);
            var reportedSender = evidenceService.reportableSender(reporterId, messageId, Instant.now(clock));
            if (reportedSender.isEmpty()) {
                return ChatReportAcknowledgementDTO.generic();
            }
            targetRateLimiter.requireAllowed(reporterId + ":" + reportedSender.get());
        } catch (RateLimitExceededException exception) {
            return ChatReportAcknowledgementDTO.generic();
        }
        try {
            persistenceService.submit(reporterId, messageId, reason, note);
        } catch (DataIntegrityViolationException exception) {
            // The unique reporter/message constraint arbitrates a concurrent duplicate.
        }
        return ChatReportAcknowledgementDTO.generic();
    }

    static String normalizeNote(String rawNote, int maxCodePoints) {
        String note = rawNote == null ? "" : rawNote.strip();
        if (note.isEmpty()) return null;
        if (note.codePointCount(0, note.length()) > maxCodePoints
                || note.codePoints().anyMatch(Character::isISOControl)) {
            throw new ChatReportValidationException("Note was not accepted.");
        }
        return note;
    }
}
