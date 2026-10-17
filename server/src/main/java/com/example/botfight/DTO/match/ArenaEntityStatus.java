package com.example.botfight.DTO.match;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Replay wire shape for a status carried by an arena entity; the worker's replay JSON deserializes into it. */
public record ArenaEntityStatus(String type, int remainingMs, int intervalMs,
                                int tickElapsedMs, double amount, int movementLockMs,
                                String mode, List<StatusEffectState.Effect> effects,
                                boolean presence) {

    // The worker omits zero-valued counters and sends mode instead of a presence flag.
    // Box creator arguments so this wire format also works with strict primitive-null handling.
    @JsonCreator(mode = JsonCreator.Mode.PROPERTIES)
    public static ArenaEntityStatus fromJson(
            @JsonProperty("type") String type,
            @JsonProperty("remainingMs") Integer remainingMs,
            @JsonProperty("intervalMs") Integer intervalMs,
            @JsonProperty("tickElapsedMs") Integer tickElapsedMs,
            @JsonProperty("amount") Double amount,
            @JsonProperty("movementLockMs") Integer movementLockMs,
            @JsonProperty("mode") String mode,
            @JsonProperty("effects") List<StatusEffectState.Effect> effects,
            @JsonProperty("presence") Boolean presence) {
        return new ArenaEntityStatus(type, remainingMs == null ? 0 : remainingMs,
                intervalMs == null ? 0 : intervalMs, tickElapsedMs == null ? 0 : tickElapsedMs,
                amount == null ? 0 : amount, movementLockMs == null ? 0 : movementLockMs,
                mode, effects, Boolean.TRUE.equals(presence));
    }

    public ArenaEntityStatus {
        type = type == null ? "" : type;
        remainingMs = Math.max(0, remainingMs);
        intervalMs = Math.max(0, intervalMs);
        tickElapsedMs = Math.max(0, tickElapsedMs);
        amount = Math.max(0, amount);
        movementLockMs = Math.max(0, movementLockMs);
        mode = mode == null ? "duration" : mode;
        effects = effects == null ? List.of() : List.copyOf(effects);
        presence = presence || "presence".equals(mode);
    }
}
