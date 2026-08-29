package com.example.botfight.domain;

/**
 * The rules/matchmaking shape of a match. This is deliberately separate from
 * the simulation ruleset version: a ruleset describes combat, while a mode
 * describes how players are grouped and how the match is presented.
 */
public enum MatchMode {
    ONES("1v1", 1, true),
    TWOS("2v2", 2, true),
    CUSTOM("Custom Match", 0, false);

    private final String displayName;
    private final int teamSize;
    private final boolean queueable;

    MatchMode(String displayName, int teamSize, boolean queueable) {
        this.displayName = displayName;
        this.teamSize = teamSize;
        this.queueable = queueable;
    }

    public String displayName() {
        return displayName;
    }

    public int teamSize() {
        return teamSize;
    }

    public boolean queueable() {
        return queueable;
    }

    public static MatchMode fromWire(String value) {
        if (value == null || value.isBlank()) return ONES;
        return switch (value.trim().toUpperCase(java.util.Locale.ROOT)) {
            case "ONES", "1V1", "1S" -> ONES;
            case "TWOS", "2V2", "2S" -> TWOS;
            case "CUSTOM", "CUSTOM_MATCH" -> CUSTOM;
            default -> throw new IllegalArgumentException("unsupported match mode");
        };
    }
}
