package com.example.botfight.simulation.core.replay;

import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** Maps authoritative mutable simulation state into immutable replay DTOs. */
@Service
public class ReplayMappingService {
    public MatchPlaybackDTO.BotStateDTO toBotState(DuelSimulationService.Bot bot) {
        return new MatchPlaybackDTO.BotStateDTO(
                bot.userId, bot.username, bot.slot,
                round(bot.x), round(bot.y), round(bot.rotation),
                bot.hp, bot.maxHp, bot.combatLoadout,
                List.copyOf(bot.abilities),
                copyStatusEffects(bot),
                Map.copyOf(bot.abilityCooldowns), Map.copyOf(bot.abilityActiveMs),
                Map.copyOf(bot.abilityCharges), Map.copyOf(bot.abilityRechargeMs),
                bot.triggeredAbility,
                bot.preparingAbility, bot.preparingMs, bot.temporalRewindMs,
                round(bot.temporalRewindX), round(bot.temporalRewindY),
                bot.temporalRewindPulseMs, bot.closingZoneDamageCount, bot.teamNumber,
                triggeredTargetX(bot), triggeredTargetY(bot),
                finiteOrNull(bot.visualOriginX), finiteOrNull(bot.visualOriginY),
                finiteOrNull(bot.visualOriginRotation));
    }

    public MatchPlaybackDTO.ArenaEntityDTO toArenaEntity(ArenaEntity entity) {
        double rotation = Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001
                ? vectorBearing(entity.velocityX(), entity.velocityY()) : 0;
        ReplayEntityVisual visual = replayEntityVisual(entity);
        return new MatchPlaybackDTO.ArenaEntityDTO(
                entity.id(), entity.type(), entity.abilityId(),
                round(entity.x()), round(entity.y()), entity.size(), rotation, entity.hp(), entity.armed(),
                entity.timerMs(), entity.velocityX(), entity.velocityY(), entity.shotVisualMs(),
                visual.phaseId(), visual.visibleMs(), visual.eventType(),
                visual.eventMs(), visual.eventSize());
    }

    /** Records the static bot metadata once for the compact replay. */
    public MatchReplayDTO.ReplayInitialStateDTO toReplayInitialState(List<DuelSimulationService.Bot> bots) {
        return new MatchReplayDTO.ReplayInitialStateDTO(
                bots.stream().map(this::toReplayStaticBot).toList());
    }

    /** Records only the dynamic state required by the compact replay contract. */
    public MatchReplayDTO.ReplayFrameDTO toReplayFrame(
            int elapsedMs,
            List<DuelSimulationService.Bot> bots,
            List<ArenaEntity> entities) {
        return new MatchReplayDTO.ReplayFrameDTO(
                elapsedMs,
                bots.stream().map(this::toReplayBot).toList(),
                entities.stream().map(this::toReplayEntity).toList());
    }

    private MatchReplayDTO.ReplayBotStaticDTO toReplayStaticBot(DuelSimulationService.Bot bot) {
        List<Integer> abilities = List.copyOf(bot.abilities);
        return new MatchReplayDTO.ReplayBotStaticDTO(
                bot.slot,
                round(bot.x),
                round(bot.y),
                nonZeroOrNull(round(bot.rotation)),
                bot.hp,
                bot.maxHp,
                abilities,
                initialEntries(abilities, bot.abilityCooldowns),
                positiveEntries(bot.abilityActiveMs),
                nonNegativeEntries(bot.abilityCharges),
                initialEntries(bot.abilityCharges.keySet().stream().toList(), bot.abilityRechargeMs),
                bot.teamNumber);
    }

    private MatchReplayDTO.ReplayBotDTO toReplayBot(DuelSimulationService.Bot bot) {
        int temporalRewindPulseMs = bot.temporalRewindPulseMs;
        return new MatchReplayDTO.ReplayBotDTO(
                bot.slot,
                round(bot.x),
                round(bot.y),
                nonZeroOrNull(round(bot.rotation)),
                bot.hp,
                copyStatusEffects(bot),
                positiveEntries(bot.abilityCooldowns),
                nonNegativeEntries(bot.abilityCharges),
                positiveEntries(bot.abilityRechargeMs),
                positiveEntries(bot.abilityActiveMs),
                bot.triggeredAbility,
                bot.preparingAbility,
                positiveOrNull(bot.preparingMs),
                triggeredTargetX(bot), triggeredTargetY(bot),
                finiteOrNull(bot.visualOriginX), finiteOrNull(bot.visualOriginY),
                finiteOrNull(bot.visualOriginRotation),
                temporalRewindPulseMs > 0 ? round(bot.temporalRewindX) : null,
                temporalRewindPulseMs > 0 ? round(bot.temporalRewindY) : null,
                positiveOrNull(temporalRewindPulseMs),
                positiveOrNull(bot.closingZoneDamageCount),
                bot.teamNumber);
    }

