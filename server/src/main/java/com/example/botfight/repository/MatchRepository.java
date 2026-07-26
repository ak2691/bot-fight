package com.example.botfight.repository;

import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MatchRepository extends JpaRepository<Match, UUID> {

    List<Match> findByStatusOrderByCreatedAtAsc(MatchStatus status);
}
