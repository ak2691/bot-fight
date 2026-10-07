package com.example.botfight.simulation.core.orchestration;

import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.core.combat.AbilityExecutionPayload;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.AimPrediction;
import com.example.botfight.simulation.core.logic.ChainRuntime;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.logic.TargetingService;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StaminaSystem;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.ecs.entities.ClosingZoneSystem;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.geometry.ArenaUnits;
import com.example.botfight.simulation.geometry.ArenaCoordinates;
import java.util.ArrayList;
import java.util.Comparator;
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
    public static final String DUEL_RULESET_VERSION = "duel-v2";
    /** Maximum roster size accepted by the bounded XvX simulator contract. */
    public static final int MAX_SIMULATION_BOTS = 8;

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
    /** Timed rounds: up to six consecutive segments of at most 20 s, 120 s in all. */
    public static final int SEGMENT_DURATION_MS = 20_000;
    public static final int MAX_SEGMENTS = 6;
    /** Result of a segment that ended with no knockout and more segments to come. */
    public static final String SEGMENT_CONTINUES = "CONTINUES";
    private static final int MAX_VARIABLE_RESETS = 100;
    private static final int MAX_VARIABLE_RESET_LENGTH = 64;

    private final ConditionResolutionService conditionResolutionService;
    private final ReplayMappingService replayMappingService;
    private final BotStateService botStateService;
    private final ActionExecutionService actionExecutionService;

    @Autowired
    public DuelSimulationService(
            ConditionResolutionService conditionResolutionService,
            ReplayMappingService replayMappingService,
            BotStateService botStateService,
            ActionExecutionService actionExecutionService) {
        this.conditionResolutionService = conditionResolutionService;
        this.replayMappingService = replayMappingService;
        this.botStateService = botStateService;
        this.actionExecutionService = actionExecutionService;
    }

    /**
     * Builds the server-authoritative state that exists before the first replay
     * tick.  Preparation must use the same bot initialization as the
     * simulation itself so IDs, slots, loadouts, resources, and cooldown maps
     * cannot drift between the preparation screen and replay frames.
     */
    public MatchPlaybackDTO.ArenaStateDTO buildInitialState(DuelSimulationRequest request) {
        validateBotRoster(request);
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
            throw new IllegalArgumentException("rulesetVersion must be duel-v2");
        }
        validateBotRoster(request);

        // A segmented request runs the timed-rounds schedule: its own zone and a longer cap. The
        // single-segment path below keeps the single-fight zone and its 90 second cap exactly.
        List<SegmentRequest> segments = request.segments() == null ? List.of() : request.segments();
        boolean segmented = !segments.isEmpty();
        ClosingZoneConfig zoneConfig = segmented ? ClosingZoneConfig.timedRoundsV2() : CLOSING_ZONE_CONFIG;
        int maxDurationMs = zoneConfig.simulationDurationMs();
        if (segmented) validateSegments(request, segments, maxDurationMs);
        int requestedDurationMs = segmented
                ? segments.get(segments.size() - 1).endsAtMs()
                : request.arena() != null ? request.arena().durationMs() : SIMULATION_DURATION_MS;
        Arena arena = new Arena(
                request.arena() != null ? request.arena().width() : ARENA_WIDTH_UNITS,
                request.arena() != null ? request.arena().height() : ARENA_HEIGHT_UNITS,
                requestedDurationMs,
                zoneConfig);
        int initialElapsedMs = request.arena() == null
                ? 0
                : request.arena().initialElapsedMs();
        if (initialElapsedMs < 0
                || initialElapsedMs > maxDurationMs
                || (long) initialElapsedMs + Math.max(0L, (long) arena.durationMs()) > maxDurationMs
                || (segmented && initialElapsedMs != 0)) {
            throw new IllegalArgumentException("initialElapsedMs must leave room within the "
                    + maxDurationMs / 1000 + " second duel");
        }

        List<Bot> bots = request.bots().stream()
                .map(botStateService::create)
                .map(this::prepareStrategy)
                .toList();
        attachRoster(bots);
        bots.forEach(bot -> bot.matchElapsedMs = initialElapsedMs);

        // The recorder keeps only the requested segment. Its initial state is the bot state at that
        // segment's boundary (after the brain swap), and its frames are relative to the boundary.
        int recordStartMs = segmented && request.recordFromMs() != null ? request.recordFromMs() : 0;
        int loopEndMs = arena.durationMs();
        // Asking for one segment stops the run when that segment ends: later segments cannot change it.
        if (segmented && request.recordFromMs() != null) {
            loopEndMs = Math.min(loopEndMs, segmentEndAfter(segments, recordStartMs));
        }
        int recordTickOffset = recordStartMs / STEP_MS;
        boolean recording = false;
        if (recordStartMs == 0) {
            replayRecorder.initialize(arena, bots);
            recording = true;
        }
        int nextSegment = 1;
        List<ArenaEntity> entities = new ArrayList<>();
        ClosingZoneSystem.State closingZone = null;

        // The browser applies its first fixed step after AUTO_STEP_MS has
        // elapsed. Keep replay timestamps and the number of simulated steps on
        // that same clock: a frame at 100 ms is the result of exactly one
        // 100 ms step. Starting at zero used to apply an unaccounted step and
        // run once beyond the requested duration, making movement and every
        // cooldown appear one tick ahead in authoritative replays.
        for (int elapsedMs = STEP_MS, tick = 1; elapsedMs <= loopEndMs; elapsedMs += STEP_MS, tick += 1) {
            // A segment boundary is the end of the previous tick: swap each bot's brain and loadout
            // before any logic of this tick runs, then start recording if this is the target segment.
            int boundaryMs = elapsedMs - STEP_MS;
            if (nextSegment < segments.size() && boundaryMs == segments.get(nextSegment - 1).endsAtMs()) {
                applySegment(bots, segments.get(nextSegment));
                nextSegment += 1;
            }
            if (!recording && boundaryMs == recordStartMs) {
                replayRecorder.initialize(arena, bots);
                recording = true;
            }
            entities = advanceEntityAges(entities);
            for (Bot bot : bots) {
                botStateService.startTick(bot);
            }
            List<Entity> selectables = new ArrayList<>();
            entities.stream().map(DuelSimulationService::selectableSnapshot).forEach(selectables::add);
            List<Action> predictedActions = bots.stream()
                    .map(bot -> predictAction(bot, firstEnemy(bot, bots), selectables, arena))
                    .toList();
            for (int index = 0; index < bots.size(); index++) {
                bots.get(index).lastPredictedAction = predictedActions.get(index);
                actionExecutionService.execute(bots.get(index), predictedActions.get(index), arena);
            }
            for (Bot attacker : bots) {
                actionExecutionService.resolveTriggeredAbilities(attacker, bots, arena);
            }
            for (Bot spawningBot : bots) {
                ArenaEntity spawn = spawningBot.abilitySpawn;
                if (spawn == null) continue;
                entities.add(spawn);
            }
            entities = tickAbilityEntities(entities, bots, arena);
            ClosingZoneSystem.TickResult<Bot> closingZoneUpdate = ClosingZoneSystem.tick(
                    closingZone,
                    initialElapsedMs + elapsedMs,
                    STEP_MS,
                    arena.width(),
                    arena.height(),
                    bots,
                    zoneConfig,
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

            List<ArenaEntity> frameEntities = new ArrayList<>(entities);
            if (closingZoneUpdate.entity() != null) frameEntities.add(closingZoneUpdate.entity());
            if (recording) replayRecorder.addFrame(tick - recordTickOffset, elapsedMs - recordStartMs, bots, frameEntities);
            if (observer != null && observer.afterTick(elapsedMs, bots, frameEntities, arena)) {
                return replayRecorder.complete(request.matchId(), null);
            }

            Set<Integer> aliveTeams = bots.stream()
                    .filter(Bot::alive)
                    .map(bot -> bot.teamNumber)
                    .collect(java.util.stream.Collectors.toSet());
            if (aliveTeams.size() <= 1) {
                Bot winner = aliveTeams.isEmpty()
                        ? null
                        : bots.stream()
                                .filter(bot -> aliveTeams.contains(bot.teamNumber) && bot.alive())
                                .findFirst()
                                .orElse(null);
                // A knockout before the target segment leaves nothing to replay, but the result
                // still needs an initial state.
                if (!recording) replayRecorder.initialize(arena, bots);
                return replayRecorder.complete(request.matchId(), winner);
            }
        }

        if (!recording) replayRecorder.initialize(arena, bots);
        // A segment that ends before the last one has not decided the match.
        boolean continues = loopEndMs < arena.durationMs();
        return continues
                ? replayRecorder.completeContinuing(request.matchId())
                : replayRecorder.complete(request.matchId(), null);
    }

    private static int segmentEndAfter(List<SegmentRequest> segments, int startMs) {
        if (startMs == 0) return segments.get(0).endsAtMs();
        for (int index = 0; index + 1 < segments.size(); index += 1) {
            if (segments.get(index).endsAtMs() == startMs) return segments.get(index + 1).endsAtMs();
        }
        throw new IllegalArgumentException("recordFromMs must be the start of a segment");
    }

    private static void validateSegments(DuelSimulationRequest request, List<SegmentRequest> segments, int maxDurationMs) {
        if (segments.size() > MAX_SEGMENTS) {
            throw new IllegalArgumentException("a match has at most " + MAX_SEGMENTS + " segments");
        }
        Set<Integer> slots = new HashSet<>();
        request.bots().forEach(bot -> slots.add(bot.slot()));
        int previousEndMs = 0;
        for (int index = 0; index < segments.size(); index += 1) {
            SegmentRequest segment = segments.get(index);
            if (segment == null || segment.endsAtMs() <= previousEndMs
                    || segment.endsAtMs() - previousEndMs > SEGMENT_DURATION_MS
                    || segment.endsAtMs() % STEP_MS != 0
                    || segment.endsAtMs() > maxDurationMs) {
                throw new IllegalArgumentException("segments must end in increasing multiples of " + STEP_MS
                        + " ms, at most " + SEGMENT_DURATION_MS / 1000 + " seconds long, within "
                        + maxDurationMs / 1000 + " seconds");
            }
            previousEndMs = segment.endsAtMs();
            List<SegmentBotRequest> updates = segment.bots() == null ? List.of() : segment.bots();
            if (index == 0 && !updates.isEmpty()) {
                throw new IllegalArgumentException("the first segment's bots come from the request's bots");
            }
            Set<Integer> updated = new HashSet<>();
            for (SegmentBotRequest update : updates) {
                if (update == null || !slots.contains(update.slot()) || !updated.add(update.slot())) {
                    throw new IllegalArgumentException("segment bots must name each roster slot at most once");
                }
                List<String> resets = update.variableResets() == null ? List.of() : update.variableResets();
                if (resets.size() > MAX_VARIABLE_RESETS
                        || resets.stream().anyMatch(name -> name == null || name.length() > MAX_VARIABLE_RESET_LENGTH)) {
                    throw new IllegalArgumentException("variableResets exceeds its bounds");
                }
            }
        }
        Integer recordFromMs = request.recordFromMs();
        if (recordFromMs != null && recordFromMs != 0) {
            boolean boundary = false;
            for (int index = 0; index + 1 < segments.size(); index += 1) {
                boundary |= segments.get(index).endsAtMs() == recordFromMs;
            }
            if (!boundary) throw new IllegalArgumentException("recordFromMs must be the start of a segment");
        }
    }

    /**
     * Applies one segment's brain schedule at its boundary. Only brain, loadout and custom variables
     * change; position, HP, statuses, cooldowns, wind-ups, stamina, entities and the zone carry over.
     */
    private void applySegment(List<Bot> bots, SegmentRequest segment) {
        if (segment.bots() == null) return;
        for (SegmentBotRequest update : segment.bots()) {
            Bot bot = bots.stream().filter(candidate -> candidate.slot == update.slot()).findFirst().orElse(null);
            if (bot == null) continue;
            botStateService.applyBrainSchedule(bot, update.brain() != null ? update.brain() : bot.brain,
                    update.variableResets());
            prepareStrategy(bot);
        }
    }

    private static void validateBotRoster(DuelSimulationRequest request) {
        if (request == null || request.bots() == null
                || request.bots().size() < 2
                || request.bots().size() > MAX_SIMULATION_BOTS) {
            throw new IllegalArgumentException(
                    "duel-v2 requires between two and " + MAX_SIMULATION_BOTS + " bots");
        }
        Set<Integer> slots = new HashSet<>();
        Set<Integer> teams = new HashSet<>();
        for (DuelBotRequest bot : request.bots()) {
            if (bot == null || bot.slot() <= 0 || bot.slot() > MAX_SIMULATION_BOTS
                    || !slots.add(bot.slot()) || bot.teamNumber() <= 0) {
                throw new IllegalArgumentException("bot slots and team numbers must be unique positive values");
            }
            teams.add(bot.teamNumber());
        }
        if (teams.size() < 2) {
            throw new IllegalArgumentException("duel-v2 requires at least two teams");
        }
    }

    private static void attachRoster(List<Bot> bots) {
        List<Bot> roster = List.copyOf(bots);
        bots.forEach(bot -> bot.matchBots = roster);
    }

    private static Bot firstEnemy(Bot player, List<Bot> bots) {
        return bots.stream()
                .filter(bot -> bot != player && bot.teamNumber != player.teamNumber)
                .findFirst()
                .orElse(null);
    }

    @FunctionalInterface
    public interface SimulationTickObserver {
        boolean afterTick(int elapsedMs, List<Bot> bots, List<ArenaEntity> entities, Arena arena);
    }

    private interface ReplayRecorder<T> {
        void initialize(Arena arena, List<Bot> bots);

        void addFrame(int tick, int elapsedMs, List<Bot> bots, List<ArenaEntity> entities);

        T complete(UUID matchId, Bot winner);

        /** The recorded segment ended with the fight still going. */
        T completeContinuing(UUID matchId);
    }

    private static final class NoReplayRecorder implements ReplayRecorder<Void> {
        @Override
        public void initialize(Arena arena, List<Bot> bots) { }

        @Override
        public void addFrame(int tick, int elapsedMs, List<Bot> bots, List<ArenaEntity> entities) { }

        @Override
        public Void complete(UUID matchId, Bot winner) { return null; }

        @Override
        public Void completeContinuing(UUID matchId) { return null; }
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

        @Override
        public MatchPlaybackDTO completeContinuing(UUID matchId) {
            return new MatchPlaybackDTO(matchId, DUEL_RULESET_VERSION, "COMPLETED", initialState, frames,
                    SEGMENT_CONTINUES, null, "The fight continues.");
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
                    winner != null ? teamLabel(winner.teamNumber) + " wins." : "The fight ended in a draw.",
                    null,
                    null,
                    null);
        }

        @Override
        public MatchReplayDTO completeContinuing(UUID matchId) {
            return new MatchReplayDTO(initialState, List.copyOf(frames), SEGMENT_CONTINUES, null,
                    "The fight continues.", null, null, null);
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
                winner != null ? teamLabel(winner.teamNumber) + " wins." : "The fight ended in a draw.");
    }

    private static String teamLabel(int teamNumber) {
        return teamNumber == 2 ? "Red Team" : "Blue Team";
    }

    private Action predictAction(Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        if (player.hp <= 0) return new Action(0, 0, 0, null, ARENA_WIDTH_UNITS / 2.0, ARENA_HEIGHT_UNITS / 2.0, null, null, null);
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
                    : TargetingService.offsetTarget(AimPrediction.leadTarget(TargetingService.selectableEntity(facingBlock != null
                        ? facingBlock.selectable
                        : movementBlock != null ? movementBlock.selectable : BotLogicContracts.SELECTABLE_OPPONENT, player, opponent, entities),
                        facingBlock, player, arena), facingBlock != null ? facingBlock : movementBlock);
        Entity abilityTarget = plan.ability != null && BotLogicContracts.actionUsesSelectableTarget(
                plan.ability.action(), plan.ability.movementMode(), plan.ability.targetMode())
                ? TargetingService.offsetTarget(AimPrediction.leadTarget(
                        TargetingService.selectableEntity(plan.ability.selectable, player, opponent, entities),
                        plan.ability, player, arena), plan.ability)
                : null;
        Vector movement = actionExecutionService.movementVector(movementBlock, player, movementTarget);
        DashAction dash = null;
        if (plan.dash != null) {
            Entity dashTarget = BotLogicContracts.actionUsesSelectableTarget(
                    plan.dash.action(), plan.dash.movementMode(), plan.dash.targetMode())
                    ? TargetingService.offsetTarget(AimPrediction.leadTarget(
                            TargetingService.selectableEntity(plan.dash.selectable, player, opponent, entities),
                            plan.dash, player, arena), plan.dash)
                    : null;
            dash = new DashAction(
                    actionExecutionService.configuredAbilityAction(plan.dash),
                    dashTarget != null ? dashTarget.x() : plan.dash.targetX,
                    dashTarget != null ? dashTarget.y() : plan.dash.targetY,
                    plan.dash.movementMode(), plan.dash.movementDirection(), plan.dash.phaseFacingMode());
        }
        return new Action(
                movement.dx(),
                movement.dy(),
                facingBlock != null && BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET.equals(facingBlock.action)
                        ? "angle".equals(facingBlock.targetMode())
                            ? turnTowardAngle(player, facingBlock.targetAngle(), facingBlock.fastTurn())
                            : turnTowardTarget(player, facingTarget, facingBlock.fastTurn()) : 0.0,
                actionExecutionService.configuredAbilityAction(plan.ability),
                abilityTarget != null ? abilityTarget.x() : plan.ability != null ? plan.ability.targetX : ARENA_WIDTH_UNITS / 2.0,
                abilityTarget != null ? abilityTarget.y() : plan.ability != null ? plan.ability.targetY : ARENA_HEIGHT_UNITS / 2.0,
                plan.ability != null ? plan.ability.movementMode() : null,
                plan.ability != null ? plan.ability.movementDirection() : null,
                plan.ability != null ? plan.ability.phaseFacingMode() : null,
                movementBlock != null && movementBlock.sprint(),
                plan.cancel != null,
                facingBlock != null && BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET.equals(facingBlock.action) && facingBlock.fastTurn(),
                dash);
    }

    private Bot prepareStrategy(Bot bot) {
        JsonNode roots = bot.brain != null ? bot.brain.get("roots") : null;
        bot.brainSchemaVersion = bot.brain != null
                && BotLogicContracts.BRAIN_SCHEMA_V2.equals(textValue(field(bot.brain, "version"), ""))
                ? BotLogicContracts.BRAIN_SCHEMA_V2 : BotLogicContracts.BRAIN_SCHEMA_V1;
        // Chains share the roots' action and condition budget.
        int[] remainingActions = { MAX_LOGIC_BLOCKS };
        int[] remainingConditions = { MAX_TOTAL_CONDITIONS };
        bot.normalizedStrategy = normalizeTreeRoots(roots, bot.brainSchemaVersion, remainingActions, remainingConditions);
        JsonNode chains = bot.brain != null ? bot.brain.get("chains") : null;
        bot.normalizedChains = ChainRuntime.normalize(chains, bot.brainSchemaVersion,
                chainBlockNormalizer(bot.brainSchemaVersion), remainingActions, remainingConditions);
        return bot;
    }

    /**
     * One tick of decisions: roots are checked against start-of-tick state, then chain control from the
     * roots, then the running chain, then roots fill the categories the chain did not use.
     */
    private ActionPlan selectStrategyActionPlan(Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = selectPriorityEntries(player.normalizedStrategy, player, opponent, entities, arena);
        ActionPlan plan = new ActionPlan();
        plan.primary = selected.stream()
                .filter(block -> !BotLogicContracts.ACTION_VARIABLE.equals(block.action) && !isChainControl(block))
                .findFirst()
                .orElse(null);

        List<StrategyBlock> chainControl = selected.stream().filter(DuelSimulationService::isChainControl).toList();
        ChainRuntime.applyControl(player.chainStack, chainControl, player.normalizedChains);
        for (ChainRuntime.Claim claim : ChainRuntime.resume(player.chainStack, player.normalizedChains,
                chainHost(player, opponent, entities, arena))) {
            placeInPlan(plan, claim.head(), claim.block());
        }

        for (StrategyBlock block : selected) {
            if (BotLogicContracts.ACTION_VARIABLE.equals(block.action)) {
                actionExecutionService.applyCustomVariableAction(
                        player, opponent, entities, arena, conditionResolutionService, block);
                continue;
            }
            if (isChainControl(block)) continue;
            String head = actionHead(block.action);
            if (headTaken(plan, head)) continue;
            placeInPlan(plan, head, block);
        }
        return plan;
    }

    private static boolean isChainControl(StrategyBlock block) {
        return BotLogicContracts.ACTION_RUN_CHAIN.equals(block.action);
    }

    private static boolean headTaken(ActionPlan plan, String head) {
        return switch (head) {
            case "ability" -> plan.ability != null;
            case "rotation" -> plan.rotation != null;
            case "cancel" -> plan.cancel != null;
            case "dash" -> plan.dash != null;
            default -> plan.movement != null;
        };
    }

    private static void placeInPlan(ActionPlan plan, String head, StrategyBlock block) {
        switch (head) {
            case "ability" -> plan.ability = block;
            case "rotation" -> plan.rotation = block;
            case "cancel" -> plan.cancel = block;
            case "dash" -> plan.dash = block;
            default -> plan.movement = block;
        }
    }

    private ChainRuntime.Host chainHost(Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        return new ChainRuntime.Host() {
            @Override
            public boolean conditionsHold(List<Condition> conditions) {
                return conditionResolutionService.evaluateConditions(conditions, player, opponent, entities, arena);
            }

            @Override
            public boolean executableNow(StrategyBlock block) {
                return strategyBlockExecutableNow(block, player, opponent, entities);
            }

            @Override
            public void applyVariable(StrategyBlock block) {
                actionExecutionService.applyCustomVariableAction(
                        player, opponent, entities, arena, conditionResolutionService, block);
            }

            @Override
            public boolean canCancelWindup() {
                return StaminaSystem.canCancelWindup(player);
            }

            @Override
            public Integer abilityFor(Object action) {
                return actionExecutionService.abilityForAction(action);
            }

            @Override
            public boolean abilityBusy(int abilityId) {
                boolean windingUp = player.preparingAbility != null && player.preparingAbility == abilityId
                        && player.preparingMs > 0;
                return windingUp || player.abilityActiveMs.getOrDefault(abilityId, 0) > 0;
            }

            @Override
            public boolean stunnedOrDead() {
                return player.hp <= 0 || BotStateService.statusActive(player, "stun");
            }

            @Override
            public String head(Object action) {
                return actionHead(action);
            }
        };
    }

    private List<StrategyBlock> selectPriorityEntries(List<TreeRoot> roots, Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        return roots.isEmpty() ? List.of() : selectTreeEntries(roots, player, opponent, entities, arena);
    }

    private List<StrategyBlock> selectTreeEntries(List<TreeRoot> normalized, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = new ArrayList<>();
        for (TreeRoot root : normalized) {
            selected.addAll(selectTreeBranch(root.branches(), player, opponent, entities, arena));
            root.actions().stream().filter(block -> strategyBlockExecutableNow(block, player, opponent, entities)).forEach(selected::add);
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
            int selectedCount = selected.size();
            List<StrategyBlock> child = selectTreeBranch(branch.children(), player, opponent, entities, arena);
            selected.addAll(child);
            branch.blocks().stream()
                    .filter(block -> strategyBlockExecutableNow(block, player, opponent, entities))
                    .forEach(selected::add);
            if (selected.size() > selectedCount) break;
        }
        return selected;
    }

    private static ChainRuntime.BlockNormalizer chainBlockNormalizer(String coordinateVersion) {
        return new ChainRuntime.BlockNormalizer() {
            @Override
            public StrategyBlock normalize(JsonNode node) {
                return normalizeStrategyBlock(node, 0, coordinateVersion);
            }

            @Override
            public String head(Object action) {
                BotLogicContracts.ActionContract contract = BotLogicContracts.actionContract(action);
                return contract == null ? null : contract.head().name().toLowerCase();
            }

            @Override
            public Object action(JsonNode node) {
                return actionValue(field(node, "action"));
            }

            @Override
            public int cost(StrategyBlock block) {
                return strategyBlockActionCost(block);
            }
        };
    }

    private static List<TreeRoot> normalizeTreeRoots(JsonNode roots, String coordinateVersion,
            int[] remainingActions, int[] remainingConditions) {
        if (roots == null || !roots.isArray()) return List.of();
        List<TreeRoot> normalized = new ArrayList<>();
        int limit = Math.min(roots.size(), MAX_ROOTS);
        for (int index = 0; index < limit; index += 1) {
            JsonNode root = roots.get(index);
            normalized.add(new TreeRoot(
                    index,
                    clamp(numberValue(field(root, "priority"), index + 1), 1, MAX_ROOTS),
                    normalizeTreeBranches(field(root, "branches"), remainingActions, remainingConditions, coordinateVersion),
                    normalizeRootActions(root, index, remainingActions, coordinateVersion)));
        }
        normalized.sort(Comparator.comparingDouble(TreeRoot::priority));
        return List.copyOf(normalized);
    }

    private static List<StrategyBlock> normalizeRootActions(JsonNode root, int index, int[] remainingActions, String version) {
        if (field(root, "actions") == null) return List.of();
        List<StrategyBlock> actions = new ArrayList<>();
        for (StrategyBlock block : normalizeTreeActions(root, index, version)) {
            if (BotLogicContracts.ACTION_NONE.equals(block.action())) continue;
            int cost = strategyBlockActionCost(block);
            if (cost > remainingActions[0]) break;
            remainingActions[0] -= cost;
            actions.add(block);
        }
        return List.copyOf(actions);
    }

    private static List<TreeBranch> normalizeTreeBranches(JsonNode branches, int[] remainingActions, int[] remainingConditions,
            String coordinateVersion) {
        if (branches == null || !branches.isArray() || remainingConditions[0] <= 0) return List.of();
        List<TreeBranch> normalized = new ArrayList<>();
        for (int index = 0; index < branches.size() && remainingConditions[0] > 0; index += 1) {
            JsonNode branch = branches.get(index);
            List<StrategyBlock> blocks = new ArrayList<>();
            for (StrategyBlock block : normalizeTreeActions(branch, index, coordinateVersion)) {
                if (BotLogicContracts.ACTION_NONE.equals(block.action())) continue;
                int cost = strategyBlockActionCost(block);
                if (cost > remainingActions[0]) break;
                blocks.add(block);
                remainingActions[0] -= cost;
            }
            if (blocks.isEmpty()) {
                blocks = List.of(new StrategyBlock(index, BotLogicContracts.ACTION_NONE, BotLogicContracts.SELECTABLE_OPPONENT, 0, 0, "target", ARENA_WIDTH_UNITS / 2.0, ARENA_HEIGHT_UNITS / 2.0, null, null, null, null, 1, ConditionResolutionService.normalizeConditions(field(branch, "conditions"), coordinateVersion)));
            }
            String branchType = index == 0 ? "if" : "else".equals(textValue(field(branch, "branchType"), "if")) ? "else" : "if";
            if ("else".equals(branchType)) {
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.selectable(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), List.of(), block.targetAngle(), block.aim(), block.sprint(), block.fastTurn())).toList();
            } else {
                int conditionLimit = Math.min(remainingConditions[0], blocks.isEmpty() ? 0 : blocks.get(0).conditions().size());
                List<Condition> limitedConditions = blocks.isEmpty() ? List.of() : blocks.get(0).conditions().subList(0, conditionLimit);
                remainingConditions[0] -= conditionLimit;
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.selectable(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), limitedConditions, block.targetAngle(), block.aim(), block.sprint(), block.fastTurn())).toList();
            }
            normalized.add(new TreeBranch(
                    branchType,
                    clamp(numberValue(field(branch, "priority"), index + 1), 1, MAX_LOGIC_BLOCKS),
                    blocks,
                    normalizeTreeBranches(field(branch, "children"), remainingActions, remainingConditions, coordinateVersion)));
        }
        normalized.sort(Comparator.comparingDouble(TreeBranch::priority));
        return List.copyOf(normalized);
    }

    private static List<StrategyBlock> normalizeTreeActions(JsonNode branch, int index, String coordinateVersion) {
        JsonNode actions = field(branch, "actions");
        List<StrategyBlock> blocks = new ArrayList<>();
        Set<String> heads = new HashSet<>();
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            for (JsonNode actionNode : actions) {
                Object action = actionValue(field(actionNode, "action"));
                String head = actionHead(action);
                String headKey = BotLogicContracts.ACTION_VARIABLE.equals(action) ? head + ":" + blocks.size() : head;
                if (!heads.add(headKey)) continue;
                double offsetX = offsetCoordinate(field(actionNode, "targetOffsetX"), coordinateVersion);
                double offsetY = offsetCoordinate(field(actionNode, "targetOffsetY"), coordinateVersion);
                double targetX = absoluteCoordinate(field(actionNode, "targetX"), coordinateVersion, true);
                double targetY = absoluteCoordinate(field(actionNode, "targetY"), coordinateVersion, false);
                if (isCenteredCoordinates(coordinateVersion)) {
                    ArenaCoordinates.Offset offset = ArenaCoordinates.offsetToInternal(offsetX, offsetY);
                    ArenaCoordinates.Point target = ArenaCoordinates.toInternal(targetX, targetY);
                    offsetX = offset.x();
                    offsetY = offset.y();
                    targetX = target.x();
                    targetY = target.y();
                }
                blocks.add(new StrategyBlock(index, action,
                normalizeSelectable(textValue(field(actionNode, "selectable"), BotLogicContracts.SELECTABLE_OPPONENT), BotLogicContracts.SELECTABLE_OPPONENT),
                        BotLogicContracts.ACTION_VARIABLE.equals(action)
                                ? clamp(variableValue(firstNonNull(field(actionNode, "value"), field(actionNode, "operand"))), -CUSTOM_NUMBER_LIMIT, CUSTOM_NUMBER_LIMIT)
                                : offsetX,
                        offsetY,
                        normalizeActionTargetMode(action, actionNode),
                        targetX,
                        targetY,
                        textValue(field(actionNode, "movementMode"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? textValue(field(actionNode, "operation"), "set") : movementDirectionValue(field(actionNode, "movementDirection"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? textValue(field(actionNode, "variableId"), "") : movementDirectionValue(field(actionNode, "phaseFacingMode"), null),
                        BotLogicContracts.ACTION_VARIABLE.equals(action) ? variableActionPayload(actionNode) : chainActionPayload(action, actionNode),
                        actionPriority(branch),
                        ConditionResolutionService.normalizeConditions(field(branch, "conditions"), coordinateVersion),
                        clamp(numberValue(field(actionNode, "targetAngle"), 0), BotLogicContracts.ANGLE_MIN, BotLogicContracts.ANGLE_MAX),
                        normalizeAim(action, actionNode),
                        normalizeSprint(action, actionNode),
                        normalizeFastTurn(action, actionNode)));
            }
        }
        if (blocks.isEmpty()) blocks.add(normalizeStrategyBlock(branch, index, coordinateVersion));
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
        // Chain control is instant bookkeeping: it always selects its block and uses no category.
        if ("chain".equals(head)) return true;
        if ("movement".equals(head) || "rotation".equals(head)) return true;
        // Cancel only selects while a wind-up can actually be cancelled, so it never blocks anything.
        if ("cancel".equals(head)) return StaminaSystem.canCancelWindup(player);
        Integer ability = actionExecutionService.abilityForAction(action);
        return ability != null && actionExecutionService.selectedAbilityExecutable(player, ability);
    }

    private static StrategyBlock normalizeStrategyBlock(JsonNode block, int index, String coordinateVersion) {
        Object action = actionValue(field(block, "action"));
        double offsetX = offsetCoordinate(field(block, "targetOffsetX"), coordinateVersion);
        double offsetY = offsetCoordinate(field(block, "targetOffsetY"), coordinateVersion);
        double targetX = absoluteCoordinate(field(block, "targetX"), coordinateVersion, true);
        double targetY = absoluteCoordinate(field(block, "targetY"), coordinateVersion, false);
        if (isCenteredCoordinates(coordinateVersion)) {
            ArenaCoordinates.Offset offset = ArenaCoordinates.offsetToInternal(offsetX, offsetY);
            ArenaCoordinates.Point target = ArenaCoordinates.toInternal(targetX, targetY);
            offsetX = offset.x();
            offsetY = offset.y();
            targetX = target.x();
            targetY = target.y();
        }
        return new StrategyBlock(
                index,
                action,
                normalizeSelectable(textValue(field(block, "selectable"), BotLogicContracts.SELECTABLE_OPPONENT), BotLogicContracts.SELECTABLE_OPPONENT),
                BotLogicContracts.ACTION_VARIABLE.equals(action)
                        ? clamp(variableValue(firstNonNull(field(block, "value"), field(block, "operand"))), -CUSTOM_NUMBER_LIMIT, CUSTOM_NUMBER_LIMIT)
                        : offsetX,
                offsetY,
                normalizeActionTargetMode(action, block),
                targetX,
                targetY,
                textValue(field(block, "movementMode"), null),
                movementDirectionValue(field(block, "movementDirection"), null),
                BotLogicContracts.ACTION_VARIABLE.equals(action)
                        ? textValue(field(block, "phaseFacingMode"), null)
                        : movementDirectionValue(field(block, "phaseFacingMode"), null),
                BotLogicContracts.ACTION_VARIABLE.equals(action) ? variableActionPayload(block) : chainActionPayload(action, block),
                actionPriority(block),
                ConditionResolutionService.normalizeConditions(field(block, "conditions"), coordinateVersion),
                clamp(numberValue(field(block, "targetAngle"), 0), BotLogicContracts.ANGLE_MIN, BotLogicContracts.ANGLE_MAX),
                normalizeAim(action, block),
                normalizeSprint(action, block),
                normalizeFastTurn(action, block));
    }

    /** Run chain carries its chain ID in the block's payload node; other actions carry none. */
    private static JsonNode chainActionPayload(Object action, JsonNode node) {
        if (!BotLogicContracts.ACTION_RUN_CHAIN.equals(action)) return null;
        return tools.jackson.databind.node.JsonNodeFactory.instance.objectNode()
                .put("chainId", textValue(field(node, "chainId"), ""));
    }

    /** Fast turn is a Rotate setting and only a literal boolean true turns it on; anything else is off. */
    private static boolean normalizeFastTurn(Object action, JsonNode node) {
        return BotLogicContracts.ACTION_ROTATE_TOWARD_TARGET.equals(action)
                && field(node, "fastTurn") != null && field(node, "fastTurn").isBoolean()
                && field(node, "fastTurn").asBoolean();
    }

    /** Sprint is a Walk setting and only a literal boolean true turns it on; anything else is off. */
    private static boolean normalizeSprint(Object action, JsonNode node) {
        return BotLogicContracts.ACTION_MOVE_WALK.equals(action)
                && field(node, "sprint") != null && field(node, "sprint").isBoolean()
                && field(node, "sprint").asBoolean();
    }

    /**
     * Lead aim is only honored on actions that aim at a selected entity. Anything missing or
     * malformed normalizes to `current`, so brains saved before this setting behave as before.
     */
    private static Aim normalizeAim(Object action, JsonNode node) {
        if (!BotLogicContracts.actionSupportsAim(action)) return Aim.CURRENT;
        String mode = textValue(field(node, "aim"), BotLogicContracts.AIM_CURRENT);
        if (BotLogicContracts.AIM_LEAD.equals(mode)) {
            double seconds = BotLogicContracts.truncateToNumberPrecision(
                    clamp(numberValue(field(node, "leadSeconds"), 0), 0, BotLogicContracts.MAX_LEAD_SECONDS));
            return new Aim(BotLogicContracts.AIM_LEAD, seconds, null);
        }
        if (BotLogicContracts.AIM_AUTO.equals(mode)) {
            JsonNode abilityNode = field(node, "leadAbilityId");
            if (abilityNode != null && abilityNode.isIntegralNumber() && abilityNode.canConvertToInt()
                    && com.example.botfight.simulation.gameconfig.AbilityRegistry.contains(abilityNode.intValue())) {
                return new Aim(BotLogicContracts.AIM_AUTO, 0.0, abilityNode.intValue());
            }
        }
        return Aim.CURRENT;
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

    private static boolean isCenteredCoordinates(String coordinateVersion) {
        return BotLogicContracts.BRAIN_SCHEMA_V2.equals(coordinateVersion);
    }

    private static double absoluteCoordinate(JsonNode node, String coordinateVersion, boolean xAxis) {
        boolean centered = isCenteredCoordinates(coordinateVersion);
        double fallback = centered ? 0.0 : (xAxis ? ARENA_WIDTH_UNITS : ARENA_HEIGHT_UNITS) / 2.0;
        if (node == null || !node.isNumber() || !Double.isFinite(node.asDouble())) return fallback;
        double minimum = centered ? -ARENA_WIDTH_UNITS / 2.0 : 0.0;
        double maximum = centered ? ARENA_WIDTH_UNITS / 2.0 : (xAxis ? ARENA_WIDTH_UNITS : ARENA_HEIGHT_UNITS);
        return BotLogicContracts.truncateToNumberPrecision(Math.max(minimum, Math.min(maximum, node.asDouble())));
    }

    private static double offsetCoordinate(JsonNode node, String coordinateVersion) {
        if (node == null || !node.isNumber() || !Double.isFinite(node.asDouble())) return 0.0;
        double limit = isCenteredCoordinates(coordinateVersion)
                ? ARENA_WIDTH_UNITS / 2.0 : ARENA_WIDTH_UNITS;
        return BotLogicContracts.truncateToNumberPrecision(Math.max(-limit, Math.min(limit, node.asDouble())));
    }

    private List<ArenaEntity> tickAbilityEntities(
            List<ArenaEntity> entities,
            List<Bot> bots,
            Arena arena) {
        return AbilityEntitySystem.tick(entities, bots, new ArenaBounds(arena.width(), arena.height()), STEP_MS,
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
                        return actionExecutionService.damageToEntityThisTick(
                                entity, activeBots, activeEntities);
                    }

                    @Override
                    public ArenaEntity applyEffectsToEntity(ArenaEntity entity,
                            List<Bot> activeBots, List<ArenaEntity> activeEntities,
                            ArenaBounds bounds, int stepMs) {
                        return actionExecutionService.applyEffectsToEntity(
                                entity, activeBots, activeEntities, bounds, stepMs);
                    }

                    @Override
                    public boolean entityHitByCurrentAttack(ArenaEntity entity, List<Bot> activeBots,
                                                             List<ArenaEntity> activeEntities) {
                        boolean recordedHit = activeBots.stream()
                                .anyMatch(bot -> bot.entityHitIds.contains(entity.id()));
                        return recordedHit || actionExecutionService.mineHitByCurrentAttack(
                                entity, activeBots, activeEntities);
                    }

                    @Override
                    public void recordEnemyHit(List<Bot> activeBots, int ownerSlot, int abilityId, String entityId) {
                        activeBots.stream().filter(bot -> bot.slot == ownerSlot).findFirst()
                                .ifPresent(owner -> BotStateService.recordEnemyHit(owner, abilityId,
                                        owner.entityActivations.getOrDefault(entityId, owner.activationSerial)));
                    }

                    @Override
                    public void applyStatus(List<Bot> activeBots, int ownerSlot, Bot target,
                                            int abilityId, AbilityContracts.Effect effect) {
                        Bot owner = activeBots.stream()
                                .filter(bot -> bot.slot == ownerSlot).findFirst().orElse(null);
                        if (owner != null) {
                            actionExecutionService.applyEntityStatus(owner, target, abilityId, effect);
                        }
                    }

                });
    }

    private static SelectableSnapshot selectableSnapshot(ArenaEntity entity) {
        AbilityContracts.AbilityContract contract = AbilityContracts.forEntity(entity);
        boolean healthBearing = contract != null && contract.phases().stream()
                .anyMatch(phase -> phase.health() != null);
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
        String canonical = BotLogicContracts.canonicalSelectableId(selectableId);
        if (BotLogicContracts.isAllowedSelectable(canonical)) return canonical;
        return BotLogicContracts.canonicalSelectableId(fallback);
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

    private static int actionPriority(JsonNode node) {
        JsonNode explicitActionPriority = field(node, "actionPriority");
        if (explicitActionPriority != null && explicitActionPriority.isNumber()) {
            return normalizePriority(numberValue(explicitActionPriority, 1.0));
        }
        return 1;
    }

    /** A variable write carries its operand or its terms. */
    private static JsonNode variableActionPayload(JsonNode node) {
        return firstNonNull(field(node, "operand"), field(node, "terms"));
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
        return Math.max(0, Math.min(
                Math.min(entity.x(), arena.width() - entity.x()),
                Math.min(entity.y(), arena.height() - entity.y())));
    }

    /** The largest turn per tick the planner may assume: doubled only when the executor will really fast turn. */
    private static double turnStepDegrees(Bot player, boolean fastTurn) {
        return TURN_SPEED_DEGREES * (fastTurn && com.example.botfight.simulation.core.state.StaminaSystem.canFastTurn(player)
                ? com.example.botfight.simulation.gameconfig.MovementConfig.FAST_TURN_MULTIPLIER : 1.0);
    }

    private static double turnTowardTarget(Bot player, Entity target, boolean fastTurn) {
        if (player == null || target == null) return 0;
        double bearing = vectorBearing(target.x() - player.x, target.y() - player.y);
        return clamp(shortestDelta(player.rotation, bearing) / turnStepDegrees(player, fastTurn), -1, 1);
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
            List<DuelBotRequest> bots,
            List<SegmentRequest> segments,
            Integer recordFromMs) {
        public DuelSimulationRequest(
                UUID matchId,
                String rulesetVersion,
                long seed,
                DuelArenaRequest arena,
                List<DuelBotRequest> bots) {
            this(matchId, rulesetVersion, seed, arena, bots, null, null);
        }
    }

    /**
     * One timed-rounds segment: it ends at {@code endsAtMs} of the match and starts where the previous
     * one ended. The first segment's bots are the request's bots; later segments swap in the listed
     * bots' brain at their boundary.
     */
    public record SegmentRequest(int endsAtMs, List<SegmentBotRequest> bots) {
    }

    /**
     * A bot's brain schedule entry. {@code variableResets} names the custom variables (by id or name)
     * to reset to their declared default instead of keeping their last value.
     */
    public record SegmentBotRequest(int slot, String selectedLoadout, JsonNode brain, List<String> variableResets) {
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
            Double initialHp,
            int teamNumber) {
        public DuelBotRequest(
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
            this(userId, username, slot, x, y, rotation, size, selectedLoadout, brain, initialHp, slot);
        }

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
            this(userId, username, slot, x, y, rotation, size, selectedLoadout, brain, null, slot);
        }
    }

    public record Arena(int width, int height, int durationMs, ClosingZoneConfig closingZone) {
        public Arena(int width, int height, int durationMs) {
            this(width, height, durationMs, ClosingZoneConfig.duelV1());
        }
    }

    private static double turnTowardAngle(Bot player, double targetAngle, boolean fastTurn) {
        if (player == null || !Double.isFinite(targetAngle)) return 0;
        return clamp(shortestDelta(player.rotation, targetAngle) / turnStepDegrees(player, fastTurn), -1, 1);
    }

    /** `sprint` is the Walk setting and `fastTurn` the Rotate setting; `cancelWindup` is the Cancel channel, independent of the ability lock. */
    /** A Dash chosen through its own channel; it starts alongside the tick's ability. */
    public record DashAction(Integer abilityId, double targetX, double targetY,
                             String movementMode, String movementDirection, String phaseFacingMode) {}

    public record Action(double dx, double dy, double dRot, Integer abilityAction, double abilityTargetX, double abilityTargetY,
                  String movementMode, String movementDirection, String phaseFacingMode,
                  boolean sprint, boolean cancelWindup, boolean fastTurn, DashAction dash) {
        public Action(double dx, double dy, double dRot, Integer abilityAction, double abilityTargetX, double abilityTargetY,
                      String movementMode, String movementDirection, String phaseFacingMode,
                      boolean sprint, boolean cancelWindup, boolean fastTurn) {
            this(dx, dy, dRot, abilityAction, abilityTargetX, abilityTargetY,
                    movementMode, movementDirection, phaseFacingMode, sprint, cancelWindup, fastTurn, null);
        }
        public Action(double dx, double dy, double dRot, Integer abilityAction, double abilityTargetX, double abilityTargetY,
                      String movementMode, String movementDirection, String phaseFacingMode,
                      boolean sprint, boolean cancelWindup) {
            this(dx, dy, dRot, abilityAction, abilityTargetX, abilityTargetY,
                    movementMode, movementDirection, phaseFacingMode, sprint, cancelWindup, false, null);
        }
        public Action(double dx, double dy, double dRot, Integer abilityAction, double abilityTargetX, double abilityTargetY,
                      String movementMode, String movementDirection, String phaseFacingMode) {
            this(dx, dy, dRot, abilityAction, abilityTargetX, abilityTargetY,
                    movementMode, movementDirection, phaseFacingMode, false, false, false, null);
        }
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

    /**
     * {@code rightView} carries the entity/target configuration of a compared-to pair variable
     * (distance, bearings) as its own condition, so the two sides never share one target. It is
     * null when the right side is not a pair variable.
     */
    public record Condition(String type, double value, String selectable, String leftSelectable, String rightSelectable, String left, Integer ability, String statusEffect, String comparator, Operand right, String targetMode, double targetX, double targetY, double targetAngle, Condition rightView) {
        public Condition(String type, double value, String selectable, String leftSelectable, String rightSelectable, String left, Integer ability, String statusEffect, String comparator, Operand right, String targetMode, double targetX, double targetY, double targetAngle) {
            this(type, value, selectable, leftSelectable, rightSelectable, left, ability, statusEffect, comparator, right,
                    targetMode, targetX, targetY, targetAngle, null);
        }
        public Condition(String type, double value, String selectable, String leftSelectable, String rightSelectable, String left, Integer ability, String statusEffect, String comparator, Operand right) {
            this(type, value, selectable, leftSelectable, rightSelectable, left, ability, statusEffect, comparator, right,
                    null, ArenaUnits.WIDTH / 2.0, ArenaUnits.HEIGHT / 2.0, 0.0);
        }
    }

    /** Optional lead-aim setting for Face Target and targeted ability actions; `current` is today's behavior. */
    public record Aim(String mode, double leadSeconds, Integer leadAbilityId) {
        public static final Aim CURRENT = new Aim(BotLogicContracts.AIM_CURRENT, 0.0, null);
    }

    public record StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions, double targetAngle, Aim aim, boolean sprint, boolean fastTurn) {
        public StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions, double targetAngle, Aim aim, boolean sprint) {
            this(index, action, selectable, targetOffsetX, targetOffsetY, targetMode, targetX, targetY,
                    movementMode, movementDirection, phaseFacingMode, variableTerms, priority, conditions, targetAngle, aim, sprint, false);
        }
        public StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions, double targetAngle, Aim aim) {
            this(index, action, selectable, targetOffsetX, targetOffsetY, targetMode, targetX, targetY,
                    movementMode, movementDirection, phaseFacingMode, variableTerms, priority, conditions, targetAngle, aim, false, false);
        }
        public StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions) {
            this(index, action, selectable, targetOffsetX, targetOffsetY, targetMode, targetX, targetY,
                    movementMode, movementDirection, phaseFacingMode, variableTerms, priority, conditions, Double.NaN, Aim.CURRENT);
        }
        public StrategyBlock(int index, Object action, String selectable, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions, double targetAngle) {
            this(index, action, selectable, targetOffsetX, targetOffsetY, targetMode, targetX, targetY,
                    movementMode, movementDirection, phaseFacingMode, variableTerms, priority, conditions, targetAngle, Aim.CURRENT);
        }
        public StrategyBlock {
            if (aim == null) aim = Aim.CURRENT;
        }
    }

    public record TargetPoint(double x, double y, int size) implements Entity {
    }

    private record TreeRoot(int index, double priority, List<TreeBranch> branches, List<StrategyBlock> actions) {
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
        /** Team identity used for targeting, friendly-fire rules, and scoring. */
        public int teamNumber;
        public double x;
        public double y;
        public double rotation;
        public int size;
        public String combatLoadout;
        public JsonNode brain;
        /** Coordinate semantics are owned by this bot's submitted brain. */
        public String brainSchemaVersion = BotLogicContracts.BRAIN_SCHEMA_V1;
        private List<TreeRoot> normalizedStrategy = List.of();
        private Map<String, ChainRuntime.Chain> normalizedChains = Map.of();
        /** The running action chain's call stack. It persists across ticks like the custom variables. */
        public List<ChainRuntime.Frame> chainStack = new ArrayList<>();
        /** Display metadata from the same normalized chains used by authoritative execution. */
        public String chainName(String chainId) {
            var chain = normalizedChains.get(chainId);
            return chain == null ? chainId : chain.name();
        }
        /** What the brain decided for the tick that just ran (read by tests and replays). */
        public Action lastPredictedAction;
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
        /** Milliseconds since each ability last hit an enemy bot; absent when it never has. */
        public Map<Integer, Integer> abilityLastHitAgeMs = new HashMap<>();
        /** Abilities that hit an enemy bot this tick, settled into abilityLastHitAgeMs by settleTick. */
        public Set<Integer> abilityHitsThisTick = new java.util.LinkedHashSet<>();
        /** Counts this bot's ability activations, so a hit stamina refund is paid once per activation. */
        public int activationSerial;
        /** Activations that already paid their hit refund. */
        public Set<Integer> refundedActivations = new java.util.HashSet<>();
        /** The activation that spawned each of this bot's entities, by entity id. */
        public Map<String, Integer> entityActivations = new HashMap<>();
        /** Hit refunds earned this tick, paid into stamina by settleTick. */
        public int pendingStaminaRefund;
        public Map<Integer, Integer> abilityCharges = new HashMap<>();
        public Map<Integer, Integer> abilityRechargeMs = new HashMap<>();
        public Map<String, Object> customVariables = new HashMap<>();
        public Map<String, String> customVariableTypes = new HashMap<>();
        /** Stamina (an integer, 0-100) and its timers; see StaminaSystem. */
        public int stamina = com.example.botfight.simulation.gameconfig.MovementConfig.STAMINA_MAX;
        public int staminaRegenDelayMs;
        public boolean sprinting;
        public boolean fastTurning;
        public int dashGapMs;
        public Integer preparingAbility;
        public int preparingMs;
        public double preparingTargetX = Double.NaN;
        public double preparingTargetY = Double.NaN;
        public Integer triggeredAbility;
        public AbilityExecutionPayload triggeredAbilityPayload;
        /** One-tick origin for the shared combat activation visual. */
        public double visualOriginX = Double.NaN;
        public double visualOriginY = Double.NaN;
        public double visualOriginRotation = Double.NaN;
        public final Set<String> entityHitIds = new HashSet<>();
        /** Full immutable roster for this simulation, attached by the orchestrator. */
        public List<Bot> matchBots = List.of();
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
        @Override public int entityTeam() { return teamNumber > 0 ? teamNumber : slot; }
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
        @Override public void applyInterrupt(int durationMs) {
            BotStateService.applyInterrupt(this, durationMs, null);
        }
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
        private StrategyBlock cancel;
        private StrategyBlock dash;
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
