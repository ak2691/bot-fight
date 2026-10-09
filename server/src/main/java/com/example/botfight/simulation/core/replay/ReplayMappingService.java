package com.example.botfight.simulation.core.replay;

import com.example.botfight.simulation.core.orchestration.Bot;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.core.state.StaminaSystem;
import com.example.botfight.simulation.gameconfig.AbilityChannels;
import com.example.botfight.simulation.core.state.StatusEffectState;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** Maps authoritative mutable simulation state into immutable replay DTOs. */
@Service
public class ReplayMappingService {
    public MatchPlaybackDTO.BotStateDTO toBotState(Bot bot) {
        return new MatchPlaybackDTO.BotStateDTO(
                bot.userId, bot.username, bot.slot,
                round(bot.x), round(bot.y), round(bot.rotation),
                bot.hp, bot.maxHp, bot.combatLoadout,
                List.copyOf(bot.abilities),
                copyStatusEffects(bot),
                Map.copyOf(AbilityState.legacyCooldowns(bot)), Map.copyOf(AbilityState.legacyActiveMs(bot)),
                Map.copyOf(AbilityState.legacyCharges(bot)), Map.copyOf(AbilityState.legacyRechargeMs(bot)),
                bot.triggeredAbility,
                AbilityState.legacyPreparingAbility(bot), AbilityState.preparingRemainingMs(bot),
                bot.temporalRewindMs,
                round(bot.temporalRewindX), round(bot.temporalRewindY),
                bot.temporalRewindPulseMs, bot.closingZoneDamageCount, bot.teamNumber,
                triggeredTargetX(bot), triggeredTargetY(bot),
                finiteOrNull(bot.visualOriginX), finiteOrNull(bot.visualOriginY),
                finiteOrNull(bot.visualOriginRotation), dashDirectionX(bot), dashDirectionY(bot),
                StaminaSystem.stamina(bot), bot.sprinting, runningChain(bot),
                bot.fastTurning ? Boolean.TRUE : null);
    }

    public MatchPlaybackDTO.ArenaEntityDTO toArenaEntity(ArenaEntity entity) {
        String phaseId = replayEntityPhaseId(entity);
        return new MatchPlaybackDTO.ArenaEntityDTO(
                entity.id(), entity.type(), entity.abilityId(),
                round(entity.x()), round(entity.y()), entity.size(), entity.rotation(), entity.hp(), entity.armed(),
                entity.timerMs(), entity.velocityX(), entity.velocityY(),
                phaseId, positiveOrNull(entity.phaseTimerMs()), entity.eventType(),
                entity.eventPhaseId(),
                positiveOrNull(entity.eventSequence()));
    }

    /** Records the static bot metadata once for the compact replay. */
    public MatchReplayDTO.ReplayInitialStateDTO toReplayInitialState(List<Bot> bots) {
        return new MatchReplayDTO.ReplayInitialStateDTO(
                bots.stream().map(this::toReplayStaticBot).toList());
    }

    /** Records only the dynamic state required by the compact replay contract. */
    public MatchReplayDTO.ReplayFrameDTO toReplayFrame(
            int elapsedMs,
            List<Bot> bots,
            List<ArenaEntity> entities) {
        return new MatchReplayDTO.ReplayFrameDTO(
                elapsedMs,
                bots.stream().map(this::toReplayBot).toList(),
                entities.stream().map(this::toReplayEntity).toList());
    }

    private MatchReplayDTO.ReplayBotStaticDTO toReplayStaticBot(Bot bot) {
        List<Integer> abilities = List.copyOf(bot.abilities);
        return new MatchReplayDTO.ReplayBotStaticDTO(
                bot.slot,
                round(bot.x),
                round(bot.y),
                nonZeroOrNull(round(bot.rotation)),
                bot.hp,
                bot.maxHp,
                abilities,
                initialEntries(abilities, AbilityState.legacyCooldowns(bot)),
                positiveEntries(AbilityState.legacyActiveMs(bot)),
                nonNegativeEntries(AbilityState.legacyCharges(bot)),
                initialEntries(AbilityState.legacyCharges(bot).keySet().stream().toList(),
                        AbilityState.legacyRechargeMs(bot)),
                bot.teamNumber);
    }

