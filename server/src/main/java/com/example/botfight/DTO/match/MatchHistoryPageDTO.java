package com.example.botfight.DTO.match;

import com.example.botfight.DTO.profile.ProfileDTO.RecentMatchDTO;
import java.util.List;

public record MatchHistoryPageDTO(
        List<RecentMatchDTO> matches,
        int page,
        int pageSize,
        boolean hasMore,
        long totalMatches) {
}
