package com.example.botfight.DTO.match;

/** Replay wire shape for a status carried by an arena entity; the worker's replay JSON deserializes into it. */
public record ArenaEntityStatus(String type, int remainingMs, int intervalMs,
                                int tickElapsedMs, double amount, int movementLockMs,
                                boolean presence) {

    public ArenaEntityStatus {
        type = type == null ? "" : type;
        remainingMs = Math.max(0, remainingMs);
        intervalMs = Math.max(0, intervalMs);
        tickElapsedMs = Math.max(0, tickElapsedMs);
        amount = Math.max(0, amount);
        movementLockMs = Math.max(0, movementLockMs);
    }
}
