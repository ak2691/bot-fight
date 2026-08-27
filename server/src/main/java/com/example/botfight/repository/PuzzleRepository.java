package com.example.botfight.repository;

import com.example.botfight.domain.Puzzle;
import com.example.botfight.domain.PuzzleStatus;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PuzzleRepository extends JpaRepository<Puzzle, UUID> {

    Optional<Puzzle> findTopByOrderByPuzzleNumberDesc();

    Page<Puzzle> findByStatusOrderByPuzzleNumberAsc(PuzzleStatus status, Pageable pageable);

    @Query("""
            select p from Puzzle p
            where p.status = :status
              and (
                    lower(p.name) like lower(concat('%', :query, '%'))
                    or lower(p.description) like lower(concat('%', :query, '%'))
                    or (:puzzleNumber is not null and p.puzzleNumber = :puzzleNumber)
                  )
            """)
    Page<Puzzle> searchPublished(
            @Param("status") PuzzleStatus status,
            @Param("query") String query,
            @Param("puzzleNumber") Long puzzleNumber,
            Pageable pageable);

    Optional<Puzzle> findByPuzzleNumberAndStatus(Long puzzleNumber, PuzzleStatus status);

    Optional<Puzzle> findByPuzzleNumber(Long puzzleNumber);
}
