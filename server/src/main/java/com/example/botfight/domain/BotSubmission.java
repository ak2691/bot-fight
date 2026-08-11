package com.example.botfight.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "bot_brain_submissions")
public class BotSubmission {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @Column(name = "match_id")
    private UUID matchId;

    @Column(name = "brain_schema_version", nullable = false, length = 50)
    private String brainSchemaVersion;

    @Column(name = "building_session_id", length = 100)
    private String buildingSessionId;

    @Column(name = "submission_fingerprint", length = 64)
    private String requestFingerprint;

    @Column(name = "selected_loadout", length = 40)
    private String selectedLoadout;

    @Column(name = "client_build_version", length = 100)
    private String clientBuildVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "brain_payload", nullable = false)
    private String brainPayload = "{}";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private BotSubmissionStatus status = BotSubmissionStatus.PENDING_VALIDATION;

    @Column(name = "submitted_at", nullable = false, updatable = false, insertable = false)
    private Instant submittedAt;

    @Column(name = "updated_at", nullable = false, insertable = false)
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

    public String getBuildingSessionId() {
        return buildingSessionId;
    }

    public void setBuildingSessionId(String buildingSessionId) {
        this.buildingSessionId = buildingSessionId;
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
