package com.example.botfight.repository;

import com.example.botfight.domain.auth.EmailVerification;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

public interface EmailVerificationRepository extends JpaRepository<EmailVerification, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<EmailVerification> findByUserId(UUID userId);
}
