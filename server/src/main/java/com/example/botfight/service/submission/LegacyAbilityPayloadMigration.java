package com.example.botfight.service.submission;

import com.example.botfight.simulation.gameconfig.AbilityRegistry;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** Explicit one-time compatibility boundary for legacy persisted/API brain JSON. */
public final class LegacyAbilityPayloadMigration {
    private static final Set<String> ABILITY_FIELDS = Set.of("ability", "abilityId", "ownerAbilityId", "preparingAbility", "triggeredAbility");

    private LegacyAbilityPayloadMigration() {}

    public static JsonNode normalize(JsonNode source) {
        if (source == null) return null;
        JsonNode copy = source.deepCopy();
        normalizeNode(copy, false);
        return copy;
    }

    private static void normalizeNode(JsonNode node, boolean loadoutAbilities) {
        if (node instanceof ArrayNode array) {
            for (int index = 0; index < array.size(); index++) {
                JsonNode child = array.get(index);
                if (loadoutAbilities && child.isTextual()) {
                    try {
                        array.set(index, array.numberNode(AbilityRegistry.abilityIdFromLegacyName(child.textValue())));
                    } catch (IllegalArgumentException ignored) {
                        // Preserve malformed/retired values so validation can report them.
                    }
                } else normalizeNode(child, false);
            }
            return;
        }
        if (!(node instanceof ObjectNode object)) return;
        normalizeLegacyWalkDirection(object);
        for (var entry : new java.util.ArrayList<>(object.properties())) {
            String field = entry.getKey();
            JsonNode value = entry.getValue();
            boolean abilityIdentity = ABILITY_FIELDS.contains(field) || "action".equals(field);
            if (abilityIdentity && value.isTextual() && isLegacyAbility(value.textValue())) {
                object.put(field, AbilityRegistry.abilityIdFromLegacyName(value.textValue()));
            } else {
                normalizeNode(value, "abilities".equals(field));
            }
        }
    }

    private static boolean isLegacyAbility(String value) {
        try {
            AbilityRegistry.abilityIdFromLegacyName(value);
            return true;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    /** Converts the pre-degree walk compass names at the compatibility boundary. */
    private static void normalizeLegacyWalkDirection(ObjectNode object) {
        JsonNode action = object.get("action");
        JsonNode movementMode = object.get("movementMode");
        if (action == null || !action.isTextual() || !"move_walk".equals(action.asText())
                || movementMode == null || !movementMode.isTextual() || !"absolute".equals(movementMode.asText())) return;
        JsonNode direction = object.get("movementDirection");
        if (direction == null || !direction.isTextual()) return;
        Integer degrees = switch (direction.asText().trim().toLowerCase()) {
            case "north" -> 0;
            case "northeast" -> 45;
            case "east" -> 90;
            case "southeast" -> 135;
            case "south" -> 180;
            case "southwest" -> 225;
            case "west" -> 270;
            case "northwest" -> 315;
            case "stop" -> 0;
            default -> null;
        };
        if (degrees != null) object.put("movementDirection", degrees);
    }
}
