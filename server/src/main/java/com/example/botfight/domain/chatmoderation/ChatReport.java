package com.example.botfight.domain.chatmoderation;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "chat_reports")
public class ChatReport {

    @Id
    @Column(name = "report_id", nullable = false, updatable = false)
    private UUID reportId;

    @Column(name = "reporter_user_id", nullable = false, updatable = false)
    private UUID reporterUserId;

    @Column(name = "reporter_username", nullable = false, length = 20, updatable = false)
    private String reporterUsername;

    @Column(name = "message_id", nullable = false, updatable = false)
    private UUID messageId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32, updatable = false)
    private ChatReportReason reason;

    @Column(name = "report_note", length = 300, updatable = false)
    private String note;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ChatReportStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Column(name = "resolver_user_id")
    private UUID resolverUserId;

    @Column(name = "resolver_username", length = 20)
    private String resolverUsername;

    @Column(name = "resolution_note", length = 500)
    private String resolutionNote;

    @Enumerated(EnumType.STRING)
    @Column(name = "evidence_context_type", nullable = false, length = 24, updatable = false)
    private ChatContextType evidenceContextType;

    @Column(name = "evidence_context_id", nullable = false, updatable = false)
    private UUID evidenceContextId;

    @Column(name = "evidence_sender_user_id", nullable = false, updatable = false)
    private UUID evidenceSenderUserId;

    @Column(name = "evidence_sender_username", nullable = false, length = 20, updatable = false)
    private String evidenceSenderUsername;

    @Column(name = "evidence_sent_at", nullable = false, updatable = false)
    private Instant evidenceSentAt;

    @Column(name = "evidence_text", nullable = false, length = 280, updatable = false)
    private String evidenceText;

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(
            name = "chat_report_recipients",
            joinColumns = @JoinColumn(name = "report_id"))
    @Column(name = "user_id", nullable = false)
    private Set<UUID> evidenceRecipientUserIds = new LinkedHashSet<>();

    protected ChatReport() {
    }

    public ChatReport(
            UUID reportId,
            UUID reporterUserId,
            String reporterUsername,
            ChatReportReason reason,
            String note,
            Instant createdAt,
            ChatMessageEvidence evidence) {
        this.reportId = reportId;
        this.reporterUserId = reporterUserId;
        this.reporterUsername = reporterUsername;
        this.messageId = evidence.getMessageId();
        this.reason = reason;
        this.note = note;
        this.status = ChatReportStatus.OPEN;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
        this.evidenceContextType = evidence.getContextType();
        this.evidenceContextId = evidence.getContextId();
        this.evidenceSenderUserId = evidence.getSenderUserId();
        this.evidenceSenderUsername = evidence.getSenderUsername();
        this.evidenceSentAt = evidence.getSentAt();
        this.evidenceText = evidence.getNormalizedText();
        this.evidenceRecipientUserIds = new LinkedHashSet<>(evidence.getRecipientUserIds());
    }

    public void resolve(
            ChatReportStatus status,
            UUID adminUserId,
            String adminUsername,
            String note,
            Instant now) {
        this.status = status;
        this.resolverUserId = adminUserId;
        this.resolverUsername = adminUsername;
        this.resolutionNote = note;
        this.resolvedAt = now;
        this.updatedAt = now;
    }

    public UUID getReportId() { return reportId; }
    public UUID getReporterUserId() { return reporterUserId; }
    public String getReporterUsername() { return reporterUsername; }
    public UUID getMessageId() { return messageId; }
    public ChatReportReason getReason() { return reason; }
    public String getNote() { return note; }
    public ChatReportStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getResolvedAt() { return resolvedAt; }
    public UUID getResolverUserId() { return resolverUserId; }
    public String getResolverUsername() { return resolverUsername; }
    public String getResolutionNote() { return resolutionNote; }
    public ChatContextType getEvidenceContextType() { return evidenceContextType; }
    public UUID getEvidenceContextId() { return evidenceContextId; }
    public UUID getEvidenceSenderUserId() { return evidenceSenderUserId; }
    public String getEvidenceSenderUsername() { return evidenceSenderUsername; }
    public Instant getEvidenceSentAt() { return evidenceSentAt; }
    public String getEvidenceText() { return evidenceText; }
    public Set<UUID> getEvidenceRecipientUserIds() { return Set.copyOf(evidenceRecipientUserIds); }
}
