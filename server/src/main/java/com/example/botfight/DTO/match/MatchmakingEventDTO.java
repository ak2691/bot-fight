package com.example.botfight.DTO.match;

import java.util.Map;

import com.example.botfight.service.simulation.WorkerReplay.EndBotState;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.JsonNode;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record MatchmakingEventDTO(
        MatchEventType type,
        UUID matchId,
        Long simulationSeed,
        String status,
        @JsonIgnore
        MatchmakingPlayerDTO player,
        @JsonIgnore
        MatchmakingPlayerDTO opponent,
        List<MatchmakingPlayerDTO> players,
        Instant serverNow,
        Instant loadoutSelectionEndsAt,
        Instant countdownEndsAt,
        Instant buildingEndsAt,
        Instant playbackStartsAt,
        Instant resultRevealsAt,
        String rulesetVersion,
        MatchReplayDTO playback,
        Integer roundNumber,
        String message,
        List<RoundBrainDTO> roundBrains,
        UUID disconnectedUserId,
        Instant disconnectEndsAt,
        Long simulationPreparingDurationMs,
        Instant roundReadyAt,
        Instant matchChatEndsAt,
        Instant matchAcceptanceEndsAt,
        Boolean acceptedByMe,
        Boolean otherPlayerAccepted,
        String mode,
        Boolean surrenderRequestedByMe,
        Integer surrenderVoteCount,
        Integer surrenderVoteRequired,
        UUID codeViewRequestId,
        UUID codeViewTargetUserId,
        String codeViewTargetUsername,
        JsonNode codeViewBrain,
        String codeViewSelectedLoadout,
        Instant queueStartedAt,
        UUID viewerUserId,
        TimedRoundsDTO timedRounds) {

    /** Version of the canonical participant payload consumed by WebSocket clients. */
    @JsonProperty("eventSchemaVersion")
    public int eventSchemaVersion() { return 2; }

    public static Builder builder() { return new Builder(); }

    public Builder toBuilder() {
        return new Builder()
                .type(type)
                .matchId(matchId)
                .simulationSeed(simulationSeed)
                .status(status)
                .player(player)
                .opponent(opponent)
                .players(players)
                .serverNow(serverNow)
                .loadoutSelectionEndsAt(loadoutSelectionEndsAt)
                .countdownEndsAt(countdownEndsAt)
                .buildingEndsAt(buildingEndsAt)
                .playbackStartsAt(playbackStartsAt)
                .resultRevealsAt(resultRevealsAt)
                .rulesetVersion(rulesetVersion)
                .playback(playback)
                .roundNumber(roundNumber)
                .message(message)
                .roundBrains(roundBrains)
                .disconnectedUserId(disconnectedUserId)
                .disconnectEndsAt(disconnectEndsAt)
                .simulationPreparingDurationMs(simulationPreparingDurationMs)
                .roundReadyAt(roundReadyAt)
                .matchChatEndsAt(matchChatEndsAt)
                .matchAcceptanceEndsAt(matchAcceptanceEndsAt)
                .acceptedByMe(acceptedByMe)
                .otherPlayerAccepted(otherPlayerAccepted)
                .mode(mode)
                .surrenderRequestedByMe(surrenderRequestedByMe)
                .surrenderVoteCount(surrenderVoteCount)
                .surrenderVoteRequired(surrenderVoteRequired)
                .codeViewRequestId(codeViewRequestId)
                .codeViewTargetUserId(codeViewTargetUserId)
                .codeViewTargetUsername(codeViewTargetUsername)
                .codeViewBrain(codeViewBrain)
                .codeViewSelectedLoadout(codeViewSelectedLoadout)
                .queueStartedAt(queueStartedAt)
                .viewerUserId(viewerUserId)
                .timedRounds(timedRounds);
    }

    public static final class Builder {
        private MatchEventType type;
        private UUID matchId;
        private Long simulationSeed;
        private String status;
        private MatchmakingPlayerDTO player;
        private MatchmakingPlayerDTO opponent;
        private List<MatchmakingPlayerDTO> players;
        private Instant serverNow;
        private Instant loadoutSelectionEndsAt;
        private Instant countdownEndsAt;
        private Instant buildingEndsAt;
        private Instant playbackStartsAt;
        private Instant resultRevealsAt;
        private String rulesetVersion;
        private MatchReplayDTO playback;
        private Integer roundNumber;
        private String message;
        private List<RoundBrainDTO> roundBrains;
        private UUID disconnectedUserId;
        private Instant disconnectEndsAt;
        private Long simulationPreparingDurationMs;
        private Instant roundReadyAt;
        private Instant matchChatEndsAt;
        private Instant matchAcceptanceEndsAt;
        private Boolean acceptedByMe;
        private Boolean otherPlayerAccepted;
        private String mode;
        private Boolean surrenderRequestedByMe;
        private Integer surrenderVoteCount;
        private Integer surrenderVoteRequired;
        private UUID codeViewRequestId;
        private UUID codeViewTargetUserId;
        private String codeViewTargetUsername;
        private JsonNode codeViewBrain;
        private String codeViewSelectedLoadout;
        private Instant queueStartedAt;
        private UUID viewerUserId;
        private TimedRoundsDTO timedRounds;

        public Builder type(MatchEventType value) { type = value; return this; }
        public Builder matchId(UUID value) { matchId = value; return this; }
        public Builder simulationSeed(Long value) { simulationSeed = value; return this; }
        public Builder status(String value) { status = value; return this; }
        public Builder player(MatchmakingPlayerDTO value) { player = value; return this; }
        public Builder opponent(MatchmakingPlayerDTO value) { opponent = value; return this; }
        public Builder players(List<MatchmakingPlayerDTO> value) { players = value; return this; }
        public Builder serverNow(Instant value) { serverNow = value; return this; }
        public Builder loadoutSelectionEndsAt(Instant value) { loadoutSelectionEndsAt = value; return this; }
        public Builder countdownEndsAt(Instant value) { countdownEndsAt = value; return this; }
        public Builder buildingEndsAt(Instant value) { buildingEndsAt = value; return this; }
        public Builder playbackStartsAt(Instant value) { playbackStartsAt = value; return this; }
        public Builder resultRevealsAt(Instant value) { resultRevealsAt = value; return this; }
        public Builder rulesetVersion(String value) { rulesetVersion = value; return this; }
        public Builder playback(MatchReplayDTO value) { playback = value; return this; }
        public Builder roundNumber(Integer value) { roundNumber = value; return this; }
        public Builder message(String value) { message = value; return this; }
        public Builder roundBrains(List<RoundBrainDTO> value) { roundBrains = value; return this; }
        public Builder disconnectedUserId(UUID value) { disconnectedUserId = value; return this; }
        public Builder disconnectEndsAt(Instant value) { disconnectEndsAt = value; return this; }
        public Builder simulationPreparingDurationMs(Long value) { simulationPreparingDurationMs = value; return this; }
        public Builder roundReadyAt(Instant value) { roundReadyAt = value; return this; }
        public Builder matchChatEndsAt(Instant value) { matchChatEndsAt = value; return this; }
        public Builder matchAcceptanceEndsAt(Instant value) { matchAcceptanceEndsAt = value; return this; }
        public Builder acceptedByMe(Boolean value) { acceptedByMe = value; return this; }
        public Builder otherPlayerAccepted(Boolean value) { otherPlayerAccepted = value; return this; }
        public Builder mode(String value) { mode = value; return this; }
        public Builder surrenderRequestedByMe(Boolean value) { surrenderRequestedByMe = value; return this; }
        public Builder surrenderVoteCount(Integer value) { surrenderVoteCount = value; return this; }
        public Builder surrenderVoteRequired(Integer value) { surrenderVoteRequired = value; return this; }
        public Builder codeViewRequestId(UUID value) { codeViewRequestId = value; return this; }
        public Builder codeViewTargetUserId(UUID value) { codeViewTargetUserId = value; return this; }
        public Builder codeViewTargetUsername(String value) { codeViewTargetUsername = value; return this; }
        public Builder codeViewBrain(JsonNode value) { codeViewBrain = value; return this; }
        public Builder codeViewSelectedLoadout(String value) { codeViewSelectedLoadout = value; return this; }
        public Builder queueStartedAt(Instant value) { queueStartedAt = value; return this; }
        public Builder viewerUserId(UUID value) { viewerUserId = value; return this; }
        public Builder timedRounds(TimedRoundsDTO value) { timedRounds = value; return this; }

        public MatchmakingEventDTO build() {
            return new MatchmakingEventDTO(
                    type,
                    matchId,
                    simulationSeed,
                    status,
                    player,
                    opponent,
                    players,
                    serverNow,
                    loadoutSelectionEndsAt,
                    countdownEndsAt,
                    buildingEndsAt,
                    playbackStartsAt,
                    resultRevealsAt,
                    rulesetVersion,
                    playback,
                    roundNumber,
                    message,
                    roundBrains,
                    disconnectedUserId,
                    disconnectEndsAt,
                    simulationPreparingDurationMs,
                    roundReadyAt,
                    matchChatEndsAt,
                    matchAcceptanceEndsAt,
                    acceptedByMe,
                    otherPlayerAccepted,
                    mode,
                    surrenderRequestedByMe,
                    surrenderVoteCount,
                    surrenderVoteRequired,
                    codeViewRequestId,
                    codeViewTargetUserId,
                    codeViewTargetUsername,
                    codeViewBrain,
                    codeViewSelectedLoadout,
                    queueStartedAt,
                    viewerUserId,
                    timedRounds);
        }
    }

    public record RoundBrainDTO(int roundNumber, JsonNode brain) {
    }

    /**
     * Timed-rounds additions, all optional so clients that predate the format ignore them. The clock
     * fields describe the match's chess clock; each player's own clock and deadline are on their
     * {@link MatchmakingPlayerDTO}. The zone only exists in the later rounds: {@code zoneStartsInRound}
     * is the round it appears, and {@code zoneNextDiameterUnits} the size the warning ring shows during
     * the round before each contraction (null in the other rounds).
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TimedRoundsDTO(
            Integer maxRounds,
            Integer baseClockSeconds,
            Integer incrementSeconds,
            Integer kitRevealSeconds,
            Integer segmentSeconds,
            Integer unlockedTier,
            Integer zoneStartsInRound,
            Double zoneNextDiameterUnits,
            List<EndBotState> segmentEndState,
            HpDecisionDTO hpDecision) {
    }

    /** The round 6 tiebreak: each team's total HP when the last segment ended. */
    public record HpDecisionDTO(Map<Integer, Double> teamHp, Integer winningTeam) {
    }
}
