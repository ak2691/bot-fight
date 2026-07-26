package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.service.MatchService.MatchEntrant;
import com.example.botfight.DTO.ActiveMatchStatusDTO;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class MatchmakingServiceTest {

    private final MatchService matchService = mock(MatchService.class);
    private final Clock clock = Clock.fixed(
            Instant.parse("2026-07-24T12:00:00Z"),
            ZoneOffset.UTC);
    private MatchmakingService service;

    @BeforeEach
    void setUp() {
        service = new MatchmakingService(matchService, clock);
        when(matchService.activeMatchStatus(any()))
                .thenReturn(ActiveMatchStatusDTO.none());
        when(matchService.startMatch(any(), any())).thenReturn(List.of());
    }

    @Test
    void pairsPlayersInFirstInFirstOutOrder() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();

        var waiting = service.joinQueue(
                firstUserId,
                "first",
                "first@example.com",
                "socket-first");
        service.joinQueue(
                secondUserId,
                "second",
                "second@example.com",
                "socket-second");

        assertThat(waiting).singleElement().satisfies(event -> {
            assertThat(event.event().type()).isEqualTo("QUEUE_WAITING");
            assertThat(event.event().serverNow()).isEqualTo(clock.instant());
        });
        ArgumentCaptor<MatchEntrant> firstCaptor =
                ArgumentCaptor.forClass(MatchEntrant.class);
        ArgumentCaptor<MatchEntrant> secondCaptor =
                ArgumentCaptor.forClass(MatchEntrant.class);
        verify(matchService).startMatch(
                firstCaptor.capture(),
                secondCaptor.capture());
        assertThat(firstCaptor.getValue().userId()).isEqualTo(firstUserId);
        assertThat(secondCaptor.getValue().userId()).isEqualTo(secondUserId);
    }

    @Test
    void staleSocketDisconnectDoesNotRemoveReplacementQueueSocket() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(
                firstUserId,
                "first",
                "first@example.com",
                "socket-old");
        service.joinQueue(
                firstUserId,
                "first",
                "first@example.com",
                "socket-current");

        service.removeDisconnected("first@example.com", "socket-old");
        service.joinQueue(
                UUID.randomUUID(),
                "second",
                "second@example.com",
                "socket-second");

        verify(matchService).startMatch(any(), any());
    }

    @Test
    void leavingQueueRemovesThePlayerBeforePairing() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(
                firstUserId,
                "first",
                "first@example.com",
                "socket-first");

        service.leaveQueue(firstUserId);
        var waiting = service.joinQueue(
                UUID.randomUUID(),
                "second",
                "second@example.com",
                "socket-second");

        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void activeMatchCannotAlsoEnterTheQueue() {
        UUID userId = UUID.randomUUID();
        when(matchService.activeMatchStatus(userId)).thenReturn(
                new ActiveMatchStatusDTO(
                        true,
                        false,
                        UUID.randomUUID(),
                        null));

        assertThatThrownBy(() -> service.joinQueue(
                userId,
                "pilot",
                "pilot@example.com",
                "socket-one"))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("active match");

        verify(matchService, never()).startMatch(any(), any());
    }
}
