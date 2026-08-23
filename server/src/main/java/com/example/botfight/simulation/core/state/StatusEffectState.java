package com.example.botfight.simulation.core.state;

import java.util.ArrayList;
import java.util.List;

/**
 * The authoritative generic status component. A status owns its lifetime and
 * declares the allowlisted components that are applied while it is active.
 */
public final class StatusEffectState {
    public String type;
    public int remainingMs;
    public int tickMs;
    public int tickElapsedMs;
    public String mode = "duration";
    public String source;
    public Integer sourceSlot;
    public Integer abilityId;
    public List<Effect> effects = new ArrayList<>();

    public StatusEffectState() {
    }

    public StatusEffectState(String type, int remainingMs, int tickMs) {
        this.type = type == null ? "" : type.toLowerCase();
        this.remainingMs = Math.max(0, remainingMs);
        this.tickMs = Math.max(0, tickMs);
    }

    public StatusEffectState presence(String source) {
        this.mode = "presence";
        this.remainingMs = 0;
        this.source = source;
        return this;
    }

    public StatusEffectState addEffect(Effect effect) {
        if (effect != null) effects.add(effect);
        return this;
    }

    public boolean active() {
        return "presence".equals(mode) || remainingMs > 0;
    }

    public static final class Effect {
        public String type;
        public String mode = "constant";
        public double amount;
        public double multiplier = 1.0;
        public int durationMs;
        public double movementMultiplier = 1.0;
        public double rotationMultiplier = 1.0;

        public Effect() {
        }

        public Effect(String type, String mode) {
            this.type = type == null ? "" : type.toLowerCase();
            this.mode = "tick".equals(mode) ? "tick" : "constant";
        }

        public Effect amount(double value) {
            amount = value;
            return this;
        }

        public Effect multiplier(double value) {
            multiplier = value;
            return this;
        }

        public Effect durationMs(int value) {
            durationMs = Math.max(0, value);
            return this;
        }

        public Effect movement(double movement, double rotation) {
            movementMultiplier = movement;
            rotationMultiplier = rotation;
            return this;
        }
    }
}
