package com.example.botfight.simulation.ecs.entities;

import com.example.botfight.simulation.core.state.StatusEffectState;

/** Minimal mutable bot surface required by persistent ability systems. */
public interface AbilityEntityBot {
    int entitySlot();
    /** Team identity used to keep hostile entity effects off friendly bots. */
    default int entityTeam() { return entitySlot(); }
    double entityX();
    double entityY();
    /** Start pose of this bot's movement segment for the current simulation tick. */
    default double entityMovementStartX() { return entityX(); }
    default double entityMovementStartY() { return entityY(); }
    int entitySize();
    double entityHp();
    /** Defender-owned immunity gate checked before any hostile state mutation. */
    boolean ignoresHostileEffects();
    void setEntityPosition(double x, double y);
    /** Gives the bot the speed of a push, in units per second. */
    default void setEntityVelocity(double velocityX, double velocityY) {}
    /**
     * Adds or refreshes a status built from a statuses.json preset. {@code clearsVelocity} (the preset's flag)
     * stops the bot where it stands.
     */
    void applyStatus(StatusEffectState status, boolean clearsVelocity);
    /** Applies the full contract-owned interrupt transition to this bot. */
    void applyInterrupt(int durationMs, Integer abilityId);
    /** Drops the statuses that last only while the bot stands inside a zone. */
    void clearZonePresence();
}
