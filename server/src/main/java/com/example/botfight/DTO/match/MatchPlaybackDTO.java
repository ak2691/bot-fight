package com.example.botfight.DTO.match;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.example.botfight.simulation.core.state.StatusEffectState;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record MatchPlaybackDTO(
        UUID matchId,
        String rulesetVersion,
        String status,
        ArenaStateDTO initialState,
        List<ReplayFrameDTO> frames,
        String result,
        UUID winnerUserId,
        String message,
        Integer batchSequence,
        Integer replayCursorElapsedMs,
        boolean terminalBatch) {

    public MatchPlaybackDTO(
            UUID matchId, String rulesetVersion, String status, ArenaStateDTO initialState,
            List<ReplayFrameDTO> frames, String result, UUID winnerUserId, String message) {
        this(matchId, rulesetVersion, status, initialState, frames, result, winnerUserId, message,
                null, null, false);
    }

    public record ArenaStateDTO(
            int width,
            int height,
            List<BotStateDTO> bots,
            List<ArenaEntityDTO> entities) {
    }

    public record BotStateDTO(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            double rotation,
            double hp,
            double maxHp,
            String combatLoadout,
            List<Integer> abilities,
            List<StatusEffectState> statusEffects,
            Map<Integer, Integer> abilityCooldowns,
            Map<Integer, Integer> abilityActiveMs,
            Map<Integer, Integer> abilityCharges,
            Map<Integer, Integer> abilityRechargeMs,
            Integer triggeredAbility,
            Integer preparingAbility,
            int preparingMs,
            int temporalRewindMs,
            double temporalRewindX,
            double temporalRewindY,
            int temporalRewindPulseMs,
            int closingZoneDamageCount,
            int teamNumber,
            Double abilityTargetX,
            Double abilityTargetY,
            Double visualOriginX,
            Double visualOriginY,
            Double visualOriginRotation,
            Double dashDirectionX,
            Double dashDirectionY,
            Integer stamina,
            Boolean exhausted,
            Boolean sprinting,
            @JsonInclude(JsonInclude.Include.NON_NULL) MatchReplayDTO.RunningChainDTO runningChain,
            @JsonInclude(JsonInclude.Include.NON_NULL) Boolean fastTurning) {
        /** Source compatibility for callers without fast-turn state. */
        public BotStateDTO(UUID userId, String username, int slot, double x, double y, double rotation, double hp, double maxHp, String combatLoadout, List<Integer> abilities, List<StatusEffectState> statusEffects, Map<Integer, Integer> abilityCooldowns, Map<Integer, Integer> abilityActiveMs, Map<Integer, Integer> abilityCharges, Map<Integer, Integer> abilityRechargeMs, Integer triggeredAbility, Integer preparingAbility, int preparingMs, int temporalRewindMs, double temporalRewindX, double temporalRewindY, int temporalRewindPulseMs, int closingZoneDamageCount, int teamNumber, Double abilityTargetX, Double abilityTargetY, Double visualOriginX, Double visualOriginY, Double visualOriginRotation, Double dashDirectionX, Double dashDirectionY, Integer stamina, Boolean exhausted, Boolean sprinting, MatchReplayDTO.RunningChainDTO runningChain) {
            this(userId, username, slot, x, y, rotation, hp, maxHp, combatLoadout, abilities, statusEffects, abilityCooldowns, abilityActiveMs, abilityCharges, abilityRechargeMs, triggeredAbility, preparingAbility, preparingMs, temporalRewindMs, temporalRewindX, temporalRewindY, temporalRewindPulseMs, closingZoneDamageCount, teamNumber, abilityTargetX, abilityTargetY, visualOriginX, visualOriginY, visualOriginRotation, dashDirectionX, dashDirectionY, stamina, exhausted, sprinting, runningChain, null);
        }

        /** Source compatibility for replay callers without chain presentation state. */
        public BotStateDTO(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            double rotation,
            double hp,
            double maxHp,
            String combatLoadout,
            List<Integer> abilities,
            List<StatusEffectState> statusEffects,
            Map<Integer, Integer> abilityCooldowns,
            Map<Integer, Integer> abilityActiveMs,
            Map<Integer, Integer> abilityCharges,
            Map<Integer, Integer> abilityRechargeMs,
            Integer triggeredAbility,
            Integer preparingAbility,
            int preparingMs,
            int temporalRewindMs,
            double temporalRewindX,
            double temporalRewindY,
            int temporalRewindPulseMs,
            int closingZoneDamageCount,
            int teamNumber,
            Double abilityTargetX,
            Double abilityTargetY,
            Double visualOriginX,
            Double visualOriginY,
            Double visualOriginRotation,
            Double dashDirectionX,
            Double dashDirectionY,
            Integer stamina,
            Boolean exhausted,
            Boolean sprinting) {
            this(userId, username, slot, x, y, rotation, hp, maxHp, combatLoadout, abilities, statusEffects, abilityCooldowns, abilityActiveMs, abilityCharges, abilityRechargeMs, triggeredAbility, preparingAbility, preparingMs, temporalRewindMs, temporalRewindX, temporalRewindY, temporalRewindPulseMs, closingZoneDamageCount, teamNumber, abilityTargetX, abilityTargetY, visualOriginX, visualOriginY, visualOriginRotation, dashDirectionX, dashDirectionY, stamina, exhausted, sprinting, null);
        }


        /** Source compatibility for callers without stamina state. */
        public BotStateDTO(
                UUID userId, String username, int slot, double x, double y, double rotation,
                double hp, double maxHp, String combatLoadout, List<Integer> abilities,
                List<StatusEffectState> statusEffects, Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityActiveMs, Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs, Integer triggeredAbility,
                Integer preparingAbility, int preparingMs, int temporalRewindMs,
                double temporalRewindX, double temporalRewindY, int temporalRewindPulseMs,
                int closingZoneDamageCount, int teamNumber, Double abilityTargetX,
                Double abilityTargetY, Double visualOriginX, Double visualOriginY,
                Double visualOriginRotation, Double dashDirectionX, Double dashDirectionY) {
            this(userId, username, slot, x, y, rotation, hp, maxHp, combatLoadout,
                    abilities, statusEffects, abilityCooldowns, abilityActiveMs,
                    abilityCharges, abilityRechargeMs, triggeredAbility, preparingAbility,
                    preparingMs, temporalRewindMs, temporalRewindX, temporalRewindY,
                    temporalRewindPulseMs, closingZoneDamageCount, teamNumber,
                    abilityTargetX, abilityTargetY, visualOriginX, visualOriginY,
                    visualOriginRotation, dashDirectionX, dashDirectionY, null, null, null);
        }

        public BotStateDTO(
                UUID userId, String username, int slot, double x, double y, double rotation,
                double hp, double maxHp, String combatLoadout, List<Integer> abilities,
                List<StatusEffectState> statusEffects, Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityActiveMs, Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs, Integer triggeredAbility,
                Integer preparingAbility, int preparingMs, int temporalRewindMs,
                double temporalRewindX, double temporalRewindY, int temporalRewindPulseMs,
                int closingZoneDamageCount, int teamNumber, Double abilityTargetX,
                Double abilityTargetY, Double visualOriginX, Double visualOriginY,
                Double visualOriginRotation) {
            this(userId, username, slot, x, y, rotation, hp, maxHp, combatLoadout,
                    abilities, statusEffects, abilityCooldowns, abilityActiveMs,
                    abilityCharges, abilityRechargeMs, triggeredAbility, preparingAbility,
                    preparingMs, temporalRewindMs, temporalRewindX, temporalRewindY,
                    temporalRewindPulseMs, closingZoneDamageCount, teamNumber,
                    abilityTargetX, abilityTargetY, visualOriginX, visualOriginY,
                    visualOriginRotation, null, null);
        }

        public BotStateDTO(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                double rotation,
                double hp,
                double maxHp,
                String combatLoadout,
                List<Integer> abilities,
                List<StatusEffectState> statusEffects,
                Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityActiveMs,
                Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs,
                Integer triggeredAbility,
                Integer preparingAbility,
                int preparingMs,
                int temporalRewindMs,
                double temporalRewindX,
                double temporalRewindY,
                int temporalRewindPulseMs,
                int closingZoneDamageCount) {
            this(userId, username, slot, x, y, rotation, hp, maxHp, combatLoadout,
                    abilities, statusEffects, abilityCooldowns, abilityActiveMs,
                    abilityCharges, abilityRechargeMs, triggeredAbility, preparingAbility,
                    preparingMs, temporalRewindMs, temporalRewindX, temporalRewindY,
                    temporalRewindPulseMs, closingZoneDamageCount, slot,
                    null, null, null, null, null);
        }

        /** Keeps source compatibility for callers that already provide team identity. */
        public BotStateDTO(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                double rotation,
                double hp,
                double maxHp,
                String combatLoadout,
                List<Integer> abilities,
                List<StatusEffectState> statusEffects,
                Map<Integer, Integer> abilityCooldowns,
                Map<Integer, Integer> abilityActiveMs,
                Map<Integer, Integer> abilityCharges,
                Map<Integer, Integer> abilityRechargeMs,
                Integer triggeredAbility,
                Integer preparingAbility,
                int preparingMs,
                int temporalRewindMs,
                double temporalRewindX,
                double temporalRewindY,
                int temporalRewindPulseMs,
                int closingZoneDamageCount,
                int teamNumber) {
            this(userId, username, slot, x, y, rotation, hp, maxHp, combatLoadout,
                    abilities, statusEffects, abilityCooldowns, abilityActiveMs,
                    abilityCharges, abilityRechargeMs, triggeredAbility, preparingAbility,
                    preparingMs, temporalRewindMs, temporalRewindX, temporalRewindY,
                    temporalRewindPulseMs, closingZoneDamageCount, teamNumber,
                    null, null, null, null, null);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ArenaEntityDTO(
            String id,
            String type,
            Integer abilityId,
            double x,
            double y,
            int size,
            double rotation,
            int hp,
            Boolean armed,
            Integer timerMs,
            Double velocityX,
            Double velocityY,
            String phaseId,
            Integer phaseTimerMs,
            String eventType,
            String eventPhaseId,
            Integer eventSequence) {

        public ArenaEntityDTO(String id, String type, Integer abilityId, double x, double y,
                              int size, double rotation, int hp, Boolean armed,
                              Integer timerMs, Double velocityX, Double velocityY,
                              String phaseId, Integer phaseTimerMs, String eventType,
                              Integer eventSequence) {
            this(id, type, abilityId, x, y, size, rotation, hp, armed, timerMs,
                    velocityX, velocityY, phaseId, phaseTimerMs, eventType, null,
                    eventSequence);
        }

        public ArenaEntityDTO(String id, String type, double x, double y, int size) {
            this(id, type, null, x, y, size, 0, 0, null, null, null, null,
                    null, null, null, null);
        }

        public ArenaEntityDTO(String id, String type, double x, double y, int size, double rotation) {
            this(id, type, null, x, y, size, rotation, 0, null, null, null, null,
                    null, null, null, null);
        }

        public ArenaEntityDTO(String id, String type, double x, double y, int size, double rotation, int hp) {
            this(id, type, null, x, y, size, rotation, hp, null, null, null, null,
                    null, null, null, null);
        }
    }

    public record ReplayFrameDTO(
            int tick,
            int elapsedMs,
            List<BotStateDTO> bots,
            List<ArenaEntityDTO> entities) {
    }
}
