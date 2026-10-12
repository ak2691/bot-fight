package com.example.botfight.service.match;

import org.springframework.stereotype.Component;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.DTO.match.MatchKitDTO;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import java.util.List;
import java.util.HashSet;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Strict fixed-kit boundary validation and deterministic round unlocks. */
@Component
public final class MatchLoadoutService {
    private final JsonMapper jsonMapper;
    public MatchLoadoutService(JsonMapper jsonMapper) { this.jsonMapper = jsonMapper; }

    public static int tierForRound(int round) { return Math.max(1, Math.min(3, (round + 1) / 2)); }
    public static Integer unlockedTier(int round) { return round == 1 || round == 3 || round == 5 ? tierForRound(round) : null; }

    public static String validateKit(MatchKitDTO kit) {
        if (kit == null || kit.weapon() == null || !AbilityCatalog.isWeapon(kit.weapon())
                || !AbilityCatalog.exists(kit.weapon())) throw new AuthException("kit requires a known weapon");
        if (kit.abilities() == null || kit.abilities().size() != 3)
            throw new AuthException("kit requires exactly one ability from each tier (1, 2, 3)");
        var seen = new HashSet<Integer>();
        StringBuilder codes = new StringBuilder(AbilityCatalog.codeForId(kit.weapon()));
        for (int tier = 1; tier <= 3; tier++) {
            Integer id = kit.abilities().get(tier - 1);
            if (id == null || !AbilityCatalog.exists(id)) throw new AuthException("kit contains an unknown ability id");
            if (!seen.add(id) || id.equals(kit.weapon())) throw new AuthException("kit contains duplicate ability ids");
            if (!Integer.valueOf(tier).equals(AbilityCatalog.tierOf(id)))
                throw new AuthException("kit ability in tier " + tier + " must belong to tier " + tier);
            codes.append(AbilityCatalog.codeForId(id));
        }
        return "custom:" + codes;
    }

    /** Revalidate internal carriers too, before creating a match or entering the queue. */
    public static String validateEncodedKit(String value) {
        if (value == null || !value.matches("custom:[A-Za-z0-9]{4}"))
            throw new AuthException("kit requires a weapon and exactly one ability from each tier");
        List<Integer> ids = value.substring(7).chars().mapToObj(c -> AbilityCatalog.idForCode(String.valueOf((char)c))).toList();
        return validateKit(new MatchKitDTO(ids.get(0), ids.subList(1, 4)));
    }

    public static String unlockedLoadout(String kit, int round) {
        if (kit == null || !kit.startsWith("custom:")) return kit;
        int tier = tierForRound(round);
        StringBuilder codes = new StringBuilder();
        for (char code : kit.substring(7).toCharArray()) {
            Integer id = AbilityCatalog.idForCode(String.valueOf(code));
            if (id == null) continue;
            Integer abilityTier = AbilityCatalog.tierOf(id);
            if (AbilityCatalog.isWeapon(id) || abilityTier != null && abilityTier <= tier) codes.append(code);
        }
        return "custom:" + codes;
    }

    public ObjectNode encodedLoadoutNode(String selectedLoadout) {
        if (selectedLoadout == null || !selectedLoadout.startsWith("custom:")) return null;
        String[] parts = selectedLoadout.split(":", -1);
        if (parts.length != 2) return null;

        ObjectNode loadout = jsonMapper.createObjectNode();
        var abilityArray = loadout.putArray("abilities");
        for (int index = 0; index < parts[1].length(); index++) {
            Integer abilityId = AbilityCatalog.idForCode(
                    String.valueOf(parts[1].charAt(index)));
            if (abilityId != null) abilityArray.add(abilityId);
        }
        return loadout;
    }

}
