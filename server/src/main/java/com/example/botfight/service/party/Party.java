package com.example.botfight.service.party;

import com.example.botfight.domain.auth.AppUser;
import java.util.UUID;

/** Mutable process-local party state; never persisted. */
public final class Party {

    private UUID id;

    private AppUser owner;

    private short capacity = 2;

    private PartyStatus status = PartyStatus.ACTIVE;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public AppUser getOwner() {
        return owner;
    }

    public void setOwner(AppUser owner) {
        this.owner = owner;
    }

    public short getCapacity() {
        return capacity;
    }

    public void setCapacity(short capacity) {
        this.capacity = capacity;
    }

    public PartyStatus getStatus() {
        return status == null ? PartyStatus.ACTIVE : status;
    }

    public void setStatus(PartyStatus status) {
        this.status = status;
    }

}
