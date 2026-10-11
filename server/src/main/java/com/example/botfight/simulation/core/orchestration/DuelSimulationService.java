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
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.core.state.StaminaSystem;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.bots.BrainNormalizer;
import com.example.botfight.simulation.ecs.entities.ClosingZoneSystem;
import com.example.botfight.simulation.gameconfig.ClosingZoneConfig;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.geometry.ArenaUnits;
import java.util.ArrayList;
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

    /**
     * Runs the authoritative duel like {@link #simulateWithoutReplay} and appends one entry per trigger,
     * effect, status, spawn, phase change, removal and stamina change to {@code log}. Used by the golden
     * and parity tests; rated runs never pass a log.
     */
    public void simulateLogged(DuelSimulationRequest request, CombatLog log, SimulationTickObserver observer) {
        if (log == null) throw new IllegalArgumentException("combat log is required");
        try (CombatLog.Binding ignored = log.bind()) {
            simulate(request, new NoReplayRecorder(), observer);
        }
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
        TickState state = new TickState(arena, bots, zoneConfig, initialElapsedMs);

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
            CombatLog.beginTick(tick);
            state.elapsedMs = elapsedMs;
            decide(state);
            act(state);
            resolveHits(state);
            spawn(state);
            entities(state);
            hazards(state);
            settle(state);

            List<ArenaEntity> frameEntities = new ArrayList<>(state.entities);
            if (state.closingZoneEntity != null) frameEntities.add(state.closingZoneEntity);
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

    /**
     * What one tick's stages share. The entity list and the closing zone persist from tick to tick; the
     * browser's arenaPreviewSimulation.js runs the same stages in the same order.
     */
    private static final class TickState {
        final Arena arena;
        final List<Bot> bots;
        final ClosingZoneConfig zoneConfig;
        final int initialElapsedMs;
        int elapsedMs;
        List<ArenaEntity> entities = new ArrayList<>();
        ClosingZoneSystem.State closingZone;
        ArenaEntity closingZoneEntity;
        List<Action> predictedActions = List.of();

        TickState(Arena arena, List<Bot> bots, ClosingZoneConfig zoneConfig, int initialElapsedMs) {
            this.arena = arena;
            this.bots = bots;
            this.zoneConfig = zoneConfig;
            this.initialElapsedMs = initialElapsedMs;
        }
    }

    /** Entities age, one-tick outputs clear and every bot picks its action from the start-of-tick state. */
    private void decide(TickState state) {
        CombatLog.stage("decide");
        state.entities = advanceEntityAges(state.entities);
        for (Bot bot : state.bots) {
            botStateService.startTick(bot);
        }
        List<Entity> selectables = new ArrayList<>();
        state.entities.stream().map(DuelSimulationService::selectableSnapshot).forEach(selectables::add);
        state.predictedActions = state.bots.stream()
                .map(bot -> predictAction(bot, firstEnemy(bot, state.bots), selectables, state.arena))
                .toList();
    }

    /** Stamina timers, stun, cancel, movement, channels and the ability triggers of every bot. */
    private void act(TickState state) {
        CombatLog.stage("act");
        for (int index = 0; index < state.bots.size(); index++) {
            Bot bot = state.bots.get(index);
            bot.lastPredictedAction = state.predictedActions.get(index);
            actionExecutionService.execute(bot, state.predictedActions.get(index), state.arena);
        }
        if (!CombatLog.active()) return;
        for (Bot bot : state.bots) {
            if (bot.triggeredAbility == null) continue;
            CombatLog.record("trigger", CombatLog.bot(bot.slot), null, bot.triggeredAbility, null, null);
        }
    }

    /** The trigger verbs of the abilities that triggered this tick hit the opposing bots or apply to their owner. */
    private void resolveHits(TickState state) {
        CombatLog.stage("resolveHits");
        for (Bot attacker : state.bots) {
            actionExecutionService.resolveTriggeredAbilities(attacker, state.bots, state.arena);
        }
    }

    /** New ability entities join the world. */
    private void spawn(TickState state) {
        CombatLog.stage("spawn");
        for (Bot spawningBot : state.bots) {
            for (ArenaEntity spawn : spawningBot.abilitySpawn) {
                CombatLog.record("spawn", CombatLog.bot(spawn.ownerSlot()), CombatLog.entityRef(spawn), spawn.abilityId(),
                        spawn.type(), null);
                state.entities.add(spawn);
            }
        }
    }

    /** Projectiles, zones, traps and summons advance and apply their effects. */
    private void entities(TickState state) {
        CombatLog.stage("entities");
        List<ArenaEntity> before = state.entities;
        state.entities = tickAbilityEntities(before, state.bots, state.arena);
        if (CombatLog.active()) logEntityChanges(before, state.entities);
    }

    /** Phase transitions, removals and entities spawned by other entities, found by comparing worlds. */
    private static void logEntityChanges(List<ArenaEntity> before, List<ArenaEntity> after) {
        Map<String, ArenaEntity> afterById = new HashMap<>();
        after.forEach(entity -> afterById.put(entity.id(), entity));
        Set<String> beforeIds = new HashSet<>();
        for (ArenaEntity entity : before) {
            beforeIds.add(entity.id());
            ArenaEntity next = afterById.get(entity.id());
            if (next == null) {
                CombatLog.record("removal", CombatLog.bot(entity.ownerSlot()), CombatLog.entityRef(entity), entity.abilityId(),
                        entity.type(), null);
                continue;
            }
            String from = phaseIdOf(entity);
            String to = phaseIdOf(next);
            if (!java.util.Objects.equals(from, to)) {
                CombatLog.record("phase", CombatLog.bot(entity.ownerSlot()), CombatLog.entityRef(entity), entity.abilityId(),
                        from + ">" + to, null);
            }
        }
        for (ArenaEntity entity : after) {
            if (beforeIds.contains(entity.id())) continue;
            CombatLog.record("spawn", CombatLog.bot(entity.ownerSlot()), CombatLog.entityRef(entity), entity.abilityId(),
                    entity.type(), null);
        }
    }

    private static String phaseIdOf(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        return phase == null ? null : phase.id();
    }

    /** The closing zone shrinks and hurts the bots outside it. */
    private void hazards(TickState state) {
        CombatLog.stage("hazards");
        ClosingZoneSystem.TickResult<Bot> update = ClosingZoneSystem.tick(
                state.closingZone,
                state.initialElapsedMs + state.elapsedMs,
                STEP_MS,
                state.arena.width(),
                state.arena.height(),
                state.bots,
                state.zoneConfig,
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
        state.closingZone = update.state();
        state.closingZoneEntity = update.entity();
    }

    /** Healing lands, hit stamina refunds are paid and the per-tick measurements roll over. */
    private void settle(TickState state) {
        CombatLog.stage("settle");
        state.bots.forEach(botStateService::settleTick);
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
        BrainNormalizer.Result brain = BrainNormalizer.normalize(bot.brain);
        bot.brainSchemaVersion = brain.schemaVersion();
        bot.normalizedStrategy = brain.roots();
        bot.normalizedChains = brain.chains();
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
        ChainRuntime.Start start = null;
        if (ChainRuntime.applyControl(player.chainStack, chainControl, player.normalizedChains)) {
            // Roots left of the Run chain take their categories before the chain's first action. `selected`
            // only holds roots that can act now (executable, target resolved).
            Set<String> claimed = new HashSet<>();
            for (StrategyBlock block : selected) {
                if (isChainControl(block)) break;
                if (!BotLogicContracts.ACTION_VARIABLE.equals(block.action)) claimed.add(BrainNormalizer.actionHead(block.action));
            }
            start = new ChainRuntime.Start(claimed, block -> strategyBlockExecutableNow(block, player, opponent, entities));
        }
        for (ChainRuntime.Claim claim : ChainRuntime.resume(player.chainStack, player.normalizedChains,
                chainHost(player, opponent, entities, arena), start)) {
            placeInPlan(plan, claim.head(), claim.block());
        }

        for (StrategyBlock block : selected) {
            if (BotLogicContracts.ACTION_VARIABLE.equals(block.action)) {
                actionExecutionService.applyCustomVariableAction(
                        player, opponent, entities, arena, conditionResolutionService, block);
                continue;
            }
            if (isChainControl(block)) continue;
            String head = BrainNormalizer.actionHead(block.action);
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
            public Map<String, Object> variables() {
                return player.customVariables;
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
                return AbilityState.windupRemainingMs(player, abilityId) > 0
                        || AbilityState.activeRemainingMs(player, abilityId) > 0;
            }

            @Override
            public boolean stunnedOrDead() {
                return player.hp <= 0 || BotStateService.statusActive(player, "stun");
            }

            @Override
            public String head(Object action) {
                return BrainNormalizer.actionHead(action);
            }
        };
    }

    private List<StrategyBlock> selectPriorityEntries(List<BrainNormalizer.TreeRoot> roots, Bot player, Bot opponent, List<Entity> entities, Arena arena) {
        return roots.isEmpty() ? List.of() : selectTreeEntries(roots, player, opponent, entities, arena);
    }

    private List<StrategyBlock> selectTreeEntries(List<BrainNormalizer.TreeRoot> normalized, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = new ArrayList<>();
        for (BrainNormalizer.TreeRoot root : normalized) {
            selected.addAll(selectTreeBranch(root.branches(), player, opponent, entities, arena));
            root.actions().stream().filter(block -> strategyBlockExecutableNow(block, player, opponent, entities)).forEach(selected::add);
        }
        return selected;
    }

    private List<StrategyBlock> selectTreeBranch(List<BrainNormalizer.TreeBranch> branches, Bot player, Bot opponent,
            List<Entity> entities, Arena arena) {
        List<StrategyBlock> selected = new ArrayList<>();
        for (BrainNormalizer.TreeBranch branch : branches) {
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
        String head = BrainNormalizer.actionHead(action);
        // Chain control is instant bookkeeping: it always selects its block and uses no category.
        if ("chain".equals(head)) return true;
        if ("movement".equals(head) || "rotation".equals(head)) return true;
        // Cancel only selects while a wind-up can actually be cancelled, so it never blocks anything.
        if ("cancel".equals(head)) return StaminaSystem.canCancelWindup(player);
        Integer ability = actionExecutionService.abilityForAction(action);
        return ability != null && actionExecutionService.selectedAbilityExecutable(player, ability);
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
                            botStateService.applyDamageFrom(owner, target, amount, sourceX, sourceY);
                        } else {
                            botStateService.applyDamage(target, amount, ownerSlot, sourceX, sourceY);
                        }
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
                    public Double ownerDamageMultiplier(List<Bot> activeBots, int ownerSlot) {
                        return activeBots.stream().filter(bot -> bot.slot == ownerSlot).findFirst()
                                .map(botStateService::damageMultiplier).orElse(null);
                    }

                    @Override
                    public String spawnEntityId(List<Bot> activeBots, int ownerSlot, String idPrefix,
                                                String parentEntityId) {
                        Bot owner = activeBots.stream().filter(bot -> bot.slot == ownerSlot).findFirst().orElse(null);
                        if (owner == null) return null;
                        String entityId = idPrefix + "-" + owner.userId + "-" + owner.abilityEntitySerial++;
                        // A child belongs to the activation that made its parent.
                        owner.entityActivations.put(entityId,
                                owner.entityActivations.getOrDefault(parentEntityId, owner.activationSerial));
                        return entityId;
                    }

                    @Override
                    public double[] ownerPose(List<Bot> activeBots, int ownerSlot) {
                        return activeBots.stream().filter(bot -> bot.slot == ownerSlot).findFirst()
                                .map(owner -> new double[] {owner.x, owner.y, owner.rotation}).orElse(null);
                    }

                });
    }

    private static SelectableSnapshot selectableSnapshot(ArenaEntity entity) {
        AbilityContracts.EntityContract contract = AbilityContracts.forEntity(entity);
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

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
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


    public interface Entity {
        double x();

        double y();

        int size();
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
}
