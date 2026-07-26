package com.example.botfight.repository;

import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface MatchParticipantRepository
        extends JpaRepository<MatchParticipant, UUID>, JpaSpecificationExecutor<MatchParticipant> {

    List<MatchParticipant> findByUserIdOrderByCreatedAtDesc(UUID userId);

    long countByUserIdAndResult(UUID userId, MatchResult result);

    long countByUserIdAndResultIn(UUID userId, List<MatchResult> results);

    List<MatchParticipant> findByMatchId(UUID matchId);

    Optional<MatchParticipant> findByMatchIdAndUserId(UUID matchId, UUID userId);
}
