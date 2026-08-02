package com.example.botfight.repository;

import com.example.botfight.domain.ValidationResult;
import com.example.botfight.domain.ValidationStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ValidationResultRepository extends JpaRepository<ValidationResult, UUID> {

    List<ValidationResult> findByBotSubmissionIdOrderByCreatedAtDesc(UUID botSubmissionId);

    List<ValidationResult> findByStatusOrderByCreatedAtAsc(ValidationStatus status);
}
