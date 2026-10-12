package com.example.botfight.DTO.match;

import static org.assertj.core.api.Assertions.assertThat;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchmakingEventDTOJsonTest {
    private final JsonMapper mapper = JsonMapper.builder().findAndAddModules().build();

    @Test
    void roundReadySnapshot() {
        MatchmakingEventDTO event = MatchmakingEventDTO.builder()
                        .type(MatchEventType.MATCH_ROUND_READY)
                        .matchId(UUID.fromString("00000000-0000-0000-0000-000000000001"))
                        .status("PREP")
                        .serverNow(Instant.parse("2026-10-09T12:00:00Z"))
                        .countdownEndsAt(Instant.parse("2026-10-09T12:00:00Z"))
                        .roundNumber(2).build();
        assertThat(mapper.readTree(mapper.writeValueAsString(event))).isEqualTo(mapper.readTree("""
                {"type":"MATCH_ROUND_READY","matchId":"00000000-0000-0000-0000-000000000001","status":"PREP","serverNow":"2026-10-09T12:00:00Z","countdownEndsAt":"2026-10-09T12:00:00Z","roundNumber":2,"eventSchemaVersion":2}
                """));
    }

    @Test
    void replayBatchSnapshot() {
        MatchmakingEventDTO event = MatchmakingEventDTO.builder()
                        .type(MatchEventType.MATCH_REPLAY_BATCH)
                        .matchId(UUID.fromString("00000000-0000-0000-0000-000000000001"))
                        .status("READY_FOR_PLAYBACK")
                        .serverNow(Instant.parse("2026-10-09T12:00:00Z"))
                        .playback(new MatchReplayDTO(null, null, null, 1, 1000, false, null))
                        .roundNumber(2).build();
        assertThat(mapper.readTree(mapper.writeValueAsString(event))).isEqualTo(mapper.readTree("""
                {"type":"MATCH_REPLAY_BATCH","matchId":"00000000-0000-0000-0000-000000000001","status":"READY_FOR_PLAYBACK","serverNow":"2026-10-09T12:00:00Z","playback":{"batchSequence":1,"replayCursorElapsedMs":1000,"frames":[]},"roundNumber":2,"eventSchemaVersion":2}
                """));
    }

    @Test
    void resultSnapshot() {
        MatchmakingEventDTO event = MatchmakingEventDTO.builder()
                        .type(MatchEventType.MATCH_RESULT_READY)
                        .matchId(UUID.fromString("00000000-0000-0000-0000-000000000001"))
                        .status("RESULT_READY")
                        .serverNow(Instant.parse("2026-10-09T12:00:00Z"))
                        .playback(new MatchReplayDTO("DRAW", null, "Equal HP", null, null, true, null))
                        .roundNumber(2).build();
        assertThat(mapper.readTree(mapper.writeValueAsString(event))).isEqualTo(mapper.readTree("""
                {"type":"MATCH_RESULT_READY","matchId":"00000000-0000-0000-0000-000000000001","status":"RESULT_READY","serverNow":"2026-10-09T12:00:00Z","playback":{"result":"DRAW","message":"Equal HP","terminalBatch":true,"frames":[]},"roundNumber":2,"eventSchemaVersion":2}
                """));
    }
}
