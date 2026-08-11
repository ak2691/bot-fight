package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.HitStagger;
import com.example.botfight.simulation.ecs.AbilityEntityBot;
import com.example.botfight.simulation.ecs.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.ArenaBounds;
import com.example.botfight.simulation.ecs.ArenaEntity;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class DuelSimulationService {
    public static final String DUEL_RULESET_VERSION = "duel-v1";

    private static final int ARENA_WIDTH_UNITS = ArenaUnits.WIDTH;
    private static final int ARENA_HEIGHT_UNITS = ArenaUnits.HEIGHT;
    private static final int STEP_MS = 100;
    private static final double TURN_SPEED_DEGREES = 12.0;
    private static final int MAX_LOGIC_BLOCKS = 100;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final int CUSTOM_INTEGER_LIMIT = 99_999;
    private static final int MAX_ROOTS = 100;
    private static final int MIN_PRIORITY = 1;
    private static final int MAX_PRIORITY = 10;

    private final ConditionResolutionService conditionResolutionService;
    private final ReplayMappingService replayMappingService;
    private final BotStateService botStateService;
    private final ProjectileSimulationService projectileSimulationService;
    private final ActionExecutionService actionExecutionService;

    @Autowired
    public DuelSimulationService(
            ConditionResolutionService conditionResolutionService,
            ReplayMappingService replayMappingService,
            BotStateService botStateService,
            ProjectileSimulationService projectileSimulationService,
            ActionExecutionService actionExecutionService) {
        this.conditionResolutionService = conditionResolutionService;
        this.replayMappingService = replayMappingService;
        this.botStateService = botStateService;
        this.projectileSimulationService = projectileSimulationService;
        this.actionExecutionService = actionExecutionService;
    }

    /**
     * Builds the server-authoritative state that exists before the first replay
     * tick.  Preparation must use the same bot initialization as the
     * simulation itself so IDs, slots, loadouts, resources, and cooldown maps
     * cannot drift between the preparation screen and replay frames.
     */
    public MatchPlaybackDTO.ArenaStateDTO buildInitialState(DuelSimulationRequest request) {
        if (request == null || request.bots() == null || request.bots().size() != 2) {
            throw new IllegalArgumentException("duel-v1 requires exactly two bots");
        }
        int width = request.arena() != null ? request.arena().width() : ARENA_WIDTH_UNITS;
        int height = request.arena() != null ? request.arena().height() : ARENA_HEIGHT_UNITS;
        List<Bot> bots = request.bots().stream()
                .map(botStateService::create)
                .toList();
        return new MatchPlaybackDTO.ArenaStateDTO(
                width,
                height,
                bots.stream().map(replayMappingService::toBotState).toList(),
                List.of());
    }

    public MatchPlaybackDTO simulate(DuelSimulationRequest request) {
        if (request == null || !DUEL_RULESET_VERSION.equals(request.rulesetVersion())) {
            throw new IllegalArgumentException("rulesetVersion must be duel-v1");
        }
        if (request.bots() == null || request.bots().size() != 2) {
            throw new IllegalArgumentException("duel-v1 requires exactly two bots");
        }

        Arena arena = new Arena(
                request.arena() != null ? request.arena().width() : ARENA_WIDTH_UNITS,
                request.arena() != null ? request.arena().height() : ARENA_HEIGHT_UNITS,
                request.arena() != null ? request.arena().durationMs() : 60_000);

        List<Bot> bots = request.bots().stream()
                .map(botStateService::create)
                .toList();
        MatchPlaybackDTO.ArenaStateDTO initialState = new MatchPlaybackDTO.ArenaStateDTO(
                arena.width(),
                arena.height(),
                bots.stream().map(replayMappingService::toBotState).toList(),
                List.of());
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
        List<ArenaEntity> projectiles = new ArrayList<>();
        List<ArenaEntity> abilityPlacements = new ArrayList<>();

        // The browser applies its first fixed step after AUTO_STEP_MS has
        // elapsed. Keep replay timestamps and the number of simulated steps on
        // that same clock: a frame at 100 ms is the result of exactly one
        // 100 ms step. Starting at zero used to apply an unaccounted step and
        // run once beyond the requested duration, making movement and every
        // cooldown appear one tick ahead in authoritative replays.
        for (int elapsedMs = STEP_MS, tick = 1; elapsedMs <= arena.durationMs(); elapsedMs += STEP_MS, tick += 1) {
            for (Bot bot : bots) {
                botStateService.startTick(bot);
            }
            List<Entity> targetingTargets = new ArrayList<>();
            abilityPlacements.stream()
                    .map(DuelSimulationService::targetSnapshot)
                    .forEach(targetingTargets::add);
            projectiles.stream().map(DuelSimulationService::targetSnapshot).forEach(targetingTargets::add);
            Action firstPredicted = predictAction(bots.get(0), bots.get(1), targetingTargets, arena);
            Action secondPredicted = predictAction(bots.get(1), bots.get(0), targetingTargets, arena);
            Action firstAction = actionExecutionService.commandLockedAction(bots.get(0), firstPredicted);
            Action secondAction = actionExecutionService.commandLockedAction(bots.get(1), secondPredicted);
            actionExecutionService.execute(bots.get(0), firstAction, arena);
            actionExecutionService.execute(bots.get(1), secondAction, arena);
            actionExecutionService.resolveTriggeredAbilities(bots.get(0), bots.get(1), arena);
            actionExecutionService.resolveTriggeredAbilities(bots.get(1), bots.get(0), arena);
            for (Bot spawningBot : bots) {
                ArenaEntity spawn = spawningBot.abilitySpawn;
                if (spawn == null) continue;
                if (projectileSimulationService.manages(spawn)) projectiles.add(spawn);
                else abilityPlacements.add(spawn);
            }
            ProjectileSimulationService.ProjectileUpdate projectileUpdate =
                    projectileSimulationService.updateProjectiles(projectiles, bots, arena);
            projectiles = projectileUpdate.projectiles();
            actionExecutionService.resolveImmediateAbilities(bots);
            projectileSimulationService.applyImpacts(bots, projectileUpdate.impacts());
            projectileSimulationService.applyDamageOverTimeEffects(bots);
            abilityPlacements = updateAbilityPlacements(
                    abilityPlacements, bots, arena, projectiles, projectileUpdate.effects());
            bots.forEach(botStateService::settleTick);

            List<MatchPlaybackDTO.ArenaEntityDTO> frameEntities = new ArrayList<>();
            frameEntities.addAll(projectiles.stream().map(replayMappingService::toArenaEntity).toList());
            frameEntities.addAll(projectileUpdate.effects().stream().map(replayMappingService::toArenaEntity).toList());
            frameEntities.addAll(abilityPlacements.stream().map(replayMappingService::toArenaEntity).toList());

            frames.add(new MatchPlaybackDTO.ReplayFrameDTO(
                    tick,
                    elapsedMs,
                    bots.stream().map(replayMappingService::toBotState).toList(),
                    frameEntities));

            boolean firstDefeated = bots.get(0).hp <= 0;
            boolean secondDefeated = bots.get(1).hp <= 0;
            if (firstDefeated || secondDefeated) {
                Bot winner = firstDefeated == secondDefeated
                        ? null
                        : firstDefeated ? bots.get(1) : bots.get(0);
                return duelResult(request.matchId(), initialState, frames, winner);
            }
        }

        return duelResult(request.matchId(), initialState, frames, null);
    }

    private static MatchPlaybackDTO duelResult(
            UUID matchId,
            MatchPlaybackDTO.ArenaStateDTO initialState,
            List<MatchPlaybackDTO.ReplayFrameDTO> frames,
            Bot winner) {
        return new MatchPlaybackDTO(
                matchId,
                DUEL_RULESET_VERSION,
                "COMPLETED",
                initialState,
                frames,
                winner != null ? "BOT_WIN" : "DRAW",
                winner != null ? winner.userId : null,
                winner != null ? winner.username + " wins the fight." : "The fight ended in a draw.");
    }

    private Action predictAction(Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        if (player.hp <= 0) return new Action(0, 0, 0, null, 500, 400, null, null, null);
        ActionPlan plan = selectStrategyActionPlan(player.brain, player, opponent, entities, arena);
        StrategyBlock movementBlock = plan.movement;
        StrategyBlock facingBlock = plan.rotation;
        Entity movementTarget = movementBlock != null && "coordinates".equals(movementBlock.movementMode)
                ? new TargetPoint(movementBlock.targetX, movementBlock.targetY, 0)
                : TargetingService.offsetTarget(TargetingService.targetEntity(movementBlock != null ? movementBlock.actionTarget : "opponent", player, opponent, entities), movementBlock);
        Entity facingTarget = TargetingService.offsetTarget(TargetingService.targetEntity(facingBlock != null
                ? facingBlock.actionTarget
                : movementBlock != null ? movementBlock.actionTarget : "opponent", player, opponent, entities), facingBlock != null ? facingBlock : movementBlock);
        Entity abilityTarget = plan.ability != null && ("target".equals(plan.ability.targetMode) || Integer.valueOf(20).equals(plan.ability.action))
                ? TargetingService.offsetTarget(TargetingService.targetEntity(plan.ability.actionTarget, player, opponent, entities), plan.ability)
                : null;
        Vector movement = actionExecutionService.movementVector(movementBlock, player, movementTarget);
        return new Action(
                movement.dx(),
                movement.dy(),
                facingBlock != null && "rotate_toward_enemy".equals(facingBlock.action)
                        ? turnTowardTarget(player, facingTarget) : 0.0,
                actionExecutionService.configuredAbilityAction(plan.ability),
                abilityTarget != null ? abilityTarget.x() : plan.ability != null ? plan.ability.targetX : 500,
                abilityTarget != null ? abilityTarget.y() : plan.ability != null ? plan.ability.targetY : 400,
                plan.ability != null ? plan.ability.movementMode() : null,
                plan.ability != null ? plan.ability.movementDirection() : null,
                plan.ability != null ? plan.ability.phaseFacingMode() : null);
    }

    private ActionPlan selectStrategyActionPlan(JsonNode strategy, Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = selectPriorityEntries(strategy, player, opponent, entities, arena);
        ActionPlan plan = new ActionPlan();
        plan.primary = selected.stream()
                .filter(block -> !"variable".equals(block.action))
                .findFirst()
                .orElse(null);
        for (StrategyBlock block : selected) {
            if ("variable".equals(block.action)) {
                actionExecutionService.applyCustomVariableAction(
                        player, opponent, entities, arena, conditionResolutionService, block);
                continue;
            }
            String head = actionHead(block.action);
            if ("ability".equals(head) && plan.ability != null) continue;
            if ("ability".equals(head)) plan.ability = block;
            switch (head) {
                case "rotation" -> {
                    if (plan.rotation == null) plan.rotation = block;
                }
                case "ability" -> { }
                default -> {
                    if (plan.movement == null) plan.movement = block;
                }
            }
        }
        return plan;
    }

    private List<StrategyBlock> selectPriorityEntries(JsonNode strategy, Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        JsonNode roots = strategy != null ? strategy.get("roots") : null;
        return roots != null && roots.isArray()
                ? selectTreeEntries(roots, player, opponent, entities, arena)
                : List.of();
    }

    private List<StrategyBlock> selectTreeEntries(JsonNode roots, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<TreeRoot> normalized = normalizeTreeRoots(roots);
        List<StrategyBlock> selected = new ArrayList<>();
        normalized.stream()
                .sorted(Comparator.comparingDouble(TreeRoot::rootPriority))
                .forEach(root -> {
                    List<StrategyBlock> blocks = selectTreeBranch(root.branches(), player, opponent, entities, arena);
                    selected.addAll(blocks);
                });
        return selected;
    }

    private List<StrategyBlock> selectTreeBranch(List<TreeBranch> branches, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<TreeBranch> ordered = branches.stream().sorted(Comparator.comparingDouble(TreeBranch::createdOrder)).toList();
        List<StrategyBlock> selected = new ArrayList<>();
        for (TreeBranch branch : ordered) {
            StrategyBlock conditionBlock = branch.blocks().get(0);
            boolean hidden = player.jammedMs > 0 && (branch.blocks().stream().anyMatch(block -> actionUsesTarget(block.action()))
                    || conditionBlock.conditions().stream().anyMatch(DuelSimulationService::conditionUsesTarget));
            boolean matches = "else".equals(branch.branchType())
                    || (!hidden && conditionResolutionService.evaluateConditions(conditionBlock.conditions(), player, opponent, entities, arena));
            if (!matches) continue;
            List<StrategyBlock> child = selectTreeBranch(branch.children(), player, opponent, entities, arena);
            selected.addAll(child);
            branch.blocks().stream()
                    .filter(block -> strategyBlockExecutableNow(block, player, opponent, entities))
                    .forEach(selected::add);
        }
        return selected;
    }

    private static List<TreeRoot> normalizeTreeRoots(JsonNode roots) {
        List<TreeRoot> normalized = new ArrayList<>();
        int[] remainingActions = { MAX_LOGIC_BLOCKS };
        int[] remainingConditions = { MAX_TOTAL_CONDITIONS };
        int limit = Math.min(roots.size(), MAX_ROOTS);
        for (int index = 0; index < limit && remainingConditions[0] > 0; index += 1) {
            JsonNode root = roots.get(index);
            normalized.add(new TreeRoot(
                    index,
                    clamp(numberValue(field(root, "createdOrder"), index), 0, MAX_ROOTS - 1),
                    normalizeTreeBranches(field(root, "branches"), remainingActions, remainingConditions)));
        }
        return normalized;
    }

    private static List<TreeBranch> normalizeTreeBranches(JsonNode branches, int[] remainingActions, int[] remainingConditions) {
        if (branches == null || !branches.isArray() || remainingConditions[0] <= 0) return List.of();
        List<TreeBranch> normalized = new ArrayList<>();
        for (int index = 0; index < branches.size() && remainingConditions[0] > 0; index += 1) {
            JsonNode branch = branches.get(index);
            List<StrategyBlock> blocks = normalizeTreeActions(branch, index).stream()
                    .filter(block -> "none".equals(block.action()) || remainingActions[0] > 0)
                    .limit(Math.max(1, remainingActions[0]))
                    .toList();
            if (blocks.isEmpty()) {
                blocks = List.of(new StrategyBlock(index, "none", "opponent", 0, 0, "target", 500, 400, null, null, null, null, 1, ConditionResolutionService.normalizeConditions(field(branch, "conditions"))));
            }
            remainingActions[0] -= (int) blocks.stream().filter(block -> !"none".equals(block.action())).count();
            String branchType = index == 0 ? "if" : "else".equals(textValue(field(branch, "branchType"), "if")) ? "else" : "if";
            if ("else".equals(branchType)) {
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.actionTarget(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), List.of())).toList();
            } else {
                int conditionLimit = Math.min(remainingConditions[0], blocks.isEmpty() ? 0 : blocks.get(0).conditions().size());
                List<Condition> limitedConditions = blocks.isEmpty() ? List.of() : blocks.get(0).conditions().subList(0, conditionLimit);
                remainingConditions[0] -= conditionLimit;
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.actionTarget(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), limitedConditions)).toList();
            }
            normalized.add(new TreeBranch(
                    branchType,
                    numberValue(field(branch, "createdOrder"), index),
                    blocks,
                    normalizeTreeBranches(field(branch, "children"), remainingActions, remainingConditions)));
        }
        return normalized;
    }

    private static List<StrategyBlock> normalizeTreeActions(JsonNode branch, int index) {
        JsonNode actions = field(branch, "actions");
        List<StrategyBlock> blocks = new ArrayList<>();
        Set<String> heads = new HashSet<>();
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            for (JsonNode actionNode : actions) {
                Object action = actionValue(field(actionNode, "action"));
                String head = actionHead(action);
                String headKey = "variable".equals(head) ? head + ":" + textValue(field(actionNode, "variableId"), String.valueOf(blocks.size())) : head;
                if (!heads.add(headKey)) continue;
                blocks.add(new StrategyBlock(index, action,
                        normalizeTarget(textValue(field(actionNode, "actionTarget"), "opponent"), "opponent"),
                        "variable".equals(action)
                                ? clamp(numberValue(field(actionNode, "value"), 0), -CUSTOM_INTEGER_LIMIT, CUSTOM_INTEGER_LIMIT)
                                : clamp(numberValue(field(actionNode, "targetOffsetX"), 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                        clamp(numberValue(field(actionNode, "targetOffsetY"), 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
                        textValue(field(actionNode, "targetMode"), field(actionNode, "targetX") != null || field(actionNode, "targetY") != null ? "coordinates" : "target"),
                        clamp(numberValue(field(actionNode, "targetX"), 500), 0, ARENA_WIDTH_UNITS),
                        clamp(numberValue(field(actionNode, "targetY"), 400), 0, ARENA_HEIGHT_UNITS),
                        textValue(field(actionNode, "movementMode"), null),
                        "variable".equals(action) ? textValue(field(actionNode, "operation"), "set") : textValue(field(actionNode, "movementDirection"), null),
                        "variable".equals(action) ? textValue(field(actionNode, "variableId"), "") : textValue(field(actionNode, "phaseFacingMode"), null),
                        "variable".equals(action) ? field(actionNode, "terms") : null,
                        normalizePriority(numberValue(field(branch, "priority"), 1.0)),
                        ConditionResolutionService.normalizeConditions(field(branch, "conditions"))));
            }
        }
        if (blocks.isEmpty()) blocks.add(normalizeStrategyBlock(branch, index));
        if (blocks.stream().anyMatch(block -> !"none".equals(block.action()))) {
            blocks.removeIf(block -> "none".equals(block.action()));
        }
        return blocks;
    }

    private static boolean actionUsesTarget(Object action) {
        return "move_walk".equals(action) || "rotate_toward_enemy".equals(action)
                || Integer.valueOf(19).equals(action) || Integer.valueOf(20).equals(action);
    }

    private static boolean strategyBlockHasExecutableTarget(StrategyBlock block, Bot player, Bot opponent,
            List<Entity> entities) {
        if (("move_walk".equals(block.action()) || Integer.valueOf(19).equals(block.action()))
                && ("absolute".equals(block.movementMode()) || "coordinates".equals(block.movementMode()))) return true;
        if (!actionUsesTarget(block.action())
                && !(Set.of(22, 24).contains(block.action()) && "target".equals(block.targetMode()))) return true;
        return TargetingService.targetEntity(block.actionTarget(), player, opponent, entities) != null;
    }

    private boolean strategyBlockExecutableNow(StrategyBlock block, Bot player, Bot opponent,
            List<Entity> entities) {
        if (!strategyBlockHasExecutableTarget(block, player, opponent, entities)) return false;
        Object action = block.action();
        if ("variable".equals(action)) return true;
        if ("none".equals(action)) return false;
        String head = actionHead(action);
        if ("movement".equals(head) || "rotation".equals(head)) return true;
        Integer ability = actionExecutionService.abilityForAction(action);
        return ability != null && actionExecutionService.selectedAbilityReady(player, ability);
    }

    private static boolean conditionUsesTarget(Condition condition) {
        if ("expression".equals(condition.type())) {
            return variableUsesHiddenTarget(condition.left())
                    || (condition.right() != null
                    && "variable".equals(condition.right().type())
                    && variableUsesHiddenTarget(condition.right().valueText()));
        }
        return condition.type().startsWith("enemy_")
                || condition.type().startsWith("opponent_")
                || condition.type().startsWith("target_");
    }

    private static boolean variableUsesHiddenTarget(String variableId) {
        return variableId != null
                && (variableId.startsWith("opponent.") || variableId.startsWith("target."));
    }

    private static StrategyBlock normalizeStrategyBlock(JsonNode block, int index) {
        return new StrategyBlock(
                index,
                actionValue(field(block, "action")),
                normalizeTarget(textValue(field(block, "actionTarget"), "opponent"), "opponent"),
                clamp(numberValue(field(block, "targetOffsetX"), 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                clamp(numberValue(field(block, "targetOffsetY"), 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
                textValue(field(block, "targetMode"), field(block, "targetX") != null || field(block, "targetY") != null ? "coordinates" : "target"),
                clamp(numberValue(field(block, "targetX"), 500), 0, ARENA_WIDTH_UNITS),
                clamp(numberValue(field(block, "targetY"), 400), 0, ARENA_HEIGHT_UNITS),
                textValue(field(block, "movementMode"), null),
                textValue(field(block, "movementDirection"), null),
                textValue(field(block, "phaseFacingMode"), null),
                field(block, "terms"),
                normalizePriority(numberValue(field(block, "priority"), 1.0)),
                ConditionResolutionService.normalizeConditions(field(block, "conditions")));
    }

    private List<ArenaEntity> updateAbilityPlacements(
            List<ArenaEntity> placements,
            List<Bot> bots,
            Arena arena,
            List<ArenaEntity> projectiles,
            List<ArenaEntity> projectileEffects) {
        return AbilityEntitySystem.tick(placements, bots, new ArenaBounds(arena.width(), arena.height()), STEP_MS,
                new AbilityEntitySystem.Combat<>() {
                    @Override
                    public void damage(Bot bot, int amount) {
                        botStateService.applyDamage(bot, amount);
                    }

                    @Override
                    public void damageFromOwner(List<Bot> activeBots, int ownerSlot, Bot target, int amount) {
                        Bot owner = activeBots.stream()
                                .filter(bot -> bot.slot == ownerSlot).findFirst().orElse(null);
                        if (owner != null) botStateService.applyDamageFrom(owner, target, amount);
                        else botStateService.applyDamage(target, amount);
                    }

                    @Override
                    public int damageToEntity(ArenaEntity entity, List<Bot> activeBots,
                                              List<ArenaEntity> activeEntities) {
                        return actionExecutionService.damageToDroneThisTick(
                                entity, activeBots, projectileEffects, projectiles, activeEntities);
                    }

                    @Override
                    public boolean entityHitByCurrentAttack(ArenaEntity entity, List<Bot> activeBots,
                                                             List<ArenaEntity> activeEntities) {
                        boolean recordedHit = activeBots.stream()
                                .anyMatch(bot -> bot.entityHitIds.contains(entity.id()));
                        return recordedHit || actionExecutionService.mineHitByCurrentAttack(
                                entity, activeBots, projectiles, activeEntities);
                    }

                    @Override
                    public AbilityEntitySystem.ShieldResult shield(
                            Bot bot, double sourceX, double sourceY, int abilityId) {
                        return botStateService.resolveShield(bot, sourceX, sourceY, abilityId);
                    }
                });
    }

    private static boolean overlapsShape(Entity first, Entity second, double padding) {
        return Math.hypot(first.x() - second.x(), first.y() - second.y())
                <= ((first.size()) + second.size()) / 2.0 + padding;
    }

    private static TargetSnapshot targetSnapshot(ArenaEntity entity) {
        return new TargetSnapshot("ability:" + entity.ownerSlot() + ":" + entity.id(), entity.type(),
                entity.x(), entity.y(), entity.size(), entity.timerMs(), entity.hp(),
                entity.velocityX(), entity.velocityY());
    }

    private static String actionHead(Object action) {
        if ("variable".equals(action)) return "variable";
        if ("rotate_toward_enemy".equals(action)) return "rotation";
        return AbilityContracts.containsAction(action) ? "ability" : "movement";
    }

    private static Object actionValue(JsonNode node) {
        if (node != null && node.isIntegralNumber() && node.canConvertToInt()) return node.intValue();
        return textValue(node, "none");
    }

    private static int normalizePriority(double value) {
        return (int) clamp(Math.round(Double.isFinite(value) ? value : 1.0), MIN_PRIORITY, MAX_PRIORITY);
    }

    private static String normalizeTarget(String target, String fallback) {
        if ("opponent".equals(target) || "orbital_zone".equals(target)
                || target.startsWith("opponent_")
                || "opponent_grenade".equals(target) || "opponent_fireball".equals(target)) return target;
        return fallback;
    }

    private static JsonNode field(JsonNode node, String field) {
        return node != null && node.isObject() ? node.get(field) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber() ? node.asDouble() : fallback;
    }

    private static Operand normalizeOperand(JsonNode node) {
        if (node == null || !node.isObject()) return Operand.number(0.0);
        String type = textValue(node.get("type"), "number");
        if ("variable".equals(type)) {
            return Operand.variable(textValue(node.get("value"), ""));
        }
        if ("boolean".equals(type)) {
            return Operand.bool(booleanValue(node.get("value"), true));
        }
        return Operand.number(numberValue(node.get("value"), 0.0));
    }

    private static boolean booleanValue(JsonNode node, boolean fallback) {
        if (node == null) return fallback;
        if (node.isBoolean()) return node.asBoolean();
        if (node.isNumber()) return node.asInt() != 0;
        if (node.isTextual()) {
            String value = node.asText();
            if ("true".equalsIgnoreCase(value) || "1".equals(value)) return true;
            if ("false".equalsIgnoreCase(value) || "0".equals(value)) return false;
        }
        return fallback;
    }

    private static double edgeDistanceUnits(Entity entity, Arena arena) {
        double radius = entity.size() / 2.0;
        return Math.max(0, Math.min(
                Math.min(entity.x() - radius, arena.width() - radius - entity.x()),
                Math.min(entity.y() - radius, arena.height() - radius - entity.y())));
    }

    private static double turnTowardTarget(Bot player, Entity target) {
        if (player == null || target == null) return 0;
        double bearing = vectorBearing(target.x() - player.x, target.y() - player.y);
        return clamp(shortestDelta(player.rotation, bearing) / TURN_SPEED_DEGREES, -1, 1);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T value : values) {
            if (value != null) return value;
        }
        return null;
    }

    public record DuelSimulationRequest(
            UUID matchId,
            String rulesetVersion,
            long seed,
            DuelArenaRequest arena,
            List<DuelBotRequest> bots) {
    }

    public record DuelArenaRequest(
            int width,
            int height,
            int durationMs) {
    }

    public record DuelBotRequest(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            Double rotation,
            int size,
            String selectedLoadout,
            JsonNode brain) {
    }

    record Arena(int width, int height, int durationMs) {
    }

    record Action(double dx, double dy, double dRot, Integer abilityAction, double abilityTargetX, double abilityTargetY,
                  String movementMode, String movementDirection, String phaseFacingMode) {
    }

    record Vector(double dx, double dy) {
    }

    record Velocity(double x, double y) {
    }

    enum ValueType {
        NUMBER,
        BOOLEAN
    }

    record StateValue(ValueType type, double numberValue, boolean booleanValue) {
        static StateValue number(double value) {
            return new StateValue(ValueType.NUMBER, value, false);
        }

        static StateValue bool(boolean value) {
            return new StateValue(ValueType.BOOLEAN, 0.0, value);
        }
    }

    record Operand(String type, String valueText, double numberValue, boolean booleanValue) {
        static Operand variable(String value) {
            return new Operand("variable", value, 0.0, false);
        }

        static Operand number(double value) {
            return new Operand("number", "", value, false);
        }

        static Operand bool(boolean value) {
            return new Operand("boolean", "", 0.0, value);
        }

        StateValue toStateValue(ValueType expectedType) {
            return expectedType == ValueType.BOOLEAN
                    ? StateValue.bool(booleanValue)
                    : StateValue.number(numberValue);
        }
    }

    record Modulo(double divisor, String comparator, boolean valid) {
    }

    record Condition(String type, double value, String target, String leftTarget, String rightTarget, String left, Integer ability, String statusEffect, String comparator, Operand right, Modulo modulo, double rangeMin, double rangeMax, String join) {
    }

    record StrategyBlock(int index, Object action, String actionTarget, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions) {
    }

    record TargetPoint(double x, double y, int size) implements Entity {
    }

    private record TreeRoot(int index, double rootPriority, List<TreeBranch> branches) {
    }

    private record TreeBranch(String branchType, double createdOrder, List<StrategyBlock> blocks, List<TreeBranch> children) {
    }

    interface Entity {
        double x();

        double y();

        int size();
    }

    static final class Bot implements Entity, AbilityEntityBot {
        UUID userId;
        String username;
        int slot;
        double x;
        double y;
        double rotation;
        int size;
        String combatLoadout;
        JsonNode brain;
        Set<Integer> abilities = Set.of();
        int hp;
        long matchElapsedMs;
        int maxHp;
        double moveSpeed;
        double attackDamageMultiplier = 1.0;
        double attackSpeedMultiplier = 1.0;
        double spawnX;
        double spawnY;
        int shieldHp;
        int slowedMs;
        int hitStaggerMs;
        int jammedMs;
        int commandLockedMs;
        Action commandLockAction;
        int abilityEntitySerial = 1;
        int burnRemainingMs;
        int burnTickMs;
        Integer burnAbilityId;
        double burnDamageMultiplier = 1.0;
        int burnSourceSlot;
        int stunnedMs;
        int microDashActiveMs;
        double microDashRemaining;
        double microDashStepDistance;
        double microDashDirectionX;
        double microDashDirectionY;
        int shockRemainingMs;
        int shockTickElapsedMs;
        int shockSourceSlot;
        int bleedSourceSlot;
        int movementLockMs;
        double movementVelocityX;
        double movementVelocityY;
        double velocityX;
        double velocityY;
        int utilityHealAccumulatorMs;
        Map<Integer, Integer> abilityCooldowns = new HashMap<>();
        Map<Integer, Integer> abilityActiveMs = new HashMap<>();
        Map<Integer, Integer> abilityCharges = new HashMap<>();
        Map<Integer, Integer> abilityRechargeMs = new HashMap<>();
        Map<String, Object> customVariables = new HashMap<>();
        Map<String, String> customVariableTypes = new HashMap<>();
        Map<String, JsonNode> customVariableConditions = new HashMap<>();
        Set<String> resolvingCustomVariables = new HashSet<>();
        Integer preparingAbility;
        int preparingMs;
        double preparingTargetX = Double.NaN;
        double preparingTargetY = Double.NaN;
        Integer triggeredAbility;
        String triggeredMovementMode;
        String triggeredMovementDirection;
        String triggeredPhaseFacingMode;
        final Set<String> entityHitIds = new HashSet<>();
        ArenaEntity abilitySpawn;
        double abilityTargetX = Double.NaN;
        double abilityTargetY = Double.NaN;
        int silencedMs;
        boolean nullZoneSilenced;
        int quickJabComboCount;
        int quickJabComboMs;
        int bleedRemainingMs;
        int bleedTickMs;
        int pendingHealing;
        int tickStartHp;
        int damageTakenThisTick;
        int damageTakenLastTick;
        int hpNetChangeLastTick;
        int temporalRewindMs;
        double temporalRewindX;
        double temporalRewindY;
        int temporalRewindHp;
        int temporalRewindPulseMs;

        @Override
        public double x() {
            return x;
        }

        @Override
        public double y() {
            return y;
        }

        @Override
        public int size() {
            return size;
        }

        @Override public int entitySlot() { return slot; }
        @Override public double entityX() { return x; }
        @Override public double entityY() { return y; }
        @Override public int entitySize() { return size; }
        @Override public int entityHp() { return hp; }
        boolean alive() { return hp > 0; }
        boolean projectileHittable() { return alive(); }
        @Override public boolean ignoresHostileEffects() { return !alive() || abilityActiveMs.getOrDefault(23, 0) > 0; }
        @Override public void setEntityPosition(double x, double y) { if (!ignoresHostileEffects()) { this.x = x; this.y = y; } }
        @Override public void applySilence(int durationMs) { if (!ignoresHostileEffects()) silencedMs = Math.max(silencedMs, durationMs); }
        @Override public void setZoneSilenced(boolean silenced) { if (!silenced || !ignoresHostileEffects()) nullZoneSilenced = silenced; }
        @Override public void applyStun(int durationMs) { if (!ignoresHostileEffects()) stunnedMs = Math.max(stunnedMs, durationMs); }
        @Override public void cancelPreparation() { if (!ignoresHostileEffects()) { preparingAbility = null; preparingMs = 0; } }
    }

    record TargetSnapshot(
            String id,
            String type,
            double x,
            double y,
            int size,
            int usesRemaining,
            int hp,
            double velocityX,
            double velocityY) implements Entity {
    }

    private static final class ActionPlan {
        private StrategyBlock primary;
        private StrategyBlock movement;
        private StrategyBlock ability;
        private StrategyBlock rotation;
    }

    private static final class SeededRandom {
        private int state;

        private SeededRandom(String seedValue) {
            state = 0x811C9DC5;
            String seedText = seedValue != null ? seedValue : "";
            for (int index = 0; index < seedText.length(); index += 1) {
                state ^= seedText.charAt(index);
                state *= 16_777_619;
            }
        }

        private double next() {
            state += 0x6D2B79F5;
            int value = state;
            value = (value ^ (value >>> 15)) * (value | 1);
            value ^= value + ((value ^ (value >>> 7)) * (value | 61));
            long unsigned = Integer.toUnsignedLong(value ^ (value >>> 14));
            return unsigned / 4_294_967_296.0;
        }
    }
}
