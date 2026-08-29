package com.example.botfight.simulation.ecs.entities;

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
    void applySilence(int durationMs);
    void setZoneSilenced(boolean silenced);
    void applyStun(int durationMs);
    void cancelPreparation();

    /** Generic status hooks used by contract-declared entity effects. */
    default void applyDebuff(String subtype, int durationMs, int sourceSlot) {
        if ("silence".equals(subtype)) applySilence(durationMs);
        else if ("stun".equals(subtype)) applyStun(durationMs);
        else if ("slow".equals(subtype)) applySlow(durationMs);
    }

    /** Optional status hook keeps existing entity-test fakes source-compatible. */
    default void applySlow(int durationMs) {}

    default void applyInterrupt(int durationMs) {
        cancelPreparation();
        if (durationMs > 0) applyStun(durationMs);
    }

    default void clearPresence(String field) {
        if ("silence".equals(field)) setZoneSilenced(false);
    }

    default void setPresence(String field, boolean active) {
        if ("silence".equals(field)) setZoneSilenced(active);
    }
}
