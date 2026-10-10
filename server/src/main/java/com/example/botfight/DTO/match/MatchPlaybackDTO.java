package com.example.botfight.DTO.match;

import java.util.UUID;

/** Result notification and entity-placement contracts; no simulation frames are mapped in Java. */
public record MatchPlaybackDTO(UUID matchId, String rulesetVersion, String status,
                               String result, UUID winnerUserId, String message) {
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

}
