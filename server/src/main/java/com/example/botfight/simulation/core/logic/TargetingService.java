package com.example.botfight.simulation.core.logic;

import static com.example.botfight.simulation.geometry.AngleCalculator.clockwiseDelta;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetPoint;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetSnapshot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Velocity;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.BotLogicContracts.TargetContract;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Resolves all live bot and ability entities used by bot targeting. */
public final class TargetingService {
    private TargetingService() {}

    public static Entity targetEntity(String target, Bot player, Bot opponent, List<Entity> entities) {
        String[] selector = target != null ? target.split(":", -1) : new String[0];
        if (selector.length == 3) {
            List<Entity> candidates = new ArrayList<>(matchingTargets(selector[0], player, opponent, entities));
            Comparator<Entity> comparator = switch (selector[1]) {
                case "farthest" -> Comparator.comparingDouble((Entity entity) -> distanceFrom(player, entity)).reversed();
                case "oldest" -> ageComparator(true);
                case "newest" -> ageComparator(false);
                default -> Comparator.comparingDouble(entity -> distanceFrom(player, entity));
            };
            candidates.sort(comparator);
            int ordinal;
            try {
                ordinal = Math.max(1, Math.min(100, Integer.parseInt(selector[2])));
            } catch (NumberFormatException ignored) {
                return null;
            }
            return candidates.size() >= ordinal ? candidates.get(ordinal - 1) : null;
        }
        if (BotLogicContracts.TARGET_OPPONENT.equals(target)) return opponent;
        TargetContract contract = BotLogicContracts.targetContract(target);
        if (contract == null || contract.entityType() == null) return null;
        return matchingEntityTargets(target, contract, player, opponent, entities).stream()
                .min(Comparator.comparingDouble(entity -> distanceFrom(player, entity)))
                .orElse(null);
    }

    public static List<Entity> matchingTargets(String target, Bot player, Bot opponent, List<Entity> entities) {
        String base = target == null ? "" : target.split(":", -1)[0];
        List<Entity> matches = new ArrayList<>();
        if ("opponent".equals(base)) {
            matches.add(opponent);
            return matches;
        }
        TargetContract contract = BotLogicContracts.targetContract(base);
        if (contract != null && contract.entityType() != null) {
            matches.addAll(matchingEntityTargets(base, contract, player, opponent, entities));
        }
        return matches;
    }

    public static double compassBearing(Entity from, Entity to) {
        return com.example.botfight.simulation.geometry.AngleCalculator.compassBearing(from.x(), from.y(), to.x(), to.y());
    }

    public static double clockwiseAngleDelta(double from, double to) { return clockwiseDelta(from, to); }

    public static Velocity entityVelocity(Entity entity) {
        if (entity instanceof Bot bot) return new Velocity(bot.velocityX, bot.velocityY);
        if (entity instanceof TargetSnapshot targetSnapshot) return new Velocity(targetSnapshot.velocityX(), targetSnapshot.velocityY());
        return null;
    }

    public static String entityId(Entity entity) {
        if (entity instanceof TargetSnapshot targetSnapshot) return targetSnapshot.id();
        if (entity instanceof Bot bot) return bot.userId.toString();
        return "";
    }

    public static Entity offsetTarget(Entity target, StrategyBlock block) {
        if (target == null || block == null) return target;
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(block.action());
        if (contract != null && contract.movementConfig()) return target;
        return new TargetPoint(target.x() + block.targetOffsetX(), target.y() + block.targetOffsetY(), target.size());
    }

    private static List<Entity> matchingEntityTargets(String target, TargetContract contract,
            Bot player, Bot opponent, List<Entity> entities) {
        if (contract.owner() == com.example.botfight.simulation.ecs.contracts.EntityContracts.TargetOwner.NONE) {
            return entities.stream()
                    .filter(entity -> entity instanceof TargetSnapshot snapshot
                            && contract.runtimeType().equals(snapshot.type())
                            && hasAbility(snapshot, contract))
                    .toList();
        }
        int ownerSlot = target.startsWith("my_") ? player.slot : opponent.slot;
        return entities.stream()
                .filter(entity -> entity instanceof TargetSnapshot snapshot
                        && contract.runtimeType().equals(snapshot.type())
                        && hasAbility(snapshot, contract)
                        && snapshot.ownerSlot() == ownerSlot)
                .toList();
    }

    private static boolean hasAbility(TargetSnapshot snapshot, TargetContract contract) {
        return Integer.valueOf(contract.abilityId()).equals(snapshot.abilityId());
    }

    private static Comparator<Entity> ageComparator(boolean oldest) {
        return (first, second) -> {
            int ageComparison = Integer.compare(entityAgeMs(first), entityAgeMs(second));
            if (ageComparison != 0) return oldest ? -ageComparison : ageComparison;
            int serialComparison = Integer.compare(entitySerial(first), entitySerial(second));
            if (serialComparison != 0) return oldest ? serialComparison : -serialComparison;
            int idComparison = entityId(first).compareTo(entityId(second));
            return oldest ? idComparison : -idComparison;
        };
    }

    private static int entityAgeMs(Entity entity) {
        return entity instanceof TargetSnapshot snapshot ? snapshot.ageMs() : 0;
    }

    private static int entitySerial(Entity entity) {
        String id = entityId(entity);
        int separator = id.lastIndexOf('-');
        if (separator < 0 || separator == id.length() - 1) return 0;
        try {
            return Integer.parseInt(id.substring(separator + 1));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static double distanceFrom(Bot bot, Entity entity) {
        return Math.hypot(entity.x() - bot.x, entity.y() - bot.y);
    }
}
