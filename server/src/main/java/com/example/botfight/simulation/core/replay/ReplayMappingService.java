package com.example.botfight.simulation.core.replay;

import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.state.StatusEffectState;
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
                bot.temporalRewindPulseMs, bot.closingZoneDamageCount, bot.teamNumber);
    }

    public MatchPlaybackDTO.ArenaEntityDTO toArenaEntity(ArenaEntity entity) {
        double rotation = Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001
                ? vectorBearing(entity.velocityX(), entity.velocityY()) : 0;
        return new MatchPlaybackDTO.ArenaEntityDTO(
                entity.id(), entity.type(), entity.abilityId(),
                round(entity.x()), round(entity.y()), entity.size(), rotation, entity.hp(), entity.armed(),
                entity.timerMs(), entity.velocityX(), entity.velocityY(), entity.shotVisualMs());
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
                temporalRewindPulseMs > 0 ? round(bot.temporalRewindX) : null,
                temporalRewindPulseMs > 0 ? round(bot.temporalRewindY) : null,
                positiveOrNull(temporalRewindPulseMs),
                positiveOrNull(bot.closingZoneDamageCount),
                bot.teamNumber);
    }

    private MatchReplayDTO.ReplayEntityDTO toReplayEntity(ArenaEntity entity) {
        String type = entity.type();
        boolean mine = "proximityMine".equals(type);
        boolean drone = "hunterDrone".equals(type) || "repellerDrone".equals(type);
        double rotation = Math.hypot(entity.velocityX(), entity.velocityY()) > 0.001
                ? vectorBearing(entity.velocityX(), entity.velocityY()) : 0;
        return new MatchReplayDTO.ReplayEntityDTO(
                entity.id(),
                type,
                entity.abilityId(),
                round(entity.x()),
                round(entity.y()),
                entity.size(),
                nonZeroOrNull(rotation),
                replayEntityHp(entity.hp(), drone),
                mine ? entity.armed() : null,
                positiveOrNull(entity.timerMs()),
                nonZeroOrNull(entity.velocityX()),
                nonZeroOrNull(entity.velocityY()),
                positiveOrNull(entity.shotVisualMs()));
    }

    private static List<StatusEffectState> copyStatusEffects(DuelSimulationService.Bot bot) {
        return bot.statusEffects.values().stream().map(status -> {
            StatusEffectState copy = new StatusEffectState(status.type, status.remainingMs, status.tickMs);
            copy.tickElapsedMs = status.tickElapsedMs;
            copy.mode = status.mode;
            copy.source = status.source;
            copy.sourceSlot = status.sourceSlot;
            copy.abilityId = status.abilityId;
            status.effects.forEach(effect -> copy.effects.add(new StatusEffectState.Effect(effect.type, effect.mode)
                    .amount(effect.amount)
                    .multiplier(effect.multiplier)
                    .durationMs(effect.durationMs)
                    .movement(effect.movementMultiplier, effect.rotationMultiplier)));
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
