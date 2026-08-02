package com.example.botfight.DTO;

import java.time.Instant;
import java.util.UUID;

public class TestingSessionResponseDTO {

    private UUID testingSessionId;
    private UUID matchId;
    private Instant startedAt;
    private Long testingDurationMs;
    private boolean trusted;
    private String message;

    public UUID getTestingSessionId() {
        return testingSessionId;
    }

    public void setTestingSessionId(UUID testingSessionId) {
        this.testingSessionId = testingSessionId;
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

    public Long getTestingDurationMs() {
        return testingDurationMs;
    }

    public void setTestingDurationMs(Long testingDurationMs) {
        this.testingDurationMs = testingDurationMs;
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
