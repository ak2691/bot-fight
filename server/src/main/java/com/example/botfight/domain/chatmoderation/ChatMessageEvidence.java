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
@Table(name = "chat_message_evidence")
public class ChatMessageEvidence {

    @Id
    @Column(name = "message_id", nullable = false, updatable = false)
    private UUID messageId;

    @Enumerated(EnumType.STRING)
    @Column(name = "context_type", nullable = false, length = 24, updatable = false)
    private ChatContextType contextType;

    @Column(name = "context_id", nullable = false, updatable = false)
    private UUID contextId;

    @Column(name = "sender_user_id", nullable = false, updatable = false)
    private UUID senderUserId;

    @Column(name = "sender_username", nullable = false, length = 20, updatable = false)
    private String senderUsername;

    @Column(name = "sent_at", nullable = false, updatable = false)
    private Instant sentAt;

    @Column(name = "normalized_text", nullable = false, length = 280, updatable = false)
    private String normalizedText;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "moderation_metadata", length = 500)
    private String moderationMetadata;

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(
            name = "chat_message_evidence_recipients",
            joinColumns = @JoinColumn(name = "message_id"))
    @Column(name = "user_id", nullable = false)
    private Set<UUID> recipientUserIds = new LinkedHashSet<>();

    protected ChatMessageEvidence() {
    }

    public ChatMessageEvidence(
            UUID messageId,
            ChatContextType contextType,
            UUID contextId,
            UUID senderUserId,
            String senderUsername,
            Instant sentAt,
            String normalizedText,
            Instant expiresAt,
            Set<UUID> recipientUserIds) {
        this.messageId = messageId;
        this.contextType = contextType;
        this.contextId = contextId;
        this.senderUserId = senderUserId;
        this.senderUsername = senderUsername;
        this.sentAt = sentAt;
        this.normalizedText = normalizedText;
        this.expiresAt = expiresAt;
        this.recipientUserIds = new LinkedHashSet<>(recipientUserIds);
    }

    public UUID getMessageId() { return messageId; }
    public ChatContextType getContextType() { return contextType; }
    public UUID getContextId() { return contextId; }
    public UUID getSenderUserId() { return senderUserId; }
    public String getSenderUsername() { return senderUsername; }
    public Instant getSentAt() { return sentAt; }
    public String getNormalizedText() { return normalizedText; }
    public Instant getExpiresAt() { return expiresAt; }
    public String getModerationMetadata() { return moderationMetadata; }
    public Set<UUID> getRecipientUserIds() { return Set.copyOf(recipientUserIds); }
}
