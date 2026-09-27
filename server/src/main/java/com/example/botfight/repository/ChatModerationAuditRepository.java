package com.example.botfight.repository;

import com.example.botfight.domain.chatmoderation.ChatModerationAudit;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChatModerationAuditRepository extends JpaRepository<ChatModerationAudit, UUID> {
    List<ChatModerationAudit> findByReportIdOrderByCreatedAtAsc(UUID reportId);
}
