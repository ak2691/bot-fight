package com.example.botfight.DTO.match;

import com.example.botfight.simulation.core.state.StatusEffectState;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import com.fasterxml.jackson.annotation.JsonInclude;

/** Compact presentation-only replay payload sent over the matchmaking socket. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MatchReplayDTO(
        ReplayInitialStateDTO initialState,
        List<ReplayFrameDTO> frames,
        String result,
        UUID winnerUserId,
        String message,
        Integer batchSequence,
        Integer replayCursorElapsedMs,
        @JsonInclude(JsonInclude.Include.NON_DEFAULT) Boolean terminalBatch,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) Map<UUID, Integer> roundWinsBeforeResult,
        Integer ratingBefore,
        Integer ratingAfter,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) List<RatingChangeDTO> ratingChanges) {

    /** Keeps source compatibility for callers that do not have score metadata. */
    public MatchReplayDTO(
            ReplayInitialStateDTO initialState,
            List<ReplayFrameDTO> frames,
            String result,
            UUID winnerUserId,
            String message,
            Integer batchSequence,
            Integer replayCursorElapsedMs,
            Boolean terminalBatch) {
        this(initialState, frames, result, winnerUserId, message, batchSequence,
                replayCursorElapsedMs, terminalBatch, null);
    }

    /** Keeps source compatibility for callers that already provide score metadata. */
    public MatchReplayDTO(
            ReplayInitialStateDTO initialState,
            List<ReplayFrameDTO> frames,
            String result,
            UUID winnerUserId,
            String message,
            Integer batchSequence,
            Integer replayCursorElapsedMs,
            Boolean terminalBatch,
            Map<UUID, Integer> roundWinsBeforeResult) {
        this(initialState, frames, result, winnerUserId, message, batchSequence,
                replayCursorElapsedMs, terminalBatch, roundWinsBeforeResult, null, null, null);
    }

    /** Keeps source compatibility for callers that provide the recipient rating change. */
    public MatchReplayDTO(
            ReplayInitialStateDTO initialState,
            List<ReplayFrameDTO> frames,
            String result,
            UUID winnerUserId,
            String message,
            Integer batchSequence,
            Integer replayCursorElapsedMs,
            Boolean terminalBatch,
            Map<UUID, Integer> roundWinsBeforeResult,
            Integer ratingBefore,
            Integer ratingAfter) {
        this(initialState, frames, result, winnerUserId, message, batchSequence,
                replayCursorElapsedMs, terminalBatch, roundWinsBeforeResult,
                ratingBefore, ratingAfter, null);
    }

    public MatchReplayDTO withRatingChange(Integer before, Integer after) {
        return new MatchReplayDTO(
                initialState,
                frames,
                result,
                winnerUserId,
                message,
                batchSequence,
                replayCursorElapsedMs,
                terminalBatch,
                roundWinsBeforeResult,
                before,
                after,
                ratingChanges);
    }

    public MatchReplayDTO withRatingChanges(List<RatingChangeDTO> changes) {
        return new MatchReplayDTO(
                initialState,
                frames,
                result,
                winnerUserId,
                message,
                batchSequence,
                replayCursorElapsedMs,
                terminalBatch,
                roundWinsBeforeResult,
                ratingBefore,
                ratingAfter,
                changes == null || changes.isEmpty() ? null : List.copyOf(changes));
    }

    public static MatchReplayDTO from(MatchPlaybackDTO playback) {
        if (playback == null) return null;
        return new MatchReplayDTO(
                replayInitialState(playback.initialState()),
                playback.frames() == null
                        ? List.of()
                        : playback.frames().stream().map(ReplayFrameDTO::from).toList(),
                playback.result(),
                playback.winnerUserId(),
                playback.message(),
                playback.batchSequence(),
                playback.replayCursorElapsedMs(),
                playback.terminalBatch(),
                null,
                null,
                null,
                null);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RatingChangeDTO(
            String username,
            Integer before,
            Integer after) {
    }

    private static ReplayInitialStateDTO replayInitialState(MatchPlaybackDTO.ArenaStateDTO state) {
        if (state == null) return null;
        return new ReplayInitialStateDTO(
                state.bots() == null ? List.of() : state.bots().stream()
                        .map(ReplayBotStaticDTO::from)
                        .toList());
    }

    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record ReplayInitialStateDTO(List<ReplayBotStaticDTO> bots) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReplayBotStaticDTO(
            int slot,
            double x,
            double y,
            Double rotation,
            double hp,
            double maxHp,
            List<Integer> abilities,
            Map<Integer, Integer> abilityCooldowns,
            Map<Integer, Integer> abilityActiveMs,
            Map<Integer, Integer> abilityCharges,
            Map<Integer, Integer> abilityRechargeMs,
            int teamNumber) {
        public ReplayBotStaticDTO(int slot, double x, double y, Double rotation, int hp, int maxHp) {
            this(slot, x, y, rotation, hp, maxHp, null, null, null, null, null, slot);
        }

        public ReplayBotStaticDTO(
                int slot,
                double x,
                double y,
                Double rotation,
                double hp,
                double maxHp,
                List<Integer> abilities,
                Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityActiveMs,
                Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs) {
            this(slot, x, y, rotation, hp, maxHp, abilities, abilityCooldowns,
                    abilityActiveMs, abilityCharges, abilityRechargeMs, slot);
        }

        private static ReplayBotStaticDTO from(MatchPlaybackDTO.BotStateDTO bot) {
            List<Integer> abilities = bot.abilities() == null ? List.of() : bot.abilities();
            return new ReplayBotStaticDTO(
                    bot.slot(), bot.x(), bot.y(), nonZeroOrNull(bot.rotation()), bot.hp(), bot.maxHp(),
                    abilities,
                    initialEntries(abilities, bot.abilityCooldowns()),
                    positiveEntries(bot.abilityActiveMs()),
                    nonNegativeEntries(bot.abilityCharges()),
                    initialEntries(bot.abilityCharges() == null ? List.of() : bot.abilityCharges().keySet().stream().toList(),
                            bot.abilityRechargeMs()),
                    bot.teamNumber());
        }
    }

    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record ReplayFrameDTO(
            int elapsedMs,
            List<ReplayBotDTO> bots,
            List<ReplayEntityDTO> entities) {
        private static ReplayFrameDTO from(MatchPlaybackDTO.ReplayFrameDTO frame) {
            return new ReplayFrameDTO(
                    frame.elapsedMs(),
                    frame.bots() == null ? List.of() : frame.bots().stream()
                            .map(ReplayBotDTO::from)
                            .toList(),
                    frame.entities() == null ? List.of() : frame.entities().stream()
                            .map(ReplayEntityDTO::from)
                            .toList());
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReplayBotDTO(
            int slot,
            double x,
            double y,
            Double rotation,
            double hp,
            List<StatusEffectState> statusEffects,
            Map<Integer, Integer> abilityCooldowns,
            Map<Integer, Integer> abilityCharges,
            Map<Integer, Integer> abilityRechargeMs,
            Map<Integer, Integer> abilityActiveMs,
            Integer triggeredAbility,
            Integer preparingAbility,
            Integer preparingMs,
            Double abilityTargetX,
            Double abilityTargetY,
            Double visualOriginX,
            Double visualOriginY,
            Double visualOriginRotation,
            Double temporalRewindX,
            Double temporalRewindY,
            Integer temporalRewindPulseMs,
            Integer closingZoneDamageCount,
            int teamNumber) {
        private ReplayBotDTO(
                int slot,
                double x,
                double y,
                Double rotation,
                double hp,
                List<StatusEffectState> statusEffects,
                Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs,
                Map<Integer, Integer> abilityActiveMs,
                Integer triggeredAbility,
                Integer preparingAbility,
                Double temporalRewindX,
                Double temporalRewindY,
                Integer temporalRewindPulseMs,
                Integer closingZoneDamageCount) {
            this(slot, x, y, rotation, hp, statusEffects, abilityCooldowns,
                    abilityCharges, abilityRechargeMs, abilityActiveMs, triggeredAbility,
                    preparingAbility,
                    null, null, null, null, null, null,
                    temporalRewindX, temporalRewindY, temporalRewindPulseMs,
                    closingZoneDamageCount, slot);
        }

        /** Keeps source compatibility for callers that already provide team identity. */
        public ReplayBotDTO(
                int slot,
                double x,
                double y,
                Double rotation,
                double hp,
                List<StatusEffectState> statusEffects,
                Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs,
                Map<Integer, Integer> abilityActiveMs,
                Integer triggeredAbility,
                Integer preparingAbility,
                Double temporalRewindX,
                Double temporalRewindY,
                Integer temporalRewindPulseMs,
                Integer closingZoneDamageCount,
                int teamNumber) {
            this(slot, x, y, rotation, hp, statusEffects, abilityCooldowns,
                    abilityCharges, abilityRechargeMs, abilityActiveMs, triggeredAbility,
                    preparingAbility,
                    null, null, null, null, null, null,
                    temporalRewindX, temporalRewindY, temporalRewindPulseMs,
                    closingZoneDamageCount, teamNumber);
        }

        private static ReplayBotDTO from(MatchPlaybackDTO.BotStateDTO bot) {
            int temporalRewindPulseMs = bot.temporalRewindPulseMs();
            return new ReplayBotDTO(
                    bot.slot(),
                    bot.x(),
                    bot.y(),
                    nonZeroOrNull(bot.rotation()),
                    bot.hp(),
                    bot.statusEffects(),
                    positiveEntries(bot.abilityCooldowns()),
                    nonNegativeEntries(bot.abilityCharges()),
                    positiveEntries(bot.abilityRechargeMs()),
                    positiveEntries(bot.abilityActiveMs()),
                    bot.triggeredAbility(),
                    bot.preparingAbility(),
                    positiveOrNull(bot.preparingMs()),
                    finiteOrNull(bot.abilityTargetX()),
                    finiteOrNull(bot.abilityTargetY()),
                    finiteOrNull(bot.visualOriginX()),
                    finiteOrNull(bot.visualOriginY()),
                    finiteOrNull(bot.visualOriginRotation()),
                    temporalRewindPulseMs > 0 ? bot.temporalRewindX() : null,
                    temporalRewindPulseMs > 0 ? bot.temporalRewindY() : null,
                    positiveOrNull(temporalRewindPulseMs),
                    positiveOrNull(bot.closingZoneDamageCount()),
                    bot.teamNumber());
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReplayEntityDTO(
            String id,
            String type,
            Integer abilityId,
            double x,
            double y,
            int size,
            Double rotation,
            Integer hp,
            Boolean armed,
            Integer timerMs,
            Double velocityX,
            Double velocityY,
            Integer shotVisualMs,
            String phaseId,
            Integer visibleMs,
            String visualEventType,
            Integer visualEventMs,
            Integer visualEventSize) {
        public ReplayEntityDTO(String id, String type, Integer abilityId, double x, double y, int size,
                               Double rotation, Integer hp, Boolean armed, Integer timerMs,
                               Double velocityX, Double velocityY, Integer shotVisualMs) {
            this(id, type, abilityId, x, y, size, rotation, hp, armed, timerMs, velocityX, velocityY,
                    shotVisualMs, null, null, null, null, null);
        }

        private static ReplayEntityDTO from(MatchPlaybackDTO.ArenaEntityDTO entity) {
            String type = entity.type();
            boolean drone = "hunterDrone".equals(type) || "repellerDrone".equals(type);
            Integer visualEventMs = positiveOrNull(entity.visualEventMs());
            return new ReplayEntityDTO(
                    entity.id(),
                    type,
                    entity.abilityId(),
                    entity.x(),
                    entity.y(),
                    entity.size(),
                    nonZeroOrNull(entity.rotation()),
                    drone ? Integer.valueOf(entity.hp()) : positiveOrNull(entity.hp()),
                    entity.armed(),
                    positiveOrNull(entity.timerMs()),
                    nonZeroOrNull(entity.velocityX()),
                    nonZeroOrNull(entity.velocityY()),
                    positiveOrNull(entity.shotVisualMs()),
                    entity.phaseId(),
                    visualEventMs == null ? positiveOrNull(entity.visibleMs()) : visualEventMs,
                    visualEventMs == null ? null : entity.visualEventType(),
                    visualEventMs,
                    visualEventMs == null ? null : positiveOrNull(entity.visualEventSize()));
        }
    }

    private static Integer positiveOrNull(Integer value) {
        return value != null && value > 0 ? value : null;
    }

    private static Integer positiveOrNull(int value) {
        return value > 0 ? value : null;
    }

    private static Double nonZeroOrNull(Double value) {
        return value != null && Math.abs(value) > 0.0001 ? value : null;
    }

    private static Double finiteOrNull(Double value) {
        return value != null && Double.isFinite(value) ? value : null;
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
}
