package com.example.botfight.service.match.state;

import com.example.botfight.domain.BotSubmission;
import java.util.Map;
import java.util.UUID;

public record RoundSubmissionRecord(
        int roundNumber,
        UUID winnerUserId,
        Map<UUID, BotSubmission> submissionsByUser,
        Map<UUID, Double> lossScores) {
}
