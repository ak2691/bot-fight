package com.example.botfight.simulation.bots;

import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityRegistry;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Reads the already-validated, allowlisted bot configuration used by simulation. */
@Service
public class BotCodeService {
    public Set<Integer> readAbilities(JsonNode brain) {
        LinkedHashSet<Integer> result = new LinkedHashSet<>(GameConfigCatalog.STANDARD_ABILITY_ORDER);
        if (brain == null) return result;
        JsonNode abilities = brain.path("loadout").path("abilities");
        if (!abilities.isArray()) return result;
        abilities.forEach(node -> {
            if (node.isIntegralNumber() && node.canConvertToInt()) {
                int id = node.intValue();
                if (AbilityContracts.actions().contains(id)) result.add(id);
            } else if (node.isTextual()) {
                try {
                    int id = AbilityRegistry.abilityIdFromLegacyName(node.textValue());
                    if (AbilityContracts.actions().contains(id)) result.add(id);
                } catch (IllegalArgumentException ignored) {
                    // Invalid or retired names are ignored here; submission validation reports them.
                }
            }
        });
        return result;
    }
}
