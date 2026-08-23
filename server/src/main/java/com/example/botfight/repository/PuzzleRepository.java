package com.example.botfight.repository;

import com.example.botfight.domain.Puzzle;
import com.example.botfight.domain.PuzzleStatus;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PuzzleRepository extends JpaRepository<Puzzle, UUID> {

    Optional<Puzzle> findTopByOrderByPuzzleNumberDesc();

    Page<Puzzle> findByStatusOrderByPuzzleNumberAsc(PuzzleStatus status, Pageable pageable);

    Optional<Puzzle> findByPuzzleNumberAndStatus(Long puzzleNumber, PuzzleStatus status);
}
