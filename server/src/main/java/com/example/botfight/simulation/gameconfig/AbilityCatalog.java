package com.example.botfight.simulation.gameconfig;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * What Spring needs from {@code shared/gameplay/abilities.json} (on the classpath as {@code gameplay/}): ability
 * IDs, the standard abilities every bot has, and the one-letter codes of compact loadout strings. Everything
 * else in the file is gameplay, which only the shared engine reads and checks.
 */
public final class AbilityCatalog {
    private static final Set<Integer> IDS = new HashSet<>();
    private static final Set<Integer> STANDARD = new HashSet<>();
    private static final Map<Integer, String> CODE_BY_ID = new HashMap<>();
    private static final Map<String, Integer> ID_BY_CODE = new HashMap<>();

    static {
        for (JsonNode ability : read("gameplay/abilities.json").path("abilities")) {
            int id = ability.path("id").asInt();
            IDS.add(id);
            if (ability.path("standard").asBoolean(false)) STANDARD.add(id);
            if (ability.hasNonNull("code")) {
                CODE_BY_ID.put(id, ability.get("code").asString());
                ID_BY_CODE.put(ability.get("code").asString(), id);
            }
        }
        if (IDS.isEmpty()) throw new IllegalStateException("gameplay/abilities.json lists no abilities");
    }

    private AbilityCatalog() {}

    public static boolean exists(int abilityId) { return IDS.contains(abilityId); }
    public static boolean isStandard(int abilityId) { return STANDARD.contains(abilityId); }
    public static String codeForId(int abilityId) { return CODE_BY_ID.get(abilityId); }
    public static Integer idForCode(String code) { return code == null ? null : ID_BY_CODE.get(code); }

    private static JsonNode read(String resource) {
        try (InputStream stream = AbilityCatalog.class.getClassLoader().getResourceAsStream(resource)) {
            if (stream == null) throw new IllegalStateException("Missing classpath resource " + resource);
            return JsonMapper.builder().build().readTree(stream);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }
}
