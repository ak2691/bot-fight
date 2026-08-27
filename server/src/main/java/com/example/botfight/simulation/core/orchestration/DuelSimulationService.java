package com.example.botfight.simulation.core.orchestration;

import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.simulation.core.combat.AbilityExecutionPayload;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.combat.ProjectileSimulationService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.logic.TargetingService;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.ecs.entities.ClosingZoneSystem;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.geometry.ArenaUnits;
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
    private static final double CUSTOM_NUMBER_LIMIT = BotLogicContracts.CUSTOM_NUMBER_LIMIT;
    private static final int MAX_ROOTS = 100;
    private static final int MIN_PRIORITY = 1;
    private static final int MAX_PRIORITY = 10;
    private static final ClosingZoneConfig CLOSING_ZONE_CONFIG = ClosingZoneConfig.duelV1();
    public static final int SIMULATION_DURATION_MS = CLOSING_ZONE_CONFIG.simulationDurationMs();

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
        return simulate(request, new FullReplayRecorder());
    }

    /**
     * Runs the authoritative duel for a server-side consumer that needs only
     * tick observations, such as puzzle validation.  No replay frames are
     * retained or returned.
     */
    public void simulateWithoutReplay(DuelSimulationRequest request, SimulationTickObserver observer) {
        if (observer == null) throw new IllegalArgumentException("simulation observer is required");
        simulate(request, new NoReplayRecorder(), observer);
    }

    /**
     * Runs the authoritative duel while recording only the compact replay
     * representation used by the matchmaking socket.  The mutable Bot
     * objects remain full-fidelity working state; only the retained replay
     * snapshots are compact.
     */
    public MatchReplayDTO simulateCompact(DuelSimulationRequest request) {
        return simulate(request, new CompactReplayRecorder());
    }

    private <T> T simulate(DuelSimulationRequest request, ReplayRecorder<T> replayRecorder) {
        return simulate(request, replayRecorder, null);
    }

    private <T> T simulate(
            DuelSimulationRequest request,
            ReplayRecorder<T> replayRecorder,
            SimulationTickObserver observer) {
        if (request == null || !DUEL_RULESET_VERSION.equals(request.rulesetVersion())) {
            throw new IllegalArgumentException("rulesetVersion must be duel-v1");
        }
        if (request.bots() == null || request.bots().size() != 2) {
            throw new IllegalArgumentException("duel-v1 requires exactly two bots");
        }

        Arena arena = new Arena(
                request.arena() != null ? request.arena().width() : ARENA_WIDTH_UNITS,
                request.arena() != null ? request.arena().height() : ARENA_HEIGHT_UNITS,
                request.arena() != null ? request.arena().durationMs() : SIMULATION_DURATION_MS);
        int initialElapsedMs = request.arena() == null
                ? 0
                : request.arena().initialElapsedMs();
        if (initialElapsedMs < 0
                || initialElapsedMs > SIMULATION_DURATION_MS
                || (long) initialElapsedMs + Math.max(0L, (long) arena.durationMs()) > SIMULATION_DURATION_MS) {
            throw new IllegalArgumentException("initialElapsedMs must leave room within the 90 second duel");
        }

        List<Bot> bots = request.bots().stream()
                .map(botStateService::create)
                .map(this::prepareStrategy)
                .toList();
        bots.forEach(bot -> bot.matchElapsedMs = initialElapsedMs);
        replayRecorder.initialize(arena, bots);
        List<ArenaEntity> projectiles = new ArrayList<>();
        List<ArenaEntity> abilityPlacements = new ArrayList<>();
        ClosingZoneSystem.State closingZone = null;

        // The browser applies its first fixed step after AUTO_STEP_MS has
        // elapsed. Keep replay timestamps and the number of simulated steps on
        // that same clock: a frame at 100 ms is the result of exactly one
        // 100 ms step. Starting at zero used to apply an unaccounted step and
        // run once beyond the requested duration, making movement and every
        // cooldown appear one tick ahead in authoritative replays.
        for (int elapsedMs = STEP_MS, tick = 1; elapsedMs <= arena.durationMs(); elapsedMs += STEP_MS, tick += 1) {
            abilityPlacements = advanceEntityAges(abilityPlacements);
            projectiles = advanceEntityAges(projectiles);
            for (Bot bot : bots) {
                botStateService.startTick(bot);
            }
            List<Entity> selectables = new ArrayList<>();
            abilityPlacements.stream()
                    .map(DuelSimulationService::selectableSnapshot)
                    .forEach(selectables::add);
            projectiles.stream().map(DuelSimulationService::selectableSnapshot).forEach(selectables::add);
            Action firstPredicted = predictAction(bots.get(0), bots.get(1), selectables, arena);
            Action secondPredicted = predictAction(bots.get(1), bots.get(0), selectables, arena);
            actionExecutionService.execute(bots.get(0), firstPredicted, arena);
            actionExecutionService.execute(bots.get(1), secondPredicted, arena);
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
            projectileSimulationService.applyImpacts(bots, projectileUpdate.impacts());
            List<ArenaEntity> spawnedEffects = projectileUpdate.effects();
            List<ArenaEntity> entitiesForTick = new ArrayList<>(abilityPlacements);
            entitiesForTick.addAll(spawnedEffects);
            abilityPlacements = updateAbilityPlacements(
                    entitiesForTick, bots, arena, projectiles, List.of());
            ClosingZoneSystem.TickResult<Bot> closingZoneUpdate = ClosingZoneSystem.tick(
                    closingZone,
                    initialElapsedMs + elapsedMs,
                    STEP_MS,
                    arena.width(),
                    arena.height(),
                    bots,
                    CLOSING_ZONE_CONFIG,
                    new ClosingZoneSystem.Damage<>() {
                        @Override
                        public double maxHp(Bot bot) {
                            return bot.maxHp;
                        }

                        @Override
                        public void apply(Bot bot, double amount) {
                            botStateService.applyClosingZoneDamage(bot, amount);
                        }
                    });
            closingZone = closingZoneUpdate.state();
            bots.forEach(botStateService::settleTick);

            List<ArenaEntity> frameEntities = new ArrayList<>(projectiles);
            frameEntities.addAll(abilityPlacements);
            if (closingZoneUpdate.entity() != null) frameEntities.add(closingZoneUpdate.entity());
            replayRecorder.addFrame(tick, elapsedMs, bots, frameEntities);
            if (observer != null && observer.afterTick(elapsedMs, bots, frameEntities, arena)) {
                return replayRecorder.complete(request.matchId(), null);
            }

            boolean firstDefeated = bots.get(0).hp <= 0;
            boolean secondDefeated = bots.get(1).hp <= 0;
            if (firstDefeated || secondDefeated) {
                Bot winner = firstDefeated == secondDefeated
                        ? null
                        : firstDefeated ? bots.get(1) : bots.get(0);
                return replayRecorder.complete(request.matchId(), winner);
            }
        }

        return replayRecorder.complete(request.matchId(), null);
    }

    @FunctionalInterface
    public interface SimulationTickObserver {
        boolean afterTick(int elapsedMs, List<Bot> bots, List<ArenaEntity> entities, Arena arena);
    }

    private interface ReplayRecorder<T> {
        void initialize(Arena arena, List<Bot> bots);

        void addFrame(int tick, int elapsedMs, List<Bot> bots, List<ArenaEntity> entities);

        T complete(UUID matchId, Bot winner);
    }

    private static final class NoReplayRecorder implements ReplayRecorder<Void> {
        @Override
        public void initialize(Arena arena, List<Bot> bots) { }

        @Override
        public void addFrame(int tick, int elapsedMs, List<Bot> bots, List<ArenaEntity> entities) { }

        @Override
        public Void complete(UUID matchId, Bot winner) { return null; }
    }

    private final class FullReplayRecorder implements ReplayRecorder<MatchPlaybackDTO> {
        private MatchPlaybackDTO.ArenaStateDTO initialState;
        private final List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();

        @Override
        public void initialize(Arena arena, List<Bot> bots) {
            initialState = new MatchPlaybackDTO.ArenaStateDTO(
                    arena.width(),
                    arena.height(),
                    bots.stream().map(replayMappingService::toBotState).toList(),
                    List.of());
        }

        @Override
        public void addFrame(int tick, int elapsedMs, List<Bot> bots, List<ArenaEntity> entities) {
            frames.add(new MatchPlaybackDTO.ReplayFrameDTO(
                    tick,
                    elapsedMs,
                    bots.stream().map(replayMappingService::toBotState).toList(),
                    entities.stream().map(replayMappingService::toArenaEntity).toList()));
        }

        @Override
        public MatchPlaybackDTO complete(UUID matchId, Bot winner) {
            return duelResult(matchId, initialState, frames, winner);
        }
    }

    private final class CompactReplayRecorder implements ReplayRecorder<MatchReplayDTO> {
        private MatchReplayDTO.ReplayInitialStateDTO initialState;
        private final List<MatchReplayDTO.ReplayFrameDTO> frames = new ArrayList<>();

        @Override
        public void initialize(Arena arena, List<Bot> bots) {
            initialState = replayMappingService.toReplayInitialState(bots);
        }

        @Override
        public void addFrame(int tick, int elapsedMs, List<Bot> bots, List<ArenaEntity> entities) {
            frames.add(replayMappingService.toReplayFrame(elapsedMs, bots, entities));
        }

        @Override
        public MatchReplayDTO complete(UUID matchId, Bot winner) {
            return new MatchReplayDTO(
                    initialState,
                    List.copyOf(frames),
                    winner != null ? "BOT_WIN" : "DRAW",
                    winner != null ? winner.userId : null,
                    winner != null ? winner.username + " wins the fight." : "The fight ended in a draw.",
                    null,
                    null,
                    null);
        }
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
        ActionPlan plan = selectStrategyActionPlan(player, opponent, entities, arena);
        StrategyBlock movementBlock = plan.movement;
        StrategyBlock facingBlock = plan.rotation;
        Entity movementTarget = movementBlock != null && "coordinates".equals(movementBlock.movementMode)
                ? new TargetPoint(movementBlock.targetX, movementBlock.targetY, 0)
                : TargetingService.offsetTarget(TargetingService.selectableEntity(movementBlock != null ? movementBlock.selectable : BotLogicContracts.SELECTABLE_OPPONENT, player, opponent, entities), movementBlock);
        Entity facingTarget = facingBlock != null && "coordinates".equals(facingBlock.targetMode())
                ? new TargetPoint(facingBlock.targetX(), facingBlock.targetY(), 0)
                : facingBlock != null && "angle".equals(facingBlock.targetMode())
                    ? null
                    : TargetingService.offsetTarget(TargetingService.selectableEntity(facingBlock != null
                        ? facingBlock.selectable
                        : movementBlock != null ? movementBlock.selectable : BotLogicContracts.SELECTABLE_OPPONENT, player, opponent, entities), facingBlock != null ? facingBlock : movementBlock);
        Entity abilityTarget = plan.ability != null && BotLogicContracts.actionUsesSelectableTarget(
                plan.ability.action(), plan.ability.movementMode(), plan.ability.targetMode())
                ? TargetingService.offsetTarget(TargetingService.selectableEntity(plan.ability.selectable, player, opponent, entities), plan.ability)
                : null;
        Vector movement = actionExecutionService.movementVector(movementBlock, player, movementTarget);
        return new Action(
                movement.dx(),
                movement.dy(),
                facingBlock != null && BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET.equals(facingBlock.action)
                        ? "angle".equals(facingBlock.targetMode())
                            ? turnTowardAngle(player, facingBlock.targetAngle())
                            : turnTowardTarget(player, facingTarget) : 0.0,
                actionExecutionService.configuredAbilityAction(plan.ability),
                abilityTarget != null ? abilityTarget.x() : plan.ability != null ? plan.ability.targetX : 500,
                abilityTarget != null ? abilityTarget.y() : plan.ability != null ? plan.ability.targetY : 400,
                plan.ability != null ? plan.ability.movementMode() : null,
                plan.ability != null ? plan.ability.movementDirection() : null,
                plan.ability != null ? plan.ability.phaseFacingMode() : null);
    }

    private Bot prepareStrategy(Bot bot) {
        JsonNode roots = bot.brain != null ? bot.brain.get("roots") : null;
        bot.normalizedStrategy = normalizeTreeRoots(roots);
        return bot;
    }

    private ActionPlan selectStrategyActionPlan(Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = selectPriorityEntries(player.normalizedStrategy, player, opponent, entities, arena);
        ActionPlan plan = new ActionPlan();
        plan.primary = selected.stream()
                .filter(block -> !BotLogicContracts.ACTION_VARIABLE.equals(block.action))
                .findFirst()
                .orElse(null);
        for (StrategyBlock block : selected) {
            if (BotLogicContracts.ACTION_VARIABLE.equals(block.action)) {
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

    private List<StrategyBlock> selectPriorityEntries(List<TreeRoot> roots, Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        return roots.isEmpty() ? List.of() : selectTreeEntries(roots, player, opponent, entities, arena);
    }

    private List<StrategyBlock> selectTreeEntries(List<TreeRoot> normalized, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = new ArrayList<>();
        for (TreeRoot root : normalized) {
            selected.addAll(selectTreeBranch(root.branches(), player, opponent, entities, arena));
        }
        return selected;
    }

    private List<StrategyBlock> selectTreeBranch(List<TreeBranch> branches, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = new ArrayList<>();
        for (TreeBranch branch : branches) {
            StrategyBlock conditionBlock = branch.blocks().get(0);
            boolean matches = "else".equals(branch.branchType())
                    || conditionResolutionService.evaluateConditions(conditionBlock.conditions(), player, opponent, entities, arena);
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
        if (roots == null || !roots.isArray()) return List.of();
        List<TreeRoot> normalized = new ArrayList<>();
        int[] remainingActions = { MAX_LOGIC_BLOCKS };
        int[] remainingConditions = { MAX_TOTAL_CONDITIONS };
        int limit = Math.min(roots.size(), MAX_ROOTS);
        for (int index = 0; index < limit && remainingConditions[0] > 0; index += 1) {
            JsonNode root = roots.get(index);
            normalized.add(new TreeRoot(
                    index,
                    clamp(treePriority(root, index + 1), 1, MAX_ROOTS),
                    normalizeTreeBranches(field(root, "branches"), remainingActions, remainingConditions)));
        }
        normalized.sort(Comparator.comparingDouble(TreeRoot::priority));
        return List.copyOf(normalized);
    }

    private static List<TreeBranch> normalizeTreeBranches(JsonNode branches, int[] remainingActions, int[] remainingConditions) {
        if (branches == null || !branches.isArray() || remainingConditions[0] <= 0) return List.of();
        List<TreeBranch> normalized = new ArrayList<>();
        for (int index = 0; index < branches.size() && remainingConditions[0] > 0; index += 1) {
            JsonNode branch = branches.get(index);
            List<StrategyBlock> blocks = new ArrayList<>();
            for (StrategyBlock block : normalizeTreeActions(branch, index)) {
                if (BotLogicContracts.ACTION_NONE.equals(block.action())) continue;
                int cost = strategyBlockActionCost(block);
                if (cost > remainingActions[0]) break;
                blocks.add(block);
                remainingActions[0] -= cost;
            }
            if (blocks.isEmpty()) {
                blocks = List.of(new StrategyBlock(index, BotLogicContracts.ACTION_NONE, BotLogicContracts.SELECTABLE_OPPONENT, 0, 0, "target", 500, 400, null, null, null, null, 1, ConditionResolutionService.normalizeConditions(field(branch, "conditions"))));
            }
            String branchType = index == 0 ? "if" : "else".equals(textValue(field(branch, "branchType"), "if")) ? "else" : "if";
            if ("else".equals(branchType)) {
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.selectable(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), List.of(), block.targetAngle())).toList();
            } else {
                int conditionLimit = Math.min(remainingConditions[0], blocks.isEmpty() ? 0 : blocks.get(0).conditions().size());
                List<Condition> limitedConditions = blocks.isEmpty() ? List.of() : blocks.get(0).conditions().subList(0, conditionLimit);
                remainingConditions[0] -= conditionLimit;
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.selectable(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), limitedConditions, block.targetAngle())).toList();
            }
            normalized.add(new TreeBranch(
                    branchType,
                    clamp(treePriority(branch, index + 1), 1, MAX_LOGIC_BLOCKS),
                    blocks,
                    normalizeTreeBranches(field(branch, "children"), remainingActions, remainingConditions)));
        }
        normalized.sort(Comparator.comparingDouble(TreeBranch::priority));
        return List.copyOf(normalized);
    }

    private static List<StrategyBlock> normalizeTreeActions(JsonNode branch, int index) {
        JsonNode actions = field(branch, "actions");
        List<StrategyBlock> blocks = new ArrayList<>();
        Set<String> heads = new HashSet<>();
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            for (JsonNode actionNode : actions) {
                Object action = actionValue(field(actionNode, "action"));
                String head = actionHead(action);
                String headKey = BotLogicContracts.ACTION_VARIABLE.equals(action) ? head + ":" + blocks.size() : head;
                if (!heads.add(headKey)) continue;
                blocks.add(new StrategyBlock(index, action,
                normalizeSelectable(textValue(field(actionNode, "selectable"), BotLogicContracts.SELECTABLE_OPPONENT), BotLogicContracts.SELECTABLE_OPPONENT),
                        BotLogicContracts.ACTION_VARIABLE.equals(action)
                                ? clamp(variableValue(firstNonNull(field(actionNode, "value"), field(actionNode, "operand"))), -CUSTOM_NUMBER_LIMIT, CUSTOM_NUMBER_LIMIT)
                                : clamp(numberValue(field(actionNode, "targetOffsetX"), 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                        clamp(numberValue(field(actionNode, "targetOffsetY"), 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
                        normalizeActionTargetMode(action, actionNode),
                        clamp(numberValue(field(actionNode, "targetX"), 500), 0, ARENA_WIDTH_UNITS),
                        clamp(numberValue(field(actionNode, "targetY"), 400), 0, ARENA_HEIGHT_UNITS),
                        textValue(field(actionNode, "movementMode"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? textValue(field(actionNode, "operation"), "set") : movementDirectionValue(field(actionNode, "movementDirection"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? textValue(field(actionNode, "variableId"), "") : textValue(field(actionNode, "phaseFacingMode"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? firstNonNull(field(actionNode, "operand"), field(actionNode, "terms")) : null,
                        actionPriority(branch),
                        ConditionResolutionService.normalizeConditions(field(branch, "conditions")),
                        clamp(numberValue(field(actionNode, "targetAngle"), 0), BotLogicContracts.ANGLE_MIN, BotLogicContracts.ANGLE_MAX)));
            }
        }
        if (blocks.isEmpty()) blocks.add(normalizeStrategyBlock(branch, index));
        if (blocks.stream().anyMatch(block -> !BotLogicContracts.ACTION_NONE.equals(block.action()))) {
            blocks.removeIf(block -> BotLogicContracts.ACTION_NONE.equals(block.action()));
        }
        return blocks;
    }

    private static int strategyBlockActionCost(StrategyBlock block) {
        if (block == null || BotLogicContracts.ACTION_NONE.equals(block.action())) return 0;
        JsonNode terms = block.variableTerms();
        return BotLogicContracts.ACTION_VARIABLE.equals(block.action())
                && terms != null && terms.isArray() && !terms.isEmpty() ? terms.size() : 1;
    }

    private static boolean actionUsesTarget(Object action) {
        return BotLogicContracts.actionUsesTarget(action);
    }

    private static boolean strategyBlockHasExecutableTarget(StrategyBlock block, Bot player, Bot opponent,
            List<Entity> entities) {
        if (BotLogicContracts.actionUsesCoordinates(block.action(), block.movementMode())
                || BotLogicContracts.actionUsesCoordinates(block.action(), block.targetMode())
                || BotLogicContracts.actionUsesAbsoluteAngle(block.action(), block.targetMode())) return true;
        if (!actionUsesTarget(block.action())) return true;
        return TargetingService.selectableEntity(block.selectable(), player, opponent, entities) != null;
    }

    private boolean strategyBlockExecutableNow(StrategyBlock block, Bot player, Bot opponent,
            List<Entity> entities) {
        if (!strategyBlockHasExecutableTarget(block, player, opponent, entities)) return false;
        Object action = block.action();
        if (BotLogicContracts.ACTION_VARIABLE.equals(action)) return true;
        if (BotLogicContracts.ACTION_NONE.equals(action)) return false;
        String head = actionHead(action);
        if ("movement".equals(head) || "rotation".equals(head)) return true;
        Integer ability = actionExecutionService.abilityForAction(action);
        return ability != null && actionExecutionService.selectedAbilityExecutable(player, ability);
    }

    private static StrategyBlock normalizeStrategyBlock(JsonNode block, int index) {
        Object action = actionValue(field(block, "action"));
        return new StrategyBlock(
                index,
                action,
                normalizeSelectable(textValue(field(block, "selectable"), BotLogicContracts.SELECTABLE_OPPONENT), BotLogicContracts.SELECTABLE_OPPONENT),
                BotLogicContracts.ACTION_VARIABLE.equals(action)
                        ? clamp(variableValue(firstNonNull(field(block, "value"), field(block, "operand"))), -CUSTOM_NUMBER_LIMIT, CUSTOM_NUMBER_LIMIT)
                        : clamp(numberValue(field(block, "targetOffsetX"), 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                clamp(numberValue(field(block, "targetOffsetY"), 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
                normalizeActionTargetMode(action, block),
                clamp(numberValue(field(block, "targetX"), 500), 0, ARENA_WIDTH_UNITS),
                clamp(numberValue(field(block, "targetY"), 400), 0, ARENA_HEIGHT_UNITS),
                textValue(field(block, "movementMode"), null),
                movementDirectionValue(field(block, "movementDirection"), null),
                textValue(field(block, "phaseFacingMode"), null),
                BotLogicContracts.ACTION_VARIABLE.equals(action) ? firstNonNull(field(block, "operand"), field(block, "terms")) : null,
                actionPriority(block),
                ConditionResolutionService.normalizeConditions(field(block, "conditions")),
                clamp(numberValue(field(block, "targetAngle"), 0), BotLogicContracts.ANGLE_MIN, BotLogicContracts.ANGLE_MAX));
    }

    private static String normalizeActionTargetMode(Object action, JsonNode node) {
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
        if (contract == null || !contract.coordinateTarget()) return "target";
        String fallback = field(node, "targetX") != null || field(node, "targetY") != null ? "coordinates" : "target";
        String requested = textValue(field(node, "targetMode"), fallback);
        if (contract.angleTarget() && "angle".equals(requested)) return "angle";
        if ("coordinates".equals(requested)) return "coordinates";
        return "target";
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
                    public void damage(Bot bot, double amount) {
                        botStateService.applyDamage(bot, amount);
                    }

                    @Override
                    public void damageFromOwner(List<Bot> activeBots, int ownerSlot, Bot target, double amount,
                                                double sourceX, double sourceY) {
                        Bot owner = activeBots.stream()
                                .filter(bot -> bot.slot == ownerSlot).findFirst().orElse(null);
                        if (owner != null) {
                            botStateService.applyDamage(target, amount, owner.slot, sourceX, sourceY);
                        } else {
                            botStateService.applyDamage(target, amount, ownerSlot, sourceX, sourceY);
                        }
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

    private static SelectableSnapshot selectableSnapshot(ArenaEntity entity) {
        EntityContracts.EntityContract contract = EntityContracts.forEntity(entity);
        boolean healthBearing = contract != null && contract.health() != null
                && contract.collider() != null && contract.collider().hittable();
        return new SelectableSnapshot("ability:" + entity.ownerSlot() + ":" + entity.id(), entity.type(),
                entity.x(), entity.y(), entity.size(), entity.ageMs(), healthBearing ? entity.hp() : 0,
                entity.velocityX(), entity.velocityY(), entity.abilityId(), entity.ownerSlot(),
                healthBearing ? entity.damageTakenLastTick() : 0,
                healthBearing ? entity.hpNetChangeLastTick() : 0,
                entity.rotation());
    }

    private static List<ArenaEntity> advanceEntityAges(List<ArenaEntity> entities) {
        return new ArrayList<>(entities.stream()
                .map(entity -> entity.withAgeMs(entity.ageMs() + STEP_MS))
                .toList());
    }

    private static String actionHead(Object action) {
        BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
        return contract == null ? "movement" : contract.head().name().toLowerCase();
    }

    private static Object actionValue(JsonNode node) {
        if (node != null && node.isIntegralNumber() && node.canConvertToInt()) return node.intValue();
        return textValue(node, BotLogicContracts.ACTION_NONE);
    }

    private static int normalizePriority(double value) {
        return (int) clamp(Math.round(Double.isFinite(value) ? value : 1.0), MIN_PRIORITY, MAX_PRIORITY);
    }

    private static String normalizeSelectable(String selectableId, String fallback) {
        if (BotLogicContracts.isAllowedSelectable(selectableId)) return selectableId;
        return fallback;
    }

    private static JsonNode field(JsonNode node, String field) {
        return node != null && node.isObject() ? node.get(field) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static String movementDirectionValue(JsonNode node, String fallback) {
        if (node != null && (node.isTextual() || (node.isNumber() && Double.isFinite(node.asDouble())))) {
            return node.asText();
        }
        return fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber()
                ? BotLogicContracts.truncateToNumberPrecision(node.asDouble())
                : fallback;
    }

    private static double treePriority(JsonNode node, double fallback) {
        JsonNode legacyCreatedOrder = field(node, "createdOrder");
        if (legacyCreatedOrder != null && legacyCreatedOrder.isNumber()) {
            return numberValue(legacyCreatedOrder, fallback - 1) + 1;
        }
        return numberValue(field(node, "priority"), fallback);
    }

    private static int actionPriority(JsonNode node) {
        JsonNode explicitActionPriority = field(node, "actionPriority");
        if (explicitActionPriority != null && explicitActionPriority.isNumber()) {
            return normalizePriority(numberValue(explicitActionPriority, 1.0));
        }
        // Before tree priorities were named priority, old branch objects could
        // carry both createdOrder (tree order) and priority (flat action order).
        // Preserve that legacy action value without confusing it with the new
        // conditional priority.
        JsonNode legacyCreatedOrder = field(node, "createdOrder");
        if (legacyCreatedOrder != null && legacyCreatedOrder.isNumber()) {
            return normalizePriority(numberValue(field(node, "priority"), 1.0));
        }
        return 1;
    }

    private static double variableValue(JsonNode node) {
        if (node != null && node.isBoolean()) return node.asBoolean() ? 1 : 0;
        if (node != null && node.isObject()) return numberValue(field(node, "value"), 0);
        return numberValue(node, 0);
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
            int durationMs,
            int initialElapsedMs) {
        public DuelArenaRequest(int width, int height, int durationMs) {
            this(width, height, durationMs, 0);
        }
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
            JsonNode brain,
            Double initialHp) {
        public DuelBotRequest(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                Double rotation,
                int size,
                String selectedLoadout,
                JsonNode brain) {
            this(userId, username, slot, x, y, rotation, size, selectedLoadout, brain, null);
        }
    }

    public record Arena(int width, int height, int durationMs) {
    }

    private static double turnTowardAngle(Bot player, double targetAngle) {
        if (player == null || !Double.isFinite(targetAngle)) return 0;
        return clamp(shortestDelta(player.rotation, targetAngle) / TURN_SPEED_DEGREES, -1, 1);
    }

    public record Action(double dx, double dy, double dRot, Integer abilityAction, double abilityTargetX, double abilityTargetY,
                  String movementMode, String movementDirection, String phaseFacingMode) {
    }

    public record Vector(double dx, double dy) {
    }

    public record Velocity(double x, double y) {
    }

    public enum ValueType {
        NUMBER,
        BOOLEAN
    }

    public record StateValue(ValueType type, double numberValue, boolean booleanValue) {
        public static StateValue number(double value) {
            return new StateValue(ValueType.NUMBER, value, false);
        }

        public static StateValue bool(boolean value) {
            return new StateValue(ValueType.BOOLEAN, 0.0, value);
        }
    }

    public record Operand(String type, String valueText, double numberValue, boolean booleanValue) {
        public static Operand variable(String value) {
            return new Operand("variable", value, 0.0, false);
        }

        public static Operand number(double value) {
            return new Operand("number", "", value, false);
        }

        public static Operand bool(boolean value) {
            return new Operand("boolean", "", 0.0, value);
        }

        public StateValue toStateValue(ValueType expectedType) {
            return expectedType == ValueType.BOOLEAN
                    ? StateValue.bool(booleanValue)
                    : StateValue.number(numberValue);
        }
    }

    public record Condition(String type, double value, String selectable, String leftSelectable, String rightSelectable, String left, Integer ability, String statusEffect, String comparator, Operand right, String join) {
    }

    public record StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions, double targetAngle) {
        public StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions) {
            this(index, action, selectable, targetOffsetX, targetOffsetY, targetMode, targetX, targetY,
                    movementMode, movementDirection, phaseFacingMode, variableTerms, priority, conditions, Double.NaN);
        }
    }

    public record TargetPoint(double x, double y, int size) implements Entity {
    }

    private record TreeRoot(int index, double priority, List<TreeBranch> branches) {
    }

    private record TreeBranch(String branchType, double priority, List<StrategyBlock> blocks, List<TreeBranch> children) {
    }

    public interface Entity {
        double x();

        double y();

        int size();
    }

    public static final class Bot implements Entity, AbilityEntityBot {
        public UUID userId;
        public String username;
        public int slot;
        public double x;
        public double y;
        public double rotation;
        public int size;
        public String combatLoadout;
        public JsonNode brain;
        private List<TreeRoot> normalizedStrategy = List.of();
        public Set<Integer> abilities = Set.of();
        public double hp;
        public long matchElapsedMs;
        public double maxHp;
        public double moveSpeed;
        public double attackDamageMultiplier = 1.0;
        public double attackSpeedMultiplier = 1.0;
        public double spawnX;
        public double spawnY;
        public int abilityEntitySerial = 1;
        public Map<String, StatusEffectState> statusEffects = new HashMap<>();
        public int dashActiveMs;
        public double dashRemaining;
        public double dashStepDistance;
        public double dashDirectionX;
        public double dashDirectionY;
        public double movementVelocityX;
        public double movementVelocityY;
        public double velocityX;
        public double velocityY;
        /** Start of the movement segment swept during the current tick. */
        public double movementStartX;
        public double movementStartY;
        public int utilityHealAccumulatorMs;
        public Map<Integer, Integer> abilityCooldowns = new HashMap<>();
        /** Cooldowns reserved by an activation while its active phase is running. */
        public Map<Integer, Integer> abilityPendingCooldownMs = new HashMap<>();
        public Map<Integer, Integer> abilityActiveMs = new HashMap<>();
        public Map<Integer, Integer> abilityCharges = new HashMap<>();
        public Map<Integer, Integer> abilityRechargeMs = new HashMap<>();
        public Map<String, Object> customVariables = new HashMap<>();
        public Map<String, String> customVariableTypes = new HashMap<>();
        public Integer preparingAbility;
        public int preparingMs;
        public double preparingTargetX = Double.NaN;
        public double preparingTargetY = Double.NaN;
        public Integer triggeredAbility;
        public AbilityExecutionPayload triggeredAbilityPayload;
        public final Set<String> entityHitIds = new HashSet<>();
        public ArenaEntity abilitySpawn;
        public double pendingHealing;
        public double tickStartHp;
        public double damageTakenThisTick;
        public double damageTakenLastTick;
        /** Monotonic replay-only event count for successful closing-zone hits. */
        public int closingZoneDamageCount;
        public double hpNetChangeLastTick;
        public int temporalRewindMs;
        public double temporalRewindX;
        public double temporalRewindY;
        public double temporalRewindHp;
        public int temporalRewindPulseMs;

        public Bot() {}

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
        @Override public double entityMovementStartX() { return movementStartX; }
        @Override public double entityMovementStartY() { return movementStartY; }
        @Override public int entitySize() { return size; }
        @Override public double entityHp() { return hp; }
        public boolean alive() { return hp > 0; }
        public boolean projectileHittable() { return alive(); }
        @Override public boolean ignoresHostileEffects() {
            return !alive() || BotStateService.statusActive(this, "absolute-guard");
        }
        @Override public void setEntityPosition(double x, double y) { if (!ignoresHostileEffects()) { this.x = x; this.y = y; } }
        @Override public void applySilence(int durationMs) {
            if (!ignoresHostileEffects()) BotStateService.upsertStatusEffect(this,
                    new StatusEffectState("silence", durationMs, 0)
                            .addEffect(new StatusEffectState.Effect("silence", "constant")));
        }
        @Override public void applySlow(int durationMs) {
            if (!ignoresHostileEffects()) BotStateService.upsertStatusEffect(this,
                    new StatusEffectState("slow", durationMs, 0)
                            .addEffect(new StatusEffectState.Effect("movement_modifier", "constant")
                                    .movement(.5, .5)));
        }
        @Override public void setZoneSilenced(boolean silenced) {
            if (silenced && !ignoresHostileEffects()) {
                BotStateService.upsertStatusEffect(this,
                        new StatusEffectState("silence", 0, 0).presence("null_zone")
                                .addEffect(new StatusEffectState.Effect("silence", "constant")));
            } else if (!silenced) {
                statusEffects.entrySet().removeIf(entry -> "silence".equals(entry.getValue().type)
                        && "presence".equals(entry.getValue().mode));
            }
        }
        @Override public void applyStun(int durationMs) {
            if (!ignoresHostileEffects()) BotStateService.upsertStatusEffect(this,
                    new StatusEffectState("stun", durationMs, 0)
                            .addEffect(new StatusEffectState.Effect("stun", "constant")));
        }
        @Override public void cancelPreparation() { if (!ignoresHostileEffects()) { preparingAbility = null; preparingMs = 0; } }
    }

    public record SelectableSnapshot(
            String id,
            String type,
            double x,
            double y,
            int size,
            int ageMs,
            double hp,
            double velocityX,
            double velocityY,
            Integer abilityId,
            int ownerSlot,
            double damageTakenLastTick,
            double hpNetChangeLastTick,
            double rotation) implements Entity {
        public SelectableSnapshot(String id, String type, double x, double y, int size, int ageMs, double hp,
                              double velocityX, double velocityY, Integer abilityId, int ownerSlot) {
            this(id, type, x, y, size, ageMs, hp, velocityX, velocityY, abilityId, ownerSlot, 0.0, 0.0, 0.0);
        }
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
