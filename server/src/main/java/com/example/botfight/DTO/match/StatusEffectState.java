package com.example.botfight.DTO.match;

import java.util.ArrayList;
import java.util.List;

/**
 * Replay wire shape for a bot status. The sim worker owns the status lifetime and effects; Spring only
 * carries the replay JSON, so this record-like class holds public fields and no behavior.
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

    public static final class Effect {
        public String type;
        public String mode = "constant";
        public double amount;
        public double multiplier = 1.0;
        public int durationMs;
        public double movementMultiplier = 1.0;
        public double rotationMultiplier = 1.0;
        /** Optional additive incoming-damage modifier; 0.25 means +25%. */
        public Double damageModifier;
        /** Optional source types that do not receive this modifier. */
        public List<String> excludedDamageSourceTypes;
        /** Optional deterministic rounding rule for the modified damage. */
        public String rounding;

        public Effect() {
        }
    }
}
