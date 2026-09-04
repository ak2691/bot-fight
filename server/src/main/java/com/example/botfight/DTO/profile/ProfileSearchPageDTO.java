package com.example.botfight.DTO.profile;

import java.util.List;

public record ProfileSearchPageDTO(
        List<ProfileSearchResultDTO> profiles,
        int page,
        int pageSize,
        boolean hasMore,
        long totalProfiles) {

    public record ProfileSearchResultDTO(String username) {
    }
}
