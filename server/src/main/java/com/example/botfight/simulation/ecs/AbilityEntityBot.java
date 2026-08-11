package com.example.botfight.simulation.ecs;

/** Minimal mutable bot surface required by persistent ability systems. */
public interface AbilityEntityBot {
    int entitySlot();
    double entityX();
    double entityY();
    int entitySize();
    int entityHp();
    /** Defender-owned immunity gate checked before any hostile state mutation. */
    boolean ignoresHostileEffects();
    void setEntityPosition(double x, double y);
    void applySilence(int durationMs);
    void setZoneSilenced(boolean silenced);
    void applyStun(int durationMs);
    void cancelPreparation();
}
