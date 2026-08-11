package com.example.botfight.repository;

import com.example.botfight.domain.BuildingSession;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BuildingSessionRepository extends JpaRepository<BuildingSession, UUID> {

    Optional<BuildingSession> findByIdAndUserId(UUID id, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from BuildingSession session "
            + "where session.id = :id and session.user.id = :userId")
    Optional<BuildingSession> findByIdAndUserIdForSubmission(
            @Param("id") UUID id,
            @Param("userId") UUID userId);
}
