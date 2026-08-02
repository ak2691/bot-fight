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
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class MatchmakingServiceTest {

    private final MatchService matchService = mock(MatchService.class);
    private final MutableClock clock = new MutableClock(
            Instant.parse("2026-07-24T12:00:00Z"),
            ZoneOffset.UTC);
    private MatchmakingService service;

    @BeforeEach
    void setUp() {
        service = new MatchmakingService(
                matchService,
                clock,
                new MatchmakingRateLimiter(clock));
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
        var found = service.joinQueue(
                secondUserId,
                "second",
                "second@example.com",
                "socket-second");

        assertThat(waiting).singleElement().satisfies(event -> {
            assertThat(event.event().type()).isEqualTo("QUEUE_WAITING");
            assertThat(event.event().serverNow()).isEqualTo(clock.instant());
        });
        assertThat(found).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_FOUND");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
            assertThat(event.event().matchAcceptanceEndsAt())
                    .isEqualTo(clock.instant().plusSeconds(22));
            assertThat(event.event().simulationSeed()).isNull();
        });
        verify(matchService, never()).startMatch(any(), any());

        UUID pendingMatchId = found.getFirst().event().matchId();
        var firstAccepted = service.acceptMatch(pendingMatchId, firstUserId, "socket-first");
        assertThat(firstAccepted).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_ACCEPTED");
            assertThat(event.event().acceptedUserId()).isEqualTo(firstUserId);
        });

        ArgumentCaptor<MatchEntrant> firstCaptor =
                ArgumentCaptor.forClass(MatchEntrant.class);
        ArgumentCaptor<MatchEntrant> secondCaptor =
                ArgumentCaptor.forClass(MatchEntrant.class);
        service.acceptMatch(pendingMatchId, secondUserId, "socket-second");
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
        var found = service.joinQueue(
                UUID.randomUUID(),
                "second",
                "second@example.com",
                "socket-second");

        assertThat(found).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT"));
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void disconnectRemovesAQueuedPlayerBeforeAnotherPlayerCanPair() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");

        service.removeDisconnected("first@example.com", "socket-first");
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
    void provisionalMatchSurvivesSocketReplacementBeforeAcceptance() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "second", "second@example.com", "socket-second");

        service.removeDisconnected("first@example.com", "socket-first");
        var resumed = service.resumePendingMatch(firstUserId, "socket-replacement");

        assertThat(resumed).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_FOUND");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
            assertThat(event.event().matchId()).isEqualTo(found.getFirst().event().matchId());
        });
        assertThat(resumed).filteredOn(event -> event.principalName().equals("first@example.com"))
                .singleElement()
                .satisfies(event -> assertThat(event.event().player().userId()).isEqualTo(firstUserId));
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void acceptsDuringTheTwoSecondHiddenGraceAfterTheVisibleWindow() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "second", "second@example.com", "socket-second");

        service.acceptMatch(found.getFirst().event().matchId(), firstUserId, "socket-first");
        clock.advance(Duration.ofSeconds(21));
        service.acceptMatch(found.getFirst().event().matchId(), secondUserId, "socket-second");

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

    @Test
    void repeatedQueueAttemptsAreRateLimitedPerUser() {
        UUID userId = UUID.randomUUID();

        service.joinQueue(userId, "pilot", "pilot@example.com", "socket-one");
        service.joinQueue(userId, "pilot", "pilot@example.com", "socket-two");
        service.joinQueue(userId, "pilot", "pilot@example.com", "socket-three");

        assertThatThrownBy(() -> service.joinQueue(
                userId,
                "pilot",
                "pilot@example.com",
                "socket-four"))
                .isInstanceOf(RateLimitExceededException.class)
                .hasMessageContaining("matchmaking attempts");
    }

    private static final class MutableClock extends Clock {
        private Instant instant;
        private final ZoneId zone;

        private MutableClock(Instant instant, ZoneId zone) {
            this.instant = instant;
            this.zone = zone;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return new MutableClock(instant, zone);
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
