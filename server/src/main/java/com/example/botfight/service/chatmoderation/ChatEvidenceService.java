package com.example.botfight.service.chatmoderation;

import com.example.botfight.config.ChatModerationProperties;
import com.example.botfight.domain.chatmoderation.ChatContextType;
import com.example.botfight.domain.chatmoderation.ChatMessageEvidence;
import com.example.botfight.repository.ChatMessageEvidenceRepository;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Persists only server-accepted, normalized chat messages and their delivery roster. */
@Service
public class ChatEvidenceService implements ChatEvidenceRecorder {

    private final ChatMessageEvidenceRepository evidenceRepository;
    private final ChatModerationProperties properties;

    public ChatEvidenceService(
            ChatMessageEvidenceRepository evidenceRepository,
            ChatModerationProperties properties) {
        this.evidenceRepository = evidenceRepository;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public Optional<UUID> reportableSender(UUID reporterId, UUID messageId, Instant now) {
        ChatMessageEvidence evidence = evidenceRepository.findById(messageId).orElse(null);
        if (evidence == null
                || !now.isBefore(evidence.getExpiresAt())
                || reporterId == null
                || reporterId.equals(evidence.getSenderUserId())
                || !evidence.getRecipientUserIds().contains(reporterId)) {
            return Optional.empty();
        }
        return Optional.of(evidence.getSenderUserId());
    }

    @Override
    @Transactional
    public void capture(
            UUID messageId,
            ChatContextType contextType,
            UUID contextId,
            UUID senderUserId,
            String senderUsername,
            Instant sentAt,
            String normalizedText,
            Collection<UUID> recipientUserIds) {
        if (messageId == null || contextType == null || contextId == null || senderUserId == null
                || senderUsername == null || sentAt == null || normalizedText == null) {
            throw new IllegalArgumentException("accepted chat evidence is incomplete");
        }
        if (senderUsername.isBlank()
                || senderUsername.codePointCount(0, senderUsername.length()) > 20
                || normalizedText.isBlank()
                || !normalizedText.equals(normalizedText.strip())
                || normalizedText.codePointCount(0, normalizedText.length()) > 280
                || normalizedText.codePoints().anyMatch(Character::isISOControl)
                || properties.getEvidenceRetention() == null
                || properties.getEvidenceRetention().isNegative()
                || properties.getEvidenceRetention().isZero()) {
            throw new IllegalArgumentException("accepted chat evidence is not normalized or bounded");
        }
        Set<UUID> recipients = new LinkedHashSet<>();
        if (recipientUserIds != null) {
            recipientUserIds.stream().filter(java.util.Objects::nonNull).forEach(recipients::add);
        }
        if (recipients.size() > 16) {
            throw new IllegalArgumentException("chat delivery roster exceeds the evidence limit");
        }
        evidenceRepository.save(new ChatMessageEvidence(
                messageId,
                contextType,
                contextId,
                senderUserId,
                senderUsername,
                sentAt,
                normalizedText,
                sentAt.plus(properties.getEvidenceRetention()),
                recipients));
    }
}
