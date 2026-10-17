package com.example.botfight.repository;

import com.example.botfight.domain.auth.PasswordResetRequest;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

public interface PasswordResetRequestRepository extends JpaRepository<PasswordResetRequest, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<PasswordResetRequest> findByUserId(UUID userId);
}
