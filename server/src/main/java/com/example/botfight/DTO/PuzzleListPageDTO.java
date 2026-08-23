package com.example.botfight.DTO;

import java.util.List;

public record PuzzleListPageDTO(
        List<PuzzleListItemDTO> puzzles,
        int page,
        int pageSize,
        boolean hasNext,
        long totalElements) {
}
