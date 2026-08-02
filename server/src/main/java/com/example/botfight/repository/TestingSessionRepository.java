package com.example.botfight.repository;

import com.example.botfight.domain.TestingSession;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TestingSessionRepository extends JpaRepository<TestingSession, UUID> {

    Optional<TestingSession> findByIdAndUserId(UUID id, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from TestingSession session "
            + "where session.id = :id and session.user.id = :userId")
    Optional<TestingSession> findByIdAndUserIdForSubmission(
            @Param("id") UUID id,
            @Param("userId") UUID userId);
}