    private MatchReplayDTO.ReplayEntityDTO toReplayEntity(ArenaEntity entity) {
        String type = entity.type();
        boolean drone = "hunterDrone".equals(type) || "repellerDrone".equals(type);
        double rotation = Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001
                ? vectorBearing(entity.velocityX(), entity.velocityY()) : 0;
        ReplayEntityVisual visual = replayEntityVisual(entity);
        return new MatchReplayDTO.ReplayEntityDTO(
                entity.id(),
                type,
                entity.abilityId(),
                round(entity.x()),
                round(entity.y()),
                entity.size(),
                nonZeroOrNull(rotation),
                replayEntityHp(entity.hp(), drone),
                entity.armed(),
                positiveOrNull(entity.timerMs()),
                nonZeroOrNull(entity.velocityX()),
                nonZeroOrNull(entity.velocityY()),
                positiveOrNull(entity.shotVisualMs()),
                visual.phaseId(),
                visual.visibleMs(),
                visual.eventType(),
                visual.eventMs(),
                visual.eventSize());
    }

    /**
     * Replay presentation must use the current phase and live visual timer.
     * Entity snapshots are immutable, so deriving this at the mapping boundary
     * prevents a prior phase/event descriptor from leaking into later frames.
     */
    private static ReplayEntityVisual replayEntityVisual(ArenaEntity entity) {
        EntityContracts.Phase phase = EntityContracts.phaseFor(entity);
        int eventMs = Math.max(0, entity.visualEventMs());
        return new ReplayEntityVisual(
                phase == null ? entity.phaseId() : phase.id(),
                eventMs > 0 ? positiveOrNull(eventMs) : positiveOrNull(entity.visibleMs()),
                eventMs > 0 ? entity.visualEventType() : null,
                eventMs > 0 ? positiveOrNull(eventMs) : null,
                eventMs > 0 ? positiveOrNull(entity.visualEventSize()) : null);
    }

    private record ReplayEntityVisual(
            String phaseId,
            Integer visibleMs,
            String eventType,
            Integer eventMs,
            Integer eventSize) {}

    private static List<StatusEffectState> copyStatusEffects(DuelSimulationService.Bot bot) {
        return bot.statusEffects.values().stream().map(status -> {
            StatusEffectState copy = new StatusEffectState(status.type, status.remainingMs, status.tickMs);
            copy.tickElapsedMs = status.tickElapsedMs;
            copy.mode = status.mode;
            copy.source = status.source;
            copy.sourceSlot = status.sourceSlot;
            copy.abilityId = status.abilityId;
            status.effects.forEach(effect -> {
                StatusEffectState.Effect copied = new StatusEffectState.Effect(effect.type, effect.mode)
                        .amount(effect.amount)
                        .multiplier(effect.multiplier)
                        .damageModifier(effect.damageModifier)
                        .durationMs(effect.durationMs)
                        .movement(effect.movementMultiplier, effect.rotationMultiplier)
                        .rounding(effect.rounding);
                if (effect.excludedDamageSourceTypes != null) {
                    effect.excludedDamageSourceTypes.forEach(copied::excludeDamageSourceType);
                }
                copy.effects.add(copied);
            });
            return copy;
        }).toList();
    }

    private static Integer positiveOrNull(Integer value) {
        return value != null && value > 0 ? value : null;
    }

    private static Integer replayEntityHp(int hp, boolean drone) {
        return drone ? Integer.valueOf(hp) : positiveOrNull(hp);
    }

    private static Integer positiveOrNull(int value) {
        return value > 0 ? value : null;
    }

    private static Double triggeredTargetX(DuelSimulationService.Bot bot) {
        return bot.triggeredAbilityPayload == null
                ? null : finiteOrNull(bot.triggeredAbilityPayload.targetX());
    }

    private static Double triggeredTargetY(DuelSimulationService.Bot bot) {
        return bot.triggeredAbilityPayload == null
                ? null : finiteOrNull(bot.triggeredAbilityPayload.targetY());
    }

    private static Double finiteOrNull(double value) {
        return Double.isFinite(value) ? round(value) : null;
    }

    private static Double nonZeroOrNull(Double value) {
        return value != null && Math.abs(value) > 0.0001 ? value : null;
    }

    private static Map<Integer, Integer> positiveEntries(Map<Integer, Integer> values) {
        if (values == null || values.isEmpty()) return null;
        Map<Integer, Integer> positive = values.entrySet().stream()
                .filter(entry -> entry.getValue() != null && entry.getValue() > 0)
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
        return positive.isEmpty() ? null : positive;
    }

    private static Map<Integer, Integer> nonNegativeEntries(Map<Integer, Integer> values) {
        if (values == null || values.isEmpty()) return null;
        Map<Integer, Integer> nonNegative = values.entrySet().stream()
                .filter(entry -> entry.getValue() != null && entry.getValue() >= 0)
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
        return nonNegative.isEmpty() ? null : nonNegative;
    }

    private static Map<Integer, Integer> initialEntries(List<Integer> abilityIds, Map<Integer, Integer> values) {
        if (abilityIds == null || abilityIds.isEmpty()) return null;
        Map<Integer, Integer> initial = abilityIds.stream()
                .filter(id -> id != null)
                .distinct()
                .collect(Collectors.toUnmodifiableMap(
                        id -> id,
                        id -> values == null ? 0 : values.getOrDefault(id, 0)));
        return initial.isEmpty() ? null : initial;
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
}
