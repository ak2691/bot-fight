package com.example.botfight.simulation.bot;

import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.AbilityRegistry;
import java.util.HashSet;
import java.util.Set;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Reads the already-validated, allowlisted bot configuration used by simulation. */
@Service
public class BotCodeService {
    public Set<Integer> readAbilities(JsonNode brain) {
        Set<Integer> result = new HashSet<>(GameConfigCatalog.STANDARD_ABILITIES);
        if (brain == null) return result;
        JsonNode abilities = brain.path("loadout").path("abilities");
        if (!abilities.isArray()) return result;
        abilities.forEach(node -> {
            if (node.isIntegralNumber() && node.canConvertToInt()) {
                int id = node.intValue();
                if (AbilityRegistry.contains(id)) result.add(id);
            }
        });
        return result;
    }

    public int readStatPoints(JsonNode brain, String stat) {
        if (brain == null) return 0;
        return Math.max(0, Math.min(12, brain.path("loadout").path("statPoints").path(stat).asInt(0)));
    }
}
