package com.example.botfight.service.party;

import com.example.botfight.domain.auth.AppUser;
import java.util.UUID;

/** Mutable process-local party state; never persisted. */
public final class PartyMember {

    private UUID id;

    private Party party;

    private AppUser user;

    private short slot;

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

    public AppUser getUser() {
        return user;
    }

    public void setUser(AppUser user) {
        this.user = user;
    }

    public short getSlot() {
        return slot;
    }

    public void setSlot(short slot) {
        this.slot = slot;
    }

}
