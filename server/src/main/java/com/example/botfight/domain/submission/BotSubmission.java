package com.example.botfight.domain.submission;

import com.example.botfight.domain.auth.AppUser;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** In-memory authoritative match submission; durable history uses MatchRoundBotCode. */
public class BotSubmission {

    private UUID id;

    private AppUser user;

    private UUID matchId;

    private String brainSchemaVersion;

    private String requestFingerprint;

    private String selectedLoadout;

    private String clientBuildVersion;

    private String brainPayload = "{}";

    private BotSubmissionStatus status = BotSubmissionStatus.PENDING_VALIDATION;

    private Instant submittedAt;

    /** Custom variables (by id or name) to reset to their declared default at the next segment boundary. */
    private List<String> variableResets = List.of();

    /** What the player wants done if their clock runs out; null leaves the player's current setting. */
    private String timeoutFallback;

    private Instant updatedAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public AppUser getUser() {
        return user;
    }

    public void setUser(AppUser user) {
        this.user = user;
    }

    public UUID getMatchId() {
        return matchId;
    }

    public void setMatchId(UUID matchId) {
        this.matchId = matchId;
    }

    public String getBrainSchemaVersion() {
        return brainSchemaVersion;
    }

    public void setBrainSchemaVersion(String brainSchemaVersion) {
        this.brainSchemaVersion = brainSchemaVersion;
    }

    public String getRequestFingerprint() {
        return requestFingerprint;
    }

    public void setRequestFingerprint(String requestFingerprint) {
        this.requestFingerprint = requestFingerprint;
    }

    public String getSelectedLoadout() {
        return selectedLoadout;
    }

    public void setSelectedLoadout(String selectedLoadout) {
        this.selectedLoadout = selectedLoadout;
    }

    public String getClientBuildVersion() {
        return clientBuildVersion;
    }

    public void setClientBuildVersion(String clientBuildVersion) {
        this.clientBuildVersion = clientBuildVersion;
    }

    public String getBrainPayload() {
        return brainPayload;
    }

    public void setBrainPayload(String brainPayload) {
        this.brainPayload = brainPayload;
    }

    public BotSubmissionStatus getStatus() {
        return status;
    }

    public void setStatus(BotSubmissionStatus status) {
        this.status = status;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public List<String> getVariableResets() {
        return variableResets;
    }

    public void setVariableResets(List<String> variableResets) {
        this.variableResets = variableResets == null ? List.of() : List.copyOf(variableResets);
    }

    public String getTimeoutFallback() {
        return timeoutFallback;
    }

    public void setTimeoutFallback(String timeoutFallback) {
        this.timeoutFallback = timeoutFallback;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
