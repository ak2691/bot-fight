package com.example.botfight.domain.submission;

import com.example.botfight.domain.auth.AppUser;
import java.time.Instant;
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

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
