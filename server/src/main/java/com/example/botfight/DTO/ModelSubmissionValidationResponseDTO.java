package com.example.botfight.DTO;

import java.util.List;
import java.util.UUID;

public class ModelSubmissionValidationResponseDTO {

    private UUID modelSubmissionId;
    private boolean accepted;
    private String status;
    private String message;
    private String validatorVersion;
    private String submittedModelHash;
    private String computedModelHash;
    private boolean trainingDurationTrusted;
    private List<String> errors;
    private List<String> warnings;

    public UUID getModelSubmissionId() {
        return modelSubmissionId;
    }

    public void setModelSubmissionId(UUID modelSubmissionId) {
        this.modelSubmissionId = modelSubmissionId;
    }

    public boolean isAccepted() {
        return accepted;
    }

    public void setAccepted(boolean accepted) {
        this.accepted = accepted;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getValidatorVersion() {
        return validatorVersion;
    }

    public void setValidatorVersion(String validatorVersion) {
        this.validatorVersion = validatorVersion;
    }

    public String getSubmittedModelHash() {
        return submittedModelHash;
    }

    public void setSubmittedModelHash(String submittedModelHash) {
        this.submittedModelHash = submittedModelHash;
    }

    public String getComputedModelHash() {
        return computedModelHash;
    }

    public void setComputedModelHash(String computedModelHash) {
        this.computedModelHash = computedModelHash;
    }

    public boolean isTrainingDurationTrusted() {
        return trainingDurationTrusted;
    }

    public void setTrainingDurationTrusted(boolean trainingDurationTrusted) {
        this.trainingDurationTrusted = trainingDurationTrusted;
    }

    public List<String> getErrors() {
        return errors;
    }

    public void setErrors(List<String> errors) {
        this.errors = errors;
    }

    public List<String> getWarnings() {
        return warnings;
    }

    public void setWarnings(List<String> warnings) {
        this.warnings = warnings;
    }
}
