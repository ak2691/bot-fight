package com.example.botfight.DTO.party;

import java.util.UUID;

public record PartyMemberDTO(
        UUID userId,
        String username,
        int slot,
        boolean leader,
        boolean online,
        boolean guest) {

    public PartyMemberDTO(UUID userId, String username, int slot, boolean leader, boolean online) {
        this(userId, username, slot, leader, online, false);
    }
}
