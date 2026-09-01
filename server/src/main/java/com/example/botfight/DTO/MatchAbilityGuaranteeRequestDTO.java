package com.example.botfight.DTO;

import java.util.List;

public record MatchAbilityGuaranteeRequestDTO(List<Integer> guaranteedAbilityIds) {
    public MatchAbilityGuaranteeRequestDTO() {
        this(List.of());
    }
}
