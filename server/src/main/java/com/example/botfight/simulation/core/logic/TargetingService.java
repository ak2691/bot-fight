package com.example.botfight.simulation.core.logic;

import static com.example.botfight.simulation.geometry.AngleCalculator.clockwiseDelta;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetPoint;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SelectableSnapshot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Velocity;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.BotLogicContracts.SelectableContract;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Resolves all live bot and ability entities used by bot selectable inputs and actions. */
public final class TargetingService {
    private TargetingService() {}

    public static Entity selectableEntity(String selectableId, Bot player, Bot opponent, List<Entity> entities) {
        String canonicalSelectable = BotLogicContracts.canonicalSelectableId(selectableId);
        String[] selector = canonicalSelectable != null ? canonicalSelectable.split(":", -1) : new String[0];
        if (selector.length == 3) {
            List<Entity> candidates = new ArrayList<>(matchingSelectables(selector[0], player, opponent, entities));
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
        if (BotLogicContracts.isBotSelectable(canonicalSelectable)) {
            return botSelectable(canonicalSelectable, player, opponent);
        }
        SelectableContract contract = BotLogicContracts.selectableContract(canonicalSelectable);
        if (contract == null || contract.entityType() == null) return null;
        return matchingEntitySelectables(canonicalSelectable, contract, player, opponent, entities).stream()
                .min(Comparator.comparingDouble(entity -> distanceFrom(player, entity)))
                .orElse(null);
    }

    public static List<Entity> matchingSelectables(String selectableId, Bot player, Bot opponent, List<Entity> entities) {
        String canonicalSelectable = BotLogicContracts.canonicalSelectableId(selectableId);
        String base = canonicalSelectable == null ? "" : canonicalSelectable.split(":", -1)[0];
        List<Entity> matches = new ArrayList<>();
        if (BotLogicContracts.SELECTABLE_MY.equals(base)) {
            matches.add(player);
            return matches;
        }
        if (BotLogicContracts.SELECTABLE_OPPONENT.equals(base)) {
            Entity bot = botSelectable(base, player, opponent);
            if (bot != null) matches.add(bot);
            return matches;
        }
        if (BotLogicContracts.isBotSelectable(base)) {
            Entity bot = botSelectable(base, player, opponent);
            if (bot != null) matches.add(bot);
            return matches;
        }
        SelectableContract contract = BotLogicContracts.selectableContract(base);
        if (contract != null && contract.entityType() != null) {
            matches.addAll(matchingEntitySelectables(base, contract, player, opponent, entities));
        }
        return matches;
    }

    public static double compassBearing(Entity from, Entity to) {
        return com.example.botfight.simulation.geometry.AngleCalculator.compassBearing(from.x(), from.y(), to.x(), to.y());
    }

    public static double clockwiseAngleDelta(double from, double to) { return clockwiseDelta(from, to); }

    public static Velocity entityVelocity(Entity entity) {
        if (entity instanceof Bot bot) return new Velocity(bot.velocityX, bot.velocityY);
        if (entity instanceof SelectableSnapshot selectableSnapshot) return new Velocity(selectableSnapshot.velocityX(), selectableSnapshot.velocityY());
        return null;
    }

    public static String entityId(Entity entity) {
        if (entity instanceof SelectableSnapshot selectableSnapshot) return selectableSnapshot.id();
        if (entity instanceof Bot bot) return bot.userId.toString();
        return "";
    }

    public static Entity offsetTarget(Entity target, StrategyBlock block) {
        if (target == null || block == null) return target;
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(block.action());
        if (contract != null && contract.movementConfig()) return target;
        return new TargetPoint(target.x() + block.targetOffsetX(), target.y() + block.targetOffsetY(), target.size());
    }

    private static List<Entity> matchingEntitySelectables(String selectableId, SelectableContract contract,
            Bot player, Bot opponent, List<Entity> entities) {
        if (contract.owner() == com.example.botfight.simulation.ecs.contracts.EntityContracts.SelectableOwner.NONE) {
            return entities.stream()
                    .filter(entity -> entity instanceof SelectableSnapshot snapshot
                            && contract.runtimeType().equals(snapshot.type())
                    && hasAbility(snapshot, contract))
                    .toList();
        }
        String ownerSelector = BotLogicContracts.entitySelectableBotSelector(selectableId, contract.entityType());
        if (ownerSelector != null) {
            Bot owner = botSelectable(ownerSelector, player, opponent);
            if (owner == null) return List.of();
            return entities.stream()
                    .filter(entity -> entity instanceof SelectableSnapshot snapshot
                            && contract.runtimeType().equals(snapshot.type())
                            && hasAbility(snapshot, contract)
                            && snapshot.ownerSlot() == owner.slot)
                    .toList();
        }
        boolean ownEntities = selectableId.startsWith("my_");
        return entities.stream()
                .filter(entity -> entity instanceof SelectableSnapshot snapshot
                        && contract.runtimeType().equals(snapshot.type())
                        && hasAbility(snapshot, contract)
                        && (ownEntities
                                ? snapshot.ownerSlot() == player.slot
                                : allBots(player, opponent).stream()
                                        .anyMatch(bot -> bot.entityTeam() != player.entityTeam()
                                                && bot.slot == snapshot.ownerSlot())))
                .toList();
    }

    /**
     * Resolves bot selectors from the acting bot's stable match roster. The
     * legacy {@code opponent} selector remains an alias for the first enemy so
     * existing 1v1 brains continue to behave exactly as before.
     */
    private static Bot botSelectable(String selectableId, Bot player, Bot opponent) {
        if (player == null) return null;
        if (BotLogicContracts.SELECTABLE_MY.equals(selectableId)) return player;
        int index = BotLogicContracts.botSelectableIndex(selectableId);
        if (index < 1) return null;
        List<Bot> candidates = BotLogicContracts.isTeammateSelectable(selectableId)
                ? allBots(player, opponent).stream()
                        .filter(bot -> bot != player && bot.entityTeam() == player.entityTeam())
                        .sorted(Comparator.comparingInt(bot -> bot.slot))
                        .toList()
                : allBots(player, opponent).stream()
                        .filter(bot -> bot != player && bot.entityTeam() != player.entityTeam())
                        .sorted(Comparator.comparingInt(bot -> bot.slot))
                        .toList();
        return candidates.size() >= index ? candidates.get(index - 1) : null;
    }

    private static List<Bot> allBots(Bot player, Bot opponent) {
        List<Bot> roster = player != null && player.matchBots != null && !player.matchBots.isEmpty()
                ? player.matchBots : List.of(player, opponent);
        return roster.stream()
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }

    private static boolean hasAbility(SelectableSnapshot snapshot, SelectableContract contract) {
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
        return entity instanceof SelectableSnapshot snapshot ? snapshot.ageMs() : 0;
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
