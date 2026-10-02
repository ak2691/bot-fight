package com.example.botfight.DTO.profile;

import java.util.List;

public record ProfileSearchPageDTO(
        List<ProfileSearchResultDTO> profiles,
        int page,
        int pageSize,
        boolean hasMore,
        long totalProfiles) {

    /** elo is the 1v1 rating (default 1000); onesMatches counts 1v1 results only; joinedAt lets joinedAt let the result row show a summary line. */
    public record ProfileSearchResultDTO(
            String username,
            Integer elo,
            long onesMatches,
            java.time.Instant joinedAt) {
    }
}
