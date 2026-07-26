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

@Entity
@Table(name = "match_participants")
public class MatchParticipant {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Match match;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bot_brain_submission_id")
    private ModelSubmission modelSubmission;

    @Column(nullable = false)
    private short slot;

    @Column(name = "selected_class", length = 40)
    private String selectedClass;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private MatchResult result;

    @Column(name = "rating_before")
    private Integer ratingBefore;

    @Column(name = "rating_after")
    private Integer ratingAfter;

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Match getMatch() {
        return match;
    }

    public void setMatch(Match match) {
        this.match = match;
    }

    public AppUser getUser() {
        return user;
    }

    public void setUser(AppUser user) {
        this.user = user;
    }

    public ModelSubmission getModelSubmission() {
        return modelSubmission;
    }

    public void setModelSubmission(ModelSubmission modelSubmission) {
        this.modelSubmission = modelSubmission;
    }

    public short getSlot() {
        return slot;
    }

    public void setSlot(short slot) {
        this.slot = slot;
    }

    public String getSelectedClass() {
        return selectedClass;
    }

    public void setSelectedClass(String selectedClass) {
        this.selectedClass = selectedClass;
    }

    public MatchResult getResult() {
        return result;
    }

    public void setResult(MatchResult result) {
        this.result = result;
    }

    public Integer getRatingBefore() {
        return ratingBefore;
    }

    public void setRatingBefore(Integer ratingBefore) {
        this.ratingBefore = ratingBefore;
    }

    public Integer getRatingAfter() {
        return ratingAfter;
    }

    public void setRatingAfter(Integer ratingAfter) {
        this.ratingAfter = ratingAfter;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
