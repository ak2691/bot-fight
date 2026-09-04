package com.example.botfight.DTO.match;

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
            Double visualOriginRotation) {

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
            Integer shotVisualMs,
            String phaseId,
            Integer visibleMs,
            String visualEventType,
            Integer visualEventMs,
            Integer visualEventSize) {
        public ArenaEntityDTO(String id, String type, Integer abilityId, double x, double y, int size,
                              double rotation, int hp, Boolean armed, Integer timerMs,
                              Double velocityX, Double velocityY, Integer shotVisualMs) {
            this(id, type, abilityId, x, y, size, rotation, hp, armed, timerMs, velocityX, velocityY,
                    shotVisualMs, null, null, null, null, null);
        }

        public ArenaEntityDTO(String id, String type, double x, double y, int size) {
            this(id, type, null, x, y, size, 0, 0, null, null, null, null, null);
        }

        public ArenaEntityDTO(String id, String type, double x, double y, int size, double rotation) {
            this(id, type, null, x, y, size, rotation, 0, null, null, null, null, null);
        }

        public ArenaEntityDTO(String id, String type, double x, double y, int size, double rotation, int hp) {
            this(id, type, null, x, y, size, rotation, hp, null, null, null, null, null);
        }
    }

    public record ReplayFrameDTO(
            int tick,
            int elapsedMs,
            List<BotStateDTO> bots,
            List<ArenaEntityDTO> entities) {
    }
}
