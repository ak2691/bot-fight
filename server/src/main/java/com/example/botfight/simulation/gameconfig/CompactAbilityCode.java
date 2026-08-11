package com.example.botfight.simulation.gameconfig;

import java.util.Map;

/** Explicit transport codec for the existing compact selected-loadout string. */
public final class CompactAbilityCode {
    private static final Map<Integer, String> BY_ID = Map.ofEntries(
            Map.entry(1, "s"), Map.entry(2, "b"), Map.entry(3, "g"), Map.entry(4, "r"), Map.entry(5, "f"),
            Map.entry(6, "t"), Map.entry(7, "h"), Map.entry(8, "u"), Map.entry(9, "c"), Map.entry(10, "e"),
            Map.entry(11, "m"), Map.entry(12, "p"), Map.entry(13, "R"), Map.entry(14, "G"), Map.entry(15, "S"),
            Map.entry(16, "A"), Map.entry(17, "H"), Map.entry(18, "T"), Map.entry(21, "w"), Map.entry(22, "o"),
            Map.entry(23, "a"), Map.entry(24, "n"), Map.entry(25, "P"));
    private static final Map<String, Integer> BY_CODE = BY_ID.entrySet().stream()
            .collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getValue, Map.Entry::getKey));

    private CompactAbilityCode() {}

    public static String codeForId(int abilityId) { return BY_ID.get(abilityId); }
    public static Integer idForCode(String code) { return code == null ? null : BY_CODE.get(code); }
}
