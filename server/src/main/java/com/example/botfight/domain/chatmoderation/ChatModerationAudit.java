package com.example.botfight.domain.chatmoderation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "chat_moderation_audit")
public class ChatModerationAudit {

    @Id
    @Column(name = "audit_id", nullable = false, updatable = false)
    private UUID auditId;

    @Column(name = "report_id", nullable = false, updatable = false)
    private UUID reportId;

    @Column(name = "actor_user_id", updatable = false)
    private UUID actorUserId;

    @Column(name = "actor_username", length = 20, updatable = false)
    private String actorUsername;

    @Column(nullable = false, length = 32, updatable = false)
    private String action;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(length = 160, updatable = false)
    private String detail;

    protected ChatModerationAudit() {
    }

    public ChatModerationAudit(
            UUID reportId,
            UUID actorUserId,
            String actorUsername,
            String action,
            Instant createdAt,
            String detail) {
        this.auditId = UUID.randomUUID();
        this.reportId = reportId;
        this.actorUserId = actorUserId;
        this.actorUsername = actorUsername;
        this.action = action;
        this.createdAt = createdAt;
        this.detail = detail;
    }

    public UUID getAuditId() { return auditId; }
    public UUID getReportId() { return reportId; }
    public UUID getActorUserId() { return actorUserId; }
    public String getActorUsername() { return actorUsername; }
    public String getAction() { return action; }
    public Instant getCreatedAt() { return createdAt; }
    public String getDetail() { return detail; }
}
