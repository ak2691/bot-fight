package com.example.botfight.simulation.gameconfig;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Phases hosted by a bot rather than by an independently selectable entity. */
final class AttachedAbilityContracts {
    private static final Map<Integer, Map<String, String>> HITBOXES = hitboxes();

    private AttachedAbilityContracts() {}

    static List<AbilityContracts.AbilityPhase> phases(int abilityId,
                                                       List<AbilityContracts.Effect> effects) {
        Map<String, String> hitbox = HITBOXES.get(abilityId);
        if (hitbox == null) return List.of();
        List<AbilityContracts.Effect> phaseEffects = effects.stream()
                .filter(effect -> effect.type() != AbilityContracts.EffectType.SPAWN_ENTITY)
                .toList();
        var event = new AbilityContracts.PhaseEvent(
                List.of(AbilityContracts.PhaseAction.APPLY_EFFECTS),
                phaseEffects.stream().map(AbilityContracts.Effect::type)
                        .collect(java.util.stream.Collectors.toSet()),
                null, null, null, null, null, null, null);
        return List.of(new AbilityContracts.AbilityPhase(
                "active", AbilityContracts.PhaseType.BOT_ATTACHED, hitbox,
                phaseEffects, Map.of(AbilityContracts.PhaseEventType.COLLISION, event),
                null, new AbilityContracts.Visual("ability", 0), Map.of(), Map.of()));
    }

    private static Map<Integer, Map<String, String>> hitboxes() {
        Map<Integer, Map<String, String>> values = new LinkedHashMap<>();
        for (int id : new int[]{1, 7, 34}) values.put(id, hitbox("arc", "range", "range", "arc", "arc"));
        for (int id : new int[]{3, 9, 12, 13, 30, 32}) values.put(id, hitbox("ray", "range", "range", "width", "hitboxWidth"));
        for (int id : new int[]{6, 25}) values.put(id, hitbox("rectangle", "length", "range", "width", "hitboxWidth"));
        for (int id : new int[]{8, 26}) values.put(id, Map.of("shape", "circle", "radius", "radius"));
        return Map.copyOf(values);
    }

    private static Map<String, String> hitbox(String shape, String firstKey,
                                               String firstValue, String secondKey,
                                               String secondValue) {
        return Map.of("shape", shape, firstKey, firstValue, secondKey, secondValue);
    }
}
