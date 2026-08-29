package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MatchmakingRatingTest {

    private final MatchService matchService = mock(MatchService.class);
    private final EloRatingService eloRatingService = mock(EloRatingService.class);
    private final MutableClock clock = new MutableClock(
            Instant.parse("2026-08-28T12:00:00Z"),
            ZoneOffset.UTC);
    private MatchmakingService service;

    @BeforeEach
    void setUp() {
        service = new MatchmakingService(
                matchService,
                clock,
                new SlidingWindowRateLimiter<>(clock, 5, Duration.ofSeconds(5)),
                eloRatingService);
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
    }

    @Test
    void expandsTheOneVOneRangeAfterPlayersWait() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        when(eloRatingService.ratingsFor(eq(List.of(first)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(first, 1000));
        when(eloRatingService.ratingsFor(eq(List.of(second)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(second, 1150));

        service.joinQueue(first, "first", "first@example.com", "first-socket", MatchMode.ONES);
        var waiting = service.joinQueue(
                second,
                "second",
                "second@example.com",
                "second-socket",
                MatchMode.ONES);
        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");

        service.leaveQueue(second);
        clock.advance(Duration.ofSeconds(20));
        var found = service.joinQueue(
                second,
                "second",
                "second@example.com",
                "second-socket-replacement",
                MatchMode.ONES);

        assertThat(found).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
    }

    @Test
    void rejectsATwosPartyWhoseMembersExceedTheThreeHundredPointSpread() {
        UUID owner = UUID.randomUUID();
        UUID teammate = UUID.randomUUID();
        List<UUID> userIds = List.of(owner, teammate);
        when(eloRatingService.ratingsFor(eq(userIds), eq(MatchMode.TWOS)))
                .thenReturn(Map.of(owner, 1000, teammate, 1301));

        List<MatchEntrant> party = List.of(
                new MatchEntrant(owner, "owner", "owner@example.com", "owner-socket"),
                new MatchEntrant(teammate, "teammate", "teammate@example.com", "teammate-socket"));

        assertThatThrownBy(() -> service.joinQueue(
                owner,
                "owner",
                "owner@example.com",
                "owner-socket",
                MatchMode.TWOS,
                party,
                UUID.randomUUID()))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("300 Elo");
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
