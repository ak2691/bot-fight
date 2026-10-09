package com.example.botfight.simulation.gameconfig;

import java.util.LinkedHashMap;
import java.util.Map;

/** Canonical permanent ability identity registry. Runtime code carries only the numeric key. */
public final class AbilityRegistry {
    private AbilityRegistry() {}

    private static final Map<Integer, String> NAMES = createNames();
    public static Map<Integer, String> all() {
        return NAMES;
    }

    public static boolean contains(int id) {
        return NAMES.containsKey(id);
    }

    public static int requireId(int id) {
        if (!contains(id)) throw new IllegalArgumentException("Unknown ability ID: " + id);
        return id;
    }

    private static Map<Integer, String> createNames() {
        LinkedHashMap<Integer, String> names = new LinkedHashMap<>();
        for (GameplayData.AbilityData ability : GameplayData.get().abilities().abilities()) {
            register(names, ability.id(), ability.name());
        }
        return Map.copyOf(names);
    }

    private static void register(Map<Integer, String> names, int id, String name) {
        if (id <= 0 || names.containsKey(id) || names.containsValue(name)) {
            throw new ExceptionInInitializerError("Duplicate or invalid ability registry entry: " + id);
        }
        names.put(id, name);
    }

}
