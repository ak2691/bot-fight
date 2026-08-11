package com.example.botfight.repository;

import com.example.botfight.domain.EmailVerification;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EmailVerificationRepository extends JpaRepository<EmailVerification, UUID> {

    Optional<EmailVerification> findByUserId(UUID userId);
}
