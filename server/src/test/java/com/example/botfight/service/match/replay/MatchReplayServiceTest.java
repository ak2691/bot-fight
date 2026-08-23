package com.example.botfight.service.match.replay;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class MatchReplayServiceTest {

    private final MatchReplayService service = new MatchReplayService(ReplayDeliveryMode.BATCHED);

    @Test
    void reconnectUsesAnOverlapBatchAndAuthorizedLookaheadInsteadOfTheEntireReplay() {
        MatchReplayDTO replay = replayThrough(40_000);
        Instant playbackStartsAt = Instant.parse("2026-08-15T12:00:00Z");

        MatchReplayDTO payload = service.authorizedReplayForReconnect(
                replay,
                playbackStartsAt,
                playbackStartsAt.plusMillis(33_400));

        assertThat(payload.frames())
                .extracting(MatchReplayDTO.ReplayFrameDTO::elapsedMs)
                .startsWith(32_100)
                .endsWith(35_000)
                .doesNotContain(32_000);
        assertThat(payload.initialState()).isSameAs(replay.initialState());
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

        assertThat(payload.frames())
                .extracting(MatchReplayDTO.ReplayFrameDTO::elapsedMs)
                .containsExactly(0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000);
        assertThat(payload.replayCursorElapsedMs()).isEqualTo(1_000);
    }

    private MatchReplayDTO replayThrough(int finalElapsedMs) {
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = java.util.stream.IntStream
                .rangeClosed(0, finalElapsedMs / 100)
                .mapToObj(index -> new MatchPlaybackDTO.ReplayFrameDTO(
                        index,
                        index * 100,
                        List.of(),
                        List.of()))
                .toList();
        return MatchReplayDTO.from(new MatchPlaybackDTO(
                null,
                "duel-v1",
                "COMPLETED",
                new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                frames,
                "DRAW",
                null,
                "draw"));
    }
}
