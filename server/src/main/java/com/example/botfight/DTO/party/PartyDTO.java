package com.example.botfight.DTO.party;

import java.util.List;
import java.util.UUID;

public record PartyDTO(
        UUID partyId,
        String ownerUsername,
        int capacity,
        List<PartyMemberDTO> members) {
}
