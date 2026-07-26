package com.example.botfight.repository;

import com.example.botfight.domain.ModelSubmission;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ModelSubmissionRepository extends JpaRepository<ModelSubmission, UUID> {

    Optional<ModelSubmission> findByIdAndUserId(UUID id, UUID userId);

    Optional<ModelSubmission> findByUserIdAndTrainingSessionIdAndRequestFingerprintIsNotNull(
            UUID userId,
            String trainingSessionId);

}
