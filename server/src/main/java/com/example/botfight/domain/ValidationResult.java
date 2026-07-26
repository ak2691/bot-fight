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
@Table(name = "bot_brain_validation_results")
public class ValidationResult {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "bot_brain_submission_id", nullable = false)
    private ModelSubmission modelSubmission;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ValidationStatus status;

    @Column(name = "validator_version", nullable = false, length = 50)
    private String validatorVersion;

    @Column(name = "rejection_code", length = 100)
    private String rejectionCode;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String details = "{}";

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public ModelSubmission getModelSubmission() {
        return modelSubmission;
    }

    public void setModelSubmission(ModelSubmission modelSubmission) {
        this.modelSubmission = modelSubmission;
    }

    public ValidationStatus getStatus() {
        return status;
    }

    public void setStatus(ValidationStatus status) {
        this.status = status;
    }

    public String getValidatorVersion() {
        return validatorVersion;
    }

    public void setValidatorVersion(String validatorVersion) {
        this.validatorVersion = validatorVersion;
    }

    public String getRejectionCode() {
        return rejectionCode;
    }

    public void setRejectionCode(String rejectionCode) {
        this.rejectionCode = rejectionCode;
    }

    public String getDetails() {
        return details;
    }

    public void setDetails(String details) {
        this.details = details;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
