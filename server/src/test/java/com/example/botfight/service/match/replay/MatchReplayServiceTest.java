package com.example.botfight.service.match.replay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.connection.MatchReconnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.replay.MatchReplayService;
import com.example.botfight.service.match.replay.ReplayDeliveryMode;
import com.example.botfight.service.match.state.MatchRuntimeState;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

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

    @Test
    void reconnectAfterShortReplayKeepsTheFinalFrameAndInitialState() {
        MatchReplayDTO replay = replayThrough(500);
        Instant start = Instant.parse("2026-08-15T12:00:00Z");

        MatchReplayDTO payload = service.authorizedReplayForReconnect(
                replay, start, start.plusMillis(1_500));

        assertThat(payload.frames()).hasSize(6);
        assertThat(payload.frames().getLast().elapsedMs()).isEqualTo(500);
        assertThat(payload.initialState()).isSameAs(replay.initialState());
        assertThat(payload.terminalBatch()).isTrue();
    }

    @Test
    void reconnectWithEmptyFramesStillCarriesInitialState() {
        MatchReplayDTO replay = new MatchReplayDTO(
                new MatchReplayDTO.ReplayInitialStateDTO(List.of()), List.of(),
                "DRAW", null, "draw", null, null, null);
        Instant start = Instant.parse("2026-08-15T12:00:00Z");

        MatchReplayDTO payload = service.authorizedReplayForReconnect(
                replay, start, start.plusMillis(1_500));

        assertThat(payload.frames()).isEmpty();
        assertThat(payload.initialState()).isSameAs(replay.initialState());
        assertThat(payload.terminalBatch()).isTrue();
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

    @Nested
    class ReconnectWindow {
        @Test
        void reconnectDuringBetweenRoundHoldDoesNotSendWholeReplayInOneMessage() {
            Instant start = Instant.parse("2026-06-03T12:00:00Z");
            UUID matchId = UUID.randomUUID();
            UUID u1 = UUID.randomUUID();
            UUID u2 = UUID.randomUUID();
            MatchPlayer p1 = new MatchPlayer(u1, "one", "one@x", 1, false, null, 0, "melee", true);
            MatchPlayer p2 = new MatchPlayer(u2, "two", "two@x", 2, false, null, 0, "melee", true);

            List<MatchReplayDTO.ReplayFrameDTO> frames = new ArrayList<>();
            for (int ms = 0; ms <= 60_000; ms += 100) {
                frames.add(new MatchReplayDTO.ReplayFrameDTO(ms, List.of(), List.of()));
            }
            MatchReplayDTO replay = new MatchReplayDTO(
                    null, frames, "BOT_WIN", u2, "win", 0, 0, false);

            Instant playbackStartsAt = start.plusSeconds(3);
            Instant resultRevealsAt = playbackStartsAt.plusMillis(60_000);
            Instant roundReadyAt = resultRevealsAt.plusSeconds(10);
            MatchSession session = new MatchSession(
                    matchId, 1L, List.of(p1, p2), null, null, null, null, 1, 2,
                    List.of(), Map.of(), playbackStartsAt, replay, resultRevealsAt,
                    roundReadyAt, false);

            MatchRuntimeState state = new MatchRuntimeState();
            state.putSession(session);

            // Reconnect 2s into the hold: after resultRevealsAt, before roundReadyAt.
            Clock clock = Clock.fixed(resultRevealsAt.plusSeconds(2), ZoneOffset.UTC);
            MatchConnectionService connection = mock(MatchConnectionService.class);
            when(connection.reconnect(any(), anyString())).thenReturn(null);
            MatchEventFactory factory = mock(MatchEventFactory.class);
            when(factory.forCompactReplay(any(), any(), anyString(), anyString(), any(),
                    any(), anyLong(), any(), any(), any()))
                    .thenReturn(mock(OutboundMatchmakingEvent.class));

            MatchReconnectionService service = new MatchReconnectionService(
                    state, clock, connection, mock(MatchPersistenceService.class), factory,
                    new MatchReplayService(ReplayDeliveryMode.BATCHED), s -> { });

            service.resumeMatch(u1, "one", "one@x", "socket-2");

            ArgumentCaptor<MatchReplayDTO> sent = ArgumentCaptor.forClass(MatchReplayDTO.class);
            verify(factory, times(2)).forCompactReplay(any(), any(), anyString(), anyString(),
                    sent.capture(), any(), anyLong(), any(), any(), any());
            // Batched delivery caps each message at roughly one REPLAY_BATCH_MILLIS window.
            assertThat(sent.getAllValues().getFirst().frames().size())
                    .as("reconnect message must be a bounded batch, not all %d frames", frames.size())
                    .isLessThan(frames.size());
            assertThat(sent.getAllValues().get(1).frames()).isEmpty();
        }
    }
}
