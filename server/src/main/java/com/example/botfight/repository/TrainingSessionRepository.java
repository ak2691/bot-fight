package com.example.botfight.repository;

import com.example.botfight.domain.TrainingSession;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TrainingSessionRepository extends JpaRepository<TrainingSession, UUID> {

    Optional<TrainingSession> findByIdAndUserId(UUID id, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from TrainingSession session "
            + "where session.id = :id and session.user.id = :userId")
    Optional<TrainingSession> findByIdAndUserIdForSubmission(
            @Param("id") UUID id,
            @Param("userId") UUID userId);
}
