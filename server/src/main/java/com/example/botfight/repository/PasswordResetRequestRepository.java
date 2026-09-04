package com.example.botfight.repository;

import com.example.botfight.domain.auth.PasswordResetRequest;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PasswordResetRequestRepository extends JpaRepository<PasswordResetRequest, UUID> {

    Optional<PasswordResetRequest> findByUserId(UUID userId);
}
