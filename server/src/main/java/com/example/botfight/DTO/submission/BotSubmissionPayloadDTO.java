package com.example.botfight.DTO.submission;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** Hostile-input boundary for a deterministic structured bot brain submission. */
public class BotSubmissionPayloadDTO {
    private UUID matchId;
    private Integer roundNumber;
    private String phase;
    private String selectedLoadout;
    private String clientBuildVersion;
    private JsonNode brain;

    public UUID getMatchId() { return matchId; }
    public void setMatchId(UUID matchId) { this.matchId = matchId; }
    public Integer getRoundNumber() { return roundNumber; }
    public void setRoundNumber(Integer roundNumber) { this.roundNumber = roundNumber; }
    public String getPhase() { return phase; }
    public void setPhase(String phase) { this.phase = phase; }
    public String getSelectedLoadout() { return selectedLoadout; }
    public void setSelectedLoadout(String selectedLoadout) { this.selectedLoadout = selectedLoadout; }
    public String getClientBuildVersion() { return clientBuildVersion; }
    public void setClientBuildVersion(String clientBuildVersion) { this.clientBuildVersion = clientBuildVersion; }
    public JsonNode getBrain() { return brain; }
    public void setBrain(JsonNode brain) { this.brain = brain; }
}
