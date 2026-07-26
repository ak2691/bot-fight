package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public class TrainingSessionResponseDTO {

    private UUID trainingSessionId;
    private UUID matchId;
    private Instant startedAt;
    private Long trainingDurationMs;
    private boolean trusted;
    private String message;

    public UUID getTrainingSessionId() {
        return trainingSessionId;
    }

    public void setTrainingSessionId(UUID trainingSessionId) {
        this.trainingSessionId = trainingSessionId;
    }

    public UUID getMatchId() {
        return matchId;
    }

    public void setMatchId(UUID matchId) {
        this.matchId = matchId;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Long getTrainingDurationMs() {
        return trainingDurationMs;
    }

    public void setTrainingDurationMs(Long trainingDurationMs) {
        this.trainingDurationMs = trainingDurationMs;
    }

    public boolean isTrusted() {
        return trusted;
    }

    public void setTrusted(boolean trusted) {
        this.trusted = trusted;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
