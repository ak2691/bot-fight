package com.example.botfight.DTO.match;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public record MatchAbilityGuaranteeResponseDTO(List<Integer> guaranteedAbilityIds) {

    public MatchAbilityGuaranteeResponseDTO {
        guaranteedAbilityIds = guaranteedAbilityIds == null
                ? List.of()
                : java.util.Collections.unmodifiableList(new ArrayList<>(guaranteedAbilityIds));
    }

    public static MatchAbilityGuaranteeResponseDTO from(Map<Integer, Integer> guarantees) {
        List<Integer> slots = new ArrayList<>(3);
        for (int round = 1; round <= 3; round++) {
            slots.add(guarantees == null ? null : guarantees.get(round));
        }
        return new MatchAbilityGuaranteeResponseDTO(
                java.util.Collections.unmodifiableList(slots));
    }
}
