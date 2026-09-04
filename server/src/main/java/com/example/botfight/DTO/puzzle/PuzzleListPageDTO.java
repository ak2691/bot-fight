package com.example.botfight.DTO.puzzle;

import java.util.List;

public record PuzzleListPageDTO(
        List<PuzzleListItemDTO> puzzles,
        int page,
        int pageSize,
        boolean hasNext,
        long totalElements) {
}
