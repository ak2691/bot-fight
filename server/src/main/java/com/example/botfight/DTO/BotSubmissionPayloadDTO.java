package com.example.botfight.DTO;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** Hostile-input boundary for a deterministic structured bot brain submission. */
public class BotSubmissionPayloadDTO {
    private UUID matchId;
    private String buildingSessionId;
    private String selectedLoadout;
    private String clientBuildVersion;
    private JsonNode brain;

    public UUID getMatchId() { return matchId; }
    public void setMatchId(UUID matchId) { this.matchId = matchId; }
    public String getBuildingSessionId() { return buildingSessionId; }
    public void setBuildingSessionId(String buildingSessionId) { this.buildingSessionId = buildingSessionId; }
    public String getSelectedLoadout() { return selectedLoadout; }
    public void setSelectedLoadout(String selectedLoadout) { this.selectedLoadout = selectedLoadout; }
    public String getClientBuildVersion() { return clientBuildVersion; }
    public void setClientBuildVersion(String clientBuildVersion) { this.clientBuildVersion = clientBuildVersion; }
    public JsonNode getBrain() { return brain; }
    public void setBrain(JsonNode brain) { this.brain = brain; }
}
