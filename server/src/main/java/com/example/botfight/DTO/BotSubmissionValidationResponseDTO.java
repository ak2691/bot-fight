package com.example.botfight.DTO;

import java.util.List;

public class BotSubmissionValidationResponseDTO {

    private boolean accepted;
    private String status;
    private String message;
    private String validatorVersion;
    private String submittedBrainHash;
    private String computedModelHash;
    private boolean testingDurationTrusted;
    private List<String> errors;
    private List<String> warnings;

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

    public String getSubmittedBrainHash() {
        return submittedBrainHash;
    }

    public void setSubmittedBrainHash(String submittedBrainHash) {
        this.submittedBrainHash = submittedBrainHash;
    }

    public String getComputedModelHash() {
        return computedModelHash;
    }

    public void setComputedModelHash(String computedModelHash) {
        this.computedModelHash = computedModelHash;
    }

    public boolean isTestingDurationTrusted() {
        return testingDurationTrusted;
    }

    public void setTestingDurationTrusted(boolean testingDurationTrusted) {
        this.testingDurationTrusted = testingDurationTrusted;
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
