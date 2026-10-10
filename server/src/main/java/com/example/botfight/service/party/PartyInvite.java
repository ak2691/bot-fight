package com.example.botfight.service.party;

import com.example.botfight.domain.auth.AppUser;
import java.time.Instant;
import java.util.UUID;

/** Mutable process-local party state; never persisted. */
public final class PartyInvite {

    private UUID id;

    private Party party;

    private AppUser inviter;

    private AppUser invitee;

    private PartyInviteStatus status = PartyInviteStatus.PENDING;

    private Instant expiresAt;

    private Instant respondedAt;

    private Instant createdAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Party getParty() {
        return party;
    }

    public void setParty(Party party) {
        this.party = party;
    }

    public AppUser getInviter() {
        return inviter;
    }

    public void setInviter(AppUser inviter) {
        this.inviter = inviter;
    }

    public AppUser getInvitee() {
        return invitee;
    }

    public void setInvitee(AppUser invitee) {
        this.invitee = invitee;
    }

    public PartyInviteStatus getStatus() {
        return status == null ? PartyInviteStatus.PENDING : status;
    }

    public void setStatus(PartyInviteStatus status) {
        this.status = status;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public Instant getRespondedAt() {
        return respondedAt;
    }

    public void setRespondedAt(Instant respondedAt) {
        this.respondedAt = respondedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

}
