package com.example.botfight.repository;

import com.example.botfight.domain.PuzzleCompletion;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PuzzleCompletionRepository extends JpaRepository<PuzzleCompletion, UUID> {

    long countByUserId(UUID userId);

    @Modifying
    @Query(value = "INSERT INTO puzzle_completions (id, user_id, puzzle_id, solved_at) "
            + "VALUES (gen_random_uuid(), :userId, :puzzleId, now()) "
            + "ON CONFLICT (user_id, puzzle_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("puzzleId") UUID puzzleId);

    List<PuzzleCompletion> findByUserIdAndPuzzleIdIn(UUID userId, Collection<UUID> puzzleIds);

    Page<PuzzleCompletion> findByUserId(UUID userId, Pageable pageable);
}