    private MatchReplayDTO.ReplayBotDTO toReplayBot(Bot bot) {
        int temporalRewindPulseMs = bot.temporalRewindPulseMs;
        return new MatchReplayDTO.ReplayBotDTO(
                bot.slot,
                round(bot.x),
                round(bot.y),
                finiteOrNull(round(bot.rotation)),
                bot.hp,
                copyStatusEffects(bot),
                positiveEntries(AbilityState.legacyCooldowns(bot)),
                nonNegativeEntries(AbilityState.legacyCharges(bot)),
                positiveEntries(AbilityState.legacyRechargeMs(bot)),
                positiveEntries(AbilityState.legacyActiveMs(bot)),
                bot.triggeredAbility,
                AbilityState.legacyPreparingAbility(bot),
                positiveOrNull(AbilityState.preparingRemainingMs(bot)),
                triggeredTargetX(bot), triggeredTargetY(bot),
                finiteOrNull(bot.visualOriginX), finiteOrNull(bot.visualOriginY),
                finiteOrNull(bot.visualOriginRotation),
                temporalRewindPulseMs > 0 ? round(bot.temporalRewindX) : null,
                temporalRewindPulseMs > 0 ? round(bot.temporalRewindY) : null,
                positiveOrNull(temporalRewindPulseMs),
                positiveOrNull(bot.closingZoneDamageCount),
                dashDirectionX(bot),
                dashDirectionY(bot),
                bot.teamNumber,
                StaminaSystem.stamina(bot),
                // Only set while true, like the other compact optional fields.
                bot.sprinting ? Boolean.TRUE : null, runningChain(bot),
                bot.fastTurning ? Boolean.TRUE : null);
    }

    private static MatchReplayDTO.RunningChainDTO runningChain(Bot bot) {
        if (bot.chainStack.isEmpty()) return null;
        var frame = bot.chainStack.getLast();
        return new MatchReplayDTO.RunningChainDTO(frame.chainId, frame.path, bot.chainStack.size(),
                bot.chainName(frame.chainId));
    }

    private MatchReplayDTO.ReplayEntityDTO toReplayEntity(ArenaEntity entity) {
        String type = entity.type();
        boolean drone = "hunterDrone".equals(type) || "repellerDrone".equals(type);
        String phaseId = replayEntityPhaseId(entity);
        return new MatchReplayDTO.ReplayEntityDTO(
                entity.id(),
                type,
                entity.abilityId(),
                round(entity.x()),
                round(entity.y()),
                entity.size(),
                nonZeroOrNull(entity.rotation()),
                replayEntityHp(entity.hp(), drone),
                entity.armed(),
                positiveOrNull(entity.timerMs()),
                nonZeroOrNull(entity.velocityX()),
                nonZeroOrNull(entity.velocityY()),
                phaseId,
                positiveOrNull(entity.phaseTimerMs()),
                entity.eventType(),
                entity.eventPhaseId(),
                positiveOrNull(entity.eventSequence()),
                entity.statusEffects().isEmpty() ? null : entity.statusEffects());
    }

    /**
     * Replay entities carry authoritative lifecycle/phase state plus semantic
     * event occurrences. The browser contract owns the presentation mapping;
     * no visual type, size, or duration is copied into the replay payload.
     */
    private static String replayEntityPhaseId(ArenaEntity entity) {
        AbilityContracts.AbilityPhase phase = AbilityContracts.phaseFor(entity);
        return phase == null ? entity.phaseId() : phase.id();
    }

    private static List<StatusEffectState> copyStatusEffects(Bot bot) {
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

    private static Double triggeredTargetX(Bot bot) {
        return bot.triggeredAbilityPayload == null
                ? null : finiteOrNull(bot.triggeredAbilityPayload.targetX());
    }

    private static Double triggeredTargetY(Bot bot) {
        return bot.triggeredAbilityPayload == null
                ? null : finiteOrNull(bot.triggeredAbilityPayload.targetY());
    }

    private static Double dashDirectionX(Bot bot) {
        return hasDashVisualState(bot) ? finiteOrNull(bot.dashDirectionX) : null;
    }

    private static Double dashDirectionY(Bot bot) {
        return hasDashVisualState(bot) ? finiteOrNull(bot.dashDirectionY) : null;
    }

    private static boolean hasDashVisualState(Bot bot) {
        return bot.dashRemaining > 0 || AbilityState.channelActive(bot, AbilityChannels.DASH);
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
