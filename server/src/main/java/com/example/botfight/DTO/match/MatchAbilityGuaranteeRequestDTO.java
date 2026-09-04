package com.example.botfight.DTO.match;

import java.util.List;

public record MatchAbilityGuaranteeRequestDTO(List<Integer> guaranteedAbilityIds) {
    public MatchAbilityGuaranteeRequestDTO() {
        this(List.of());
    }
}
