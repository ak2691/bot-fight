package com.example.botfight.DTO;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public class BotSubmissionPayloadDTO {

    private UUID matchId;
    private String architectureVersion;
    private String featureSchemaVersion;
    private String actionSchemaVersion;
    private String modelFormat;
    private String testingSessionId;
    private Integer testingDurationMs;
    private Integer testingSteps;
    private String selectedLoadout;
    private String baseModelArtifactId;
    private JsonNode testingMetrics;
    private String modelHash;
    private String clientBuildVersion;
    private JsonNode brain;
    private JsonNode model;

    public UUID getMatchId() {
        return matchId;
    }

    public void setMatchId(UUID matchId) {
        this.matchId = matchId;
    }

    public String getArchitectureVersion() {
        return architectureVersion;
    }

    public void setArchitectureVersion(String architectureVersion) {
        this.architectureVersion = architectureVersion;
    }

    public String getFeatureSchemaVersion() {
        return featureSchemaVersion;
    }

    public void setFeatureSchemaVersion(String featureSchemaVersion) {
        this.featureSchemaVersion = featureSchemaVersion;
    }

    public String getActionSchemaVersion() {
        return actionSchemaVersion;
    }

    public void setActionSchemaVersion(String actionSchemaVersion) {
        this.actionSchemaVersion = actionSchemaVersion;
    }

    public String getModelFormat() {
        return modelFormat;
    }

    public void setModelFormat(String modelFormat) {
        this.modelFormat = modelFormat;
    }

    public String getTestingSessionId() {
        return testingSessionId;
    }

    public void setTestingSessionId(String testingSessionId) {
        this.testingSessionId = testingSessionId;
    }

    public Integer getTestingDurationMs() {
        return testingDurationMs;
    }

    public void setTestingDurationMs(Integer testingDurationMs) {
        this.testingDurationMs = testingDurationMs;
    }

    public Integer getTestingSteps() {
        return testingSteps;
    }

    public void setTestingSteps(Integer testingSteps) {
        this.testingSteps = testingSteps;
    }

    public String getSelectedLoadout() {
        return selectedLoadout;
    }

    public void setSelectedLoadout(String selectedLoadout) {
        this.selectedLoadout = selectedLoadout;
    }

    public String getBaseModelArtifactId() {
        return baseModelArtifactId;
    }

    public void setBaseModelArtifactId(String baseModelArtifactId) {
        this.baseModelArtifactId = baseModelArtifactId;
    }

    public JsonNode getTestingMetrics() {
        return testingMetrics;
    }

    public void setTestingMetrics(JsonNode testingMetrics) {
        this.testingMetrics = testingMetrics;
    }

    public String getModelHash() {
        return modelHash;
    }

    public void setModelHash(String modelHash) {
        this.modelHash = modelHash;
    }

    public String getClientBuildVersion() {
        return clientBuildVersion;
    }

    public void setClientBuildVersion(String clientBuildVersion) {
        this.clientBuildVersion = clientBuildVersion;
    }

    public JsonNode getBrain() {
        return brain;
    }

    public void setBrain(JsonNode brain) {
        this.brain = brain;
    }

    public JsonNode getModel() {
        return model;
    }

    public void setModel(JsonNode model) {
        this.model = model;
    }
}
