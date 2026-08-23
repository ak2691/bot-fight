package com.example.botfight.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Immutable match-history copy of the authoritative bot code for one round. */
@Entity
@Table(
        name = "match_round_bot_codes",
        uniqueConstraints = @UniqueConstraint(
                name = "match_round_bot_codes_match_round_phase_user_unique",
                columnNames = {"match_id", "round_number", "phase", "user_id"}))
public class MatchRoundBotCode {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Match match;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @Column(name = "round_number", nullable = false)
    private int roundNumber;

    @Column(nullable = false, length = 30)
    private String phase;

    @Column(name = "submission_fingerprint", length = 64)
    private String submissionFingerprint;

    @Column(name = "selected_loadout", length = 40)
    private String selectedLoadout;

    @Column(name = "brain_schema_version", nullable = false, length = 50)
    private String brainSchemaVersion;

    @Column(name = "client_build_version", length = 100)
    private String clientBuildVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "brain_payload", nullable = false)
    private String brainPayload = "{}";

    @Column(name = "submitted_at", nullable = false)
    private Instant submittedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public Match getMatch() { return match; }
    public void setMatch(Match match) { this.match = match; }
    public AppUser getUser() { return user; }
    public void setUser(AppUser user) { this.user = user; }
    public int getRoundNumber() { return roundNumber; }
    public void setRoundNumber(int roundNumber) { this.roundNumber = roundNumber; }
    public String getPhase() { return phase; }
    public void setPhase(String phase) { this.phase = phase; }
    public String getSubmissionFingerprint() { return submissionFingerprint; }
    public void setSubmissionFingerprint(String submissionFingerprint) { this.submissionFingerprint = submissionFingerprint; }
    public String getSelectedLoadout() { return selectedLoadout; }
    public void setSelectedLoadout(String selectedLoadout) { this.selectedLoadout = selectedLoadout; }
    public String getBrainSchemaVersion() { return brainSchemaVersion; }
    public void setBrainSchemaVersion(String brainSchemaVersion) { this.brainSchemaVersion = brainSchemaVersion; }
    public String getClientBuildVersion() { return clientBuildVersion; }
    public void setClientBuildVersion(String clientBuildVersion) { this.clientBuildVersion = clientBuildVersion; }
    public String getBrainPayload() { return brainPayload; }
    public void setBrainPayload(String brainPayload) { this.brainPayload = brainPayload; }
    public Instant getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(Instant submittedAt) { this.submittedAt = submittedAt; }
}
