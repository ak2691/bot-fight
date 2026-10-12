package com.example.botfight.DTO.match;

public record MatchmakingJoinRequestDTO(
        String mode,
        // Queue pool is derived from the authenticated session; this field is
        // retained only so older clients can still deserialize their payload.
        Boolean ranked, MatchKitDTO kit) {
    public MatchmakingJoinRequestDTO(String mode, Boolean ranked) { this(mode, ranked, null); }
    public MatchmakingJoinRequestDTO(String mode) {
        this(mode, null, null);
    }
}
