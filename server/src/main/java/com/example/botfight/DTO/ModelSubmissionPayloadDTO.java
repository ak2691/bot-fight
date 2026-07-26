package com.example.botfight.DTO;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public class ModelSubmissionPayloadDTO {

    private UUID matchId;
    private String architectureVersion;
    private String featureSchemaVersion;
    private String actionSchemaVersion;
    private String modelFormat;
    private String trainingSessionId;
    private Integer trainingDurationMs;
    private Integer trainingSteps;
    private String selectedClass;
    private String baseModelArtifactId;
    private JsonNode trainingMetrics;
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

    public String getTrainingSessionId() {
        return trainingSessionId;
    }

    public void setTrainingSessionId(String trainingSessionId) {
        this.trainingSessionId = trainingSessionId;
    }

    public Integer getTrainingDurationMs() {
        return trainingDurationMs;
    }

    public void setTrainingDurationMs(Integer trainingDurationMs) {
        this.trainingDurationMs = trainingDurationMs;
    }

    public Integer getTrainingSteps() {
        return trainingSteps;
    }

    public void setTrainingSteps(Integer trainingSteps) {
        this.trainingSteps = trainingSteps;
    }

    public String getSelectedClass() {
        return selectedClass;
    }

    public void setSelectedClass(String selectedClass) {
        this.selectedClass = selectedClass;
    }

    public String getBaseModelArtifactId() {
        return baseModelArtifactId;
    }

    public void setBaseModelArtifactId(String baseModelArtifactId) {
        this.baseModelArtifactId = baseModelArtifactId;
    }

    public JsonNode getTrainingMetrics() {
        return trainingMetrics;
    }

    public void setTrainingMetrics(JsonNode trainingMetrics) {
        this.trainingMetrics = trainingMetrics;
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
