package com.example.botfight.DTO;

import com.example.botfight.DTO.ProfileDTO.RecentMatchDTO;
import java.util.List;

public record MatchHistoryPageDTO(
        List<RecentMatchDTO> matches,
        int page,
        int pageSize,
        boolean hasMore,
        long totalMatches) {
}
