package com.example.botfight.simulation.gameconfig;

import java.util.LinkedHashMap;
import java.util.Map;

/** Canonical permanent ability identity registry. Runtime code carries only the numeric key. */
public final class AbilityRegistry {
    private AbilityRegistry() {}

    private static final Map<Integer, String> NAMES = createNames();
    private static final Map<String, Integer> LEGACY_IDS = createLegacyIds();

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

    /** Explicit trusted-boundary conversion for persisted or inbound legacy data only. */
    public static int abilityIdFromLegacyName(String name) {
        if (name == null) throw new IllegalArgumentException("Legacy ability name is required");
        Integer id = LEGACY_IDS.get(name);
        if (id == null) throw new IllegalArgumentException("Unknown legacy ability name: " + name);
        return id;
    }

    /** Explicit presentation/migration conversion; ordinary runtime lookup must remain numeric. */
    public static String legacyAbilityNameFromId(int id) {
        String name = NAMES.get(id);
        if (name == null) throw new IllegalArgumentException("Unknown ability ID: " + id);
        return name;
    }

    private static Map<Integer, String> createNames() {
        LinkedHashMap<Integer, String> names = new LinkedHashMap<>();
        register(names, 1, "slash");
        register(names, 3, "gun");
        register(names, 4, "grenade");
        register(names, 5, "fireball");
        register(names, 6, "stun");
        register(names, 7, "heavy_slash");
        register(names, 8, "repulsor_burst");
        register(names, 9, "concussive_shot");
        register(names, 10, "basic_heal");
        register(names, 11, "proximity_mine");
        register(names, 12, "pistol");
        register(names, 13, "rail_shot");
        register(names, 14, "gravity_grenade");
        register(names, 15, "silence_pulse");
        register(names, 16, "reactive_armor");
        register(names, 17, "hunter_drone");
        register(names, 18, "wind_burst");
        register(names, 19, "dash");
        register(names, 20, "lock_on");
        register(names, 21, "temporal_rewind");
        register(names, 22, "orbital_strike");
        register(names, 23, "absolute_guard");
        register(names, 24, "null_zone");
        register(names, 25, "phase_strike");
        register(names, 26, "frost_ring");
        register(names, 27, "singularity");
        register(names, 28, "tether_bolt");
        register(names, 29, "static_snare");
        register(names, 30, "disruptor_dart");
        register(names, 31, "repeller_drone");
        register(names, 32, "siphon_lance");
        register(names, 33, "overclock");
        register(names, 34, "basic_strike");
        return Map.copyOf(names);
    }

    private static void register(Map<Integer, String> names, int id, String name) {
        if (id <= 0 || names.containsKey(id) || names.containsValue(name)) {
            throw new ExceptionInInitializerError("Duplicate or invalid ability registry entry: " + id);
        }
        names.put(id, name);
    }

    private static Map<String, Integer> createLegacyIds() {
        LinkedHashMap<String, Integer> ids = new LinkedHashMap<>();
        NAMES.forEach((id, name) -> ids.put(name, id));
        ids.put("swing", 1);
        ids.put("fire_gun", 3);
        ids.put("throw_grenade", 4);
        ids.put("shoot_fireball", 5);
        ids.put("pistol_shot", 12);
        return Map.copyOf(ids);
    }
}
