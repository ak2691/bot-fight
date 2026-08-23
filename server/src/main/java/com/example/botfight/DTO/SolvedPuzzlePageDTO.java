package com.example.botfight.DTO;

import java.time.Instant;
import java.util.List;

public record SolvedPuzzlePageDTO(
        List<SolvedPuzzleDTO> puzzles,
        int page,
        int pageSize,
        boolean hasMore,
        long totalPuzzles) {

    public record SolvedPuzzleDTO(
            long puzzleNumber,
            String name,
            Instant solvedAt) {
    }
}
