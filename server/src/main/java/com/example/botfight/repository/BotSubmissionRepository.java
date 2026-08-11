package com.example.botfight.repository;

import com.example.botfight.domain.BotSubmission;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BotSubmissionRepository extends JpaRepository<BotSubmission, UUID> {

    Optional<BotSubmission> findByIdAndUserId(UUID id, UUID userId);

    Optional<BotSubmission> findByUserIdAndBuildingSessionIdAndRequestFingerprintIsNotNull(
            UUID userId,
            String buildingSessionId);

}
