package com.example.botfight.service.match;


import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.DTO.match.MatchReplayDTO;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class MatchReplayServiceTest {

    private final MatchReplayService service = new MatchReplayService();

    @Test
    void reconnectUsesAnOverlapBatchAndAuthorizedLookaheadInsteadOfTheEntireReplay() {
        MatchReplayDTO replay = replayThrough(40_000);
        Instant playbackStartsAt = Instant.parse("2026-08-15T12:00:00Z");

        MatchReplayDTO payload = service.authorizedReplayForReconnect(
                replay,
                playbackStartsAt,
                playbackStartsAt.plusMillis(33_400));

        assertThat(elapsed(payload))
                .startsWith(32_100)
                .endsWith(35_000)
                .doesNotContain(32_000);
        assertThat(payload.workerReplay().initialState()).isSameAs(replay.workerReplay().initialState());
        assertThat(payload.replayCursorElapsedMs()).isEqualTo(35_000);
        assertThat(payload.terminalBatch()).isFalse();
    }

    @Test
    void reconnectBeforePlaybackKeepsTheInitialStateAndOnlyAuthorizedBufferedFrames() {
        MatchReplayDTO replay = replayThrough(5_000);
        Instant playbackStartsAt = Instant.parse("2026-08-15T12:00:00Z");

        MatchReplayDTO payload = service.authorizedReplayForReconnect(
                replay,
                playbackStartsAt,
                playbackStartsAt.minusMillis(1_000));

        assertThat(elapsed(payload))
                .containsExactly(0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000);
        assertThat(payload.replayCursorElapsedMs()).isEqualTo(1_000);
    }

    private MatchReplayDTO replayThrough(int finalElapsedMs) {
        var times = IntStream.rangeClosed(0,finalElapsedMs/100).map(i->i*100).boxed().toList();
        return replay("CONTINUES",null,null,"SEGMENT_END",List.of(),times);
    }
}
