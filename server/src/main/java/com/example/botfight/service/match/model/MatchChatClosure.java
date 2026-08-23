package com.example.botfight.service.match.model;

import java.util.List;
import java.util.UUID;

public record MatchChatClosure(
        UUID matchId,
        String message,
        List<String> recipientPrincipalNames) {
}
