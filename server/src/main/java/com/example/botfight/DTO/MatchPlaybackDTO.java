package com.example.botfight.DTO;

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
            UUID matchId,
            String rulesetVersion,
            String status,
            ArenaStateDTO initialState,
            List<ReplayFrameDTO> frames,
            String result,
            UUID winnerUserId,
            String message) {
        this(matchId, rulesetVersion, status, initialState, frames, result, winnerUserId, message, null, null, false);
    }

    public record ArenaStateDTO(
            int width,
            int height,
            List<FighterPlacementDTO> fighters,
            List<ObstaclePlacementDTO> obstacles) {
    }

    public record FighterPlacementDTO(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            double rotation,
            int hp,
            String combatClass,
            boolean attackActive,
            boolean blockActive,
            Integer gunAmmo,
            Integer gunReloadMs,
            int shieldHp,
            int slowedMs,
            int stunnedMs,
            int silencedMs,
            int shockRemainingMs,
            int movementLockMs,
            int maxHp,
            List<String> abilities,
            boolean gunShotActive,
            boolean swingActive,
            boolean fireballActive,
            boolean stunActive,
            boolean dashActive,
            int fireballCharges,
            int fireballReloadMs,
            int swingCooldownMs,
            int blockCharges,
            int blockCooldownMs,
            int blockRechargeMs,
            int dashCooldownMs,
            int gunCooldownMs,
            int grenadeCooldownMs,
            int fireballCooldownMs,
            int stunCooldownMs,
            Map<String, Integer> abilityCooldowns,
            Map<String, Integer> abilityActiveMs,
            String preparingAbility,
            int preparingMs,
            int burnRemainingMs,
            int bleedRemainingMs,
            int temporalRewindMs,
            double temporalRewindX,
            double temporalRewindY,
            int temporalRewindPulseMs) {
        public FighterPlacementDTO(
                UUID userId,
                String username,
                int slot,
                double x,
                double y,
                double rotation,
                int hp,
                String combatClass,
                boolean attackActive,
                boolean blockActive,
                Integer gunAmmo,
                Integer gunReloadMs) {
            this(userId, username, slot, x, y, rotation, hp, combatClass, attackActive, blockActive, gunAmmo, gunReloadMs, 0, 0, 0, 0, 0, 0, 100, List.of(), false, false, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Map.of(), Map.of(), null, 0, 0, 0, 0, x, y, 0);
        }
    }

    public record ObstaclePlacementDTO(
            String id,
            String type,
            double x,
            double y,
            int size,
            double rotation,
            int hp,
            int slotOneCaptureMs,
            int slotTwoCaptureMs,
            Boolean armed,
            Integer timerMs,
            Double velocityX,
            Double velocityY,
            Integer shotVisualMs) {
        public ObstaclePlacementDTO(String id, String type, double x, double y, int size, double rotation, int hp, int slotOneCaptureMs, int slotTwoCaptureMs, Boolean armed, Integer timerMs) {
            this(id, type, x, y, size, rotation, hp, slotOneCaptureMs, slotTwoCaptureMs, armed, timerMs, null, null, null);
        }
        public ObstaclePlacementDTO(String id, String type, double x, double y, int size, double rotation, int hp, int slotOneCaptureMs, int slotTwoCaptureMs) {
            this(id, type, x, y, size, rotation, hp, slotOneCaptureMs, slotTwoCaptureMs, null, null, null, null, null);
        }
        public ObstaclePlacementDTO(String id, String type, double x, double y, int size) {
            this(id, type, x, y, size, 0.0, 0, 0, 0, null, null, null, null, null);
        }

        public ObstaclePlacementDTO(String id, String type, double x, double y, int size, double rotation) {
            this(id, type, x, y, size, rotation, 0, 0, 0, null, null, null, null, null);
        }

        public ObstaclePlacementDTO(String id, String type, double x, double y, int size, double rotation, int hp) {
            this(id, type, x, y, size, rotation, hp, 0, 0, null, null, null, null, null);
        }
    }

    public record ReplayFrameDTO(
            int tick,
            int elapsedMs,
            List<FighterPlacementDTO> fighters,
            List<ObstaclePlacementDTO> obstacles) {
    }
}
