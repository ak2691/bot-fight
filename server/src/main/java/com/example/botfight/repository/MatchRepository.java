package com.example.botfight.repository;

import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MatchRepository extends JpaRepository<Match, UUID> {

    List<Match> findByStatusOrderByCreatedAtAsc(MatchStatus status);
}
