package com.example.botfight.repository;

import com.example.botfight.domain.chatmoderation.ChatReport;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ChatReportRepository extends JpaRepository<ChatReport, UUID> {
    boolean existsByReporterUserIdAndMessageId(UUID reporterUserId, UUID messageId);

    long countByReporterUserIdAndStatus(UUID reporterUserId, ChatReportStatus status);

    boolean existsByMessageIdAndStatus(UUID messageId, ChatReportStatus status);

    @Query("""
            select report from ChatReport report
            where (:status is null or report.status = :status)
            order by report.createdAt desc
            """)
    Page<ChatReport> findForAdmin(@Param("status") ChatReportStatus status, Pageable pageable);

    List<ChatReport> findByStatusNotAndResolvedAtLessThanEqualOrderByResolvedAtAsc(
            ChatReportStatus status,
            Instant resolvedAt,
            Pageable pageable);
}
