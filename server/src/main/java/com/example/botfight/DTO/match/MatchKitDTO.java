package com.example.botfight.DTO.match;
import java.util.List;
import java.util.ArrayList;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.example.botfight.service.auth.AuthException;
import tools.jackson.databind.JsonNode;
/** Numeric catalog IDs, abilities ordered by tier 1, 2, 3. Dash is implicit. */
public record MatchKitDTO(Integer weapon, List<Integer> abilities) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static MatchKitDTO fromJson(JsonNode node) {
        if (node == null || !node.isObject() || node.size() != 2 || !node.has("weapon") || !node.has("abilities"))
            throw new AuthException("kit must contain weapon and abilities only");
        JsonNode weapon = node.get("weapon"), abilities = node.get("abilities");
        if (!weapon.isIntegralNumber() || !weapon.canConvertToInt()) throw new AuthException("kit requires a numeric weapon id");
        if (!abilities.isArray() || abilities.size() != 3) throw new AuthException("kit requires exactly three tier abilities");
        List<Integer> ids = new ArrayList<>();
        for (JsonNode id : abilities) {
            if (!id.isIntegralNumber() || !id.canConvertToInt()) throw new AuthException("kit requires numeric ability ids");
            ids.add(id.intValue());
        }
        return new MatchKitDTO(weapon.intValue(), List.copyOf(ids));
    }
}
