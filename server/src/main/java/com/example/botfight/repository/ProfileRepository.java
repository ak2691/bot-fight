package com.example.botfight.repository;

import com.example.botfight.domain.Profile;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProfileRepository extends JpaRepository<Profile, UUID> {

    Optional<Profile> findByUserId(UUID userId);
}
