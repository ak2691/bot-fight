package com.example.botfight.repository;

import com.example.botfight.domain.match.MatchRoundBotCode;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MatchRoundBotCodeRepository extends JpaRepository<MatchRoundBotCode, UUID> {

    List<MatchRoundBotCode> findByMatchIdOrderByRoundNumberAscUserIdAsc(UUID matchId);

    List<MatchRoundBotCode> findByMatchIdAndUserIdOrderByRoundNumberAsc(UUID matchId, UUID userId);
}
