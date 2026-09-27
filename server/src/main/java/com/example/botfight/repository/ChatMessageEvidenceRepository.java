package com.example.botfight.repository;

import com.example.botfight.domain.chatmoderation.ChatMessageEvidence;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChatMessageEvidenceRepository extends JpaRepository<ChatMessageEvidence, UUID> {
    List<ChatMessageEvidence> findByExpiresAtLessThanEqualOrderByExpiresAtAsc(Instant expiresAt, Pageable pageable);
}
