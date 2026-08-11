package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.clockwiseDelta;

import com.example.botfight.simulation.DuelSimulationService.Entity;
import com.example.botfight.simulation.DuelSimulationService.Bot;
import com.example.botfight.simulation.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.DuelSimulationService.TargetPoint;
import com.example.botfight.simulation.DuelSimulationService.TargetSnapshot;
import com.example.botfight.simulation.DuelSimulationService.Velocity;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Resolves all live bot and ability entities used by bot targeting. */
final class TargetingService {
    private TargetingService() {}

    static Entity targetEntity(String target, Bot player, Bot opponent, List<Entity> entities) {
        String[] selector = target != null ? target.split(":", -1) : new String[0];
        if (selector.length == 3) {
            List<Entity> candidates = new ArrayList<>(matchingTargets(selector[0], player, opponent, entities));
            Comparator<Entity> comparator = switch (selector[1]) {
                case "farthest" -> Comparator.comparingDouble((Entity entity) -> distanceFrom(player, entity)).reversed();
                case "oldest" -> Comparator.comparing(TargetingService::entityId);
                case "newest" -> Comparator.comparing(TargetingService::entityId).reversed();
                default -> Comparator.comparingDouble(entity -> distanceFrom(player, entity));
            };
            candidates.sort(comparator);
            int ordinal = Math.max(1, Math.min(100, Integer.parseInt(selector[2])));
            return candidates.size() >= ordinal ? candidates.get(ordinal - 1) : null;
        }
        if ("opponent".equals(target)) return opponent;
        if ("orbital_zone".equals(target)) {
            return entities.stream()
                    .filter(entity -> entity instanceof TargetSnapshot snapshot && "orbitalMarker".equals(snapshot.type()))
                    .min(Comparator.comparingDouble(entity -> distanceFrom(player, entity)))
                    .orElse(null);
        }
        Map<String, String> entityTypes = entityTypes();
        if (entityTypes.containsKey(target)) {
            int ownerSlot = target.startsWith("my_") ? player.slot : opponent.slot;
            String ownerPrefix = "ability:" + ownerSlot + ":";
            return entities.stream()
                    .filter(entity -> entity instanceof TargetSnapshot snapshot
                            && entityTypes.get(target).equals(snapshot.type())
                            && snapshot.id().startsWith(ownerPrefix))
                    .min(Comparator.comparingDouble(entity -> distanceFrom(player, entity)))
                    .orElse(null);
        }
        return null;
    }

    static List<Entity> matchingTargets(String target, Bot player, Bot opponent, List<Entity> entities) {
        String base = target == null ? "" : target.split(":", -1)[0];
        List<Entity> matches = new ArrayList<>();
        if ("opponent".equals(base)) {
            matches.add(opponent);
            return matches;
        }
        {
            String type = entityTypes().get(base);
            if (type != null) {
                boolean unowned = "orbital_zone".equals(base);
                String ownerPrefix = unowned ? "" : "ability:" + (base.startsWith("my_") ? player.slot : opponent.slot) + ":";
                entities.stream()
                        .filter(entity -> entity instanceof TargetSnapshot snapshot
                                && type.equals(snapshot.type())
                                && (unowned || snapshot.id().startsWith(ownerPrefix)))
                        .forEach(matches::add);
            }
        }
        return matches;
    }

    static double compassBearing(Entity from, Entity to) {
        return com.example.botfight.simulation.geometry.AngleCalculator.compassBearing(from.x(), from.y(), to.x(), to.y());
    }

    static double clockwiseAngleDelta(double from, double to) { return clockwiseDelta(from, to); }

    static Velocity entityVelocity(Entity entity) {
        if (entity instanceof Bot bot) return new Velocity(bot.velocityX, bot.velocityY);
        if (entity instanceof TargetSnapshot targetSnapshot) return new Velocity(targetSnapshot.velocityX(), targetSnapshot.velocityY());
        return null;
    }

    static String entityId(Entity entity) {
        if (entity instanceof TargetSnapshot targetSnapshot) return targetSnapshot.id();
        if (entity instanceof Bot bot) return bot.userId.toString();
        return "";
    }

    static Entity offsetTarget(Entity target, StrategyBlock block) {
        if (target == null || block == null) return target;
        return new TargetPoint(target.x() + block.targetOffsetX(), target.y() + block.targetOffsetY(), target.size());
    }

    private static Map<String, String> entityTypes() {
        return Map.ofEntries(
                Map.entry("opponent_concussive_shot", "concussiveShot"),
                Map.entry("opponent_grenade", "grenade"),
                Map.entry("opponent_fireball", "fireball"),
                Map.entry("opponent_proximity_mine", "proximityMine"),
                Map.entry("opponent_gravity_field", "gravityField"),
                Map.entry("opponent_hunter_drone", "hunterDrone"),
                Map.entry("opponent_orbital_zone", "orbitalMarker"),
                Map.entry("opponent_null_zone", "nullZone"),
                Map.entry("opponent_silence_wave", "silenceWave"),
                Map.entry("opponent_temporal_rewind_zone", "temporalRewindZone"),
                Map.entry("my_concussive_shot", "concussiveShot"),
                Map.entry("my_grenade", "grenade"),
                Map.entry("my_fireball", "fireball"),
                Map.entry("my_proximity_mine", "proximityMine"),
                Map.entry("my_gravity_field", "gravityField"),
                Map.entry("my_hunter_drone", "hunterDrone"),
                Map.entry("my_orbital_zone", "orbitalMarker"),
                Map.entry("my_null_zone", "nullZone"),
                Map.entry("my_silence_wave", "silenceWave"),
                Map.entry("my_temporal_rewind_zone", "temporalRewindZone"),
                Map.entry("orbital_zone", "orbitalMarker"));
    }

    private static double distanceFrom(Bot bot, Entity entity) {
        return Math.hypot(entity.x() - bot.x, entity.y() - bot.y);
    }
}
