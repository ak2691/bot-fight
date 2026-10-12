package com.example.botfight.service;

import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.service.matchmaking.MatchParticipationCoordinator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.matchmaking.QueuePool;
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
        service = new MatchmakingService(matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 5, Duration.ofSeconds(3)),
                eloRatingService,
                new MatchParticipationCoordinator(),
                org.mockito.Mockito.mock(com.example.botfight.service.match.MatchScheduler.class));
        when(matchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
    }

    @Test
    void guestQueueUsesFifoWithoutReadingOrIndexingEloRatings() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        service.joinQueue(com.example.botfight.support.TestKits.queue(
                first,
                "guest-one",
                "guest-one@example.invalid",
                "guest-one-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.GUEST));
        var found = service.joinQueue(com.example.botfight.support.TestKits.queue(
                second,
                "guest-two",
                "guest-two@example.invalid",
                "guest-two-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.GUEST));

        assertThat(found).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo(MatchEventType.MATCH_FOUND));
        verify(eloRatingService, never()).ratingsFor(any(), any());
    }

    @Test
    void guestTwoVTwoUsesTheFirstFourGuestsWithoutRatingMatching() {
        List<UUID> guests = List.of(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID());

        for (int index = 0; index < guests.size() - 1; index++) {
            UUID guest = guests.get(index);
            String username = "guest-" + index;
            String principal = username + "@example.invalid";
            service.joinQueue(com.example.botfight.support.TestKits.queue(
                    guest,
                    username,
                    principal,
                    username + "-socket",
                    MatchMode.TWOS,
                    null,
                    null,
                    QueuePool.GUEST));
        }

        UUID fourth = guests.getLast();
        var found = service.joinQueue(com.example.botfight.support.TestKits.queue(
                fourth,
                "guest-3",
                "guest-3@example.invalid",
                "guest-3-socket",
                MatchMode.TWOS,
                null,
                null,
                QueuePool.GUEST));

        assertThat(found).hasSize(4)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo(MatchEventType.MATCH_FOUND));
        verify(eloRatingService, never()).ratingsFor(any(), any());
    }

    @Test
    void expandsTheOneVOneRangeAfterPlayersWaitAndSweepRechecksThem() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        when(eloRatingService.ratingsFor(eq(List.of(first)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(first, 1000));
        when(eloRatingService.ratingsFor(eq(List.of(second)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(second, 1150));

        service.joinQueue(com.example.botfight.support.TestKits.queue(
                first,
                "first",
                "first@example.com",
                "first-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        var waiting = service.joinQueue(com.example.botfight.support.TestKits.queue(
                second,
                "second",
                "second@example.com",
                "second-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type().name())
                .isEqualTo("QUEUE_WAITING");

        clock.advance(Duration.ofSeconds(29));
        assertThat(service.sweepQueues()).isEmpty();

        clock.advance(Duration.ofSeconds(1));
        var found = service.sweepQueues();

        assertThat(found).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo(MatchEventType.MATCH_FOUND));
    }

    @Test
    void oldestOneVOnePlayerIsPrioritizedOverACloserNewerPair() {
        UUID oldest = UUID.randomUUID();
        UUID middle = UUID.randomUUID();
        UUID newest = UUID.randomUUID();
        when(eloRatingService.ratingsFor(eq(List.of(oldest)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(oldest, 1000));
        when(eloRatingService.ratingsFor(eq(List.of(middle)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(middle, 1100));
        when(eloRatingService.ratingsFor(eq(List.of(newest)), eq(MatchMode.ONES)))
                .thenReturn(Map.of(newest, 1160));

        service.joinQueue(com.example.botfight.support.TestKits.queue(
                oldest,
                "oldest",
                "oldest@example.com",
                "oldest-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        service.joinQueue(com.example.botfight.support.TestKits.queue(
                middle,
                "middle",
                "middle@example.com",
                "middle-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        service.joinQueue(com.example.botfight.support.TestKits.queue(
                newest,
                "newest",
                "newest@example.com",
                "newest-socket",
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));

        clock.advance(Duration.ofSeconds(15));
        var found = service.sweepQueues();

        assertThat(found).hasSize(2)
                .extracting(event -> event.principalName())
                .containsExactlyInAnyOrder("oldest@example.com", "middle@example.com");
    }

    @Test
    void twoVTwoSweepRechecksTheQueueAfterTheRatingRangeExpands() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        UUID fourth = UUID.randomUUID();
        when(eloRatingService.ratingsFor(eq(List.of(first)), eq(MatchMode.TWOS)))
                .thenReturn(Map.of(first, 1000));
        when(eloRatingService.ratingsFor(eq(List.of(second)), eq(MatchMode.TWOS)))
                .thenReturn(Map.of(second, 1000));
        when(eloRatingService.ratingsFor(eq(List.of(third)), eq(MatchMode.TWOS)))
                .thenReturn(Map.of(third, 1000));
        when(eloRatingService.ratingsFor(eq(List.of(fourth)), eq(MatchMode.TWOS)))
                .thenReturn(Map.of(fourth, 1200));

        service.joinQueue(com.example.botfight.support.TestKits.queue(
                first,
                "first",
                "first@example.com",
                "first-socket",
                MatchMode.TWOS,
                null,
                null,
                QueuePool.REGISTERED));
        service.joinQueue(com.example.botfight.support.TestKits.queue(
                second,
                "second",
                "second@example.com",
                "second-socket",
                MatchMode.TWOS,
                null,
                null,
                QueuePool.REGISTERED));
        service.joinQueue(com.example.botfight.support.TestKits.queue(
                third,
                "third",
                "third@example.com",
                "third-socket",
                MatchMode.TWOS,
                null,
                null,
                QueuePool.REGISTERED));
        var waiting = service.joinQueue(com.example.botfight.support.TestKits.queue(
                fourth,
                "fourth",
                "fourth@example.com",
                "fourth-socket",
                MatchMode.TWOS,
                null,
                null,
                QueuePool.REGISTERED));

        assertThat(waiting).hasSize(1)
                .extracting(event -> event.event().type().name())
                .containsExactly("QUEUE_WAITING");
        clock.advance(Duration.ofSeconds(14));
        assertThat(service.sweepQueues()).isEmpty();

        clock.advance(Duration.ofSeconds(1));
        assertThat(service.sweepQueues()).hasSize(4)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo(MatchEventType.MATCH_FOUND));
    }

    @Test
    void rejectsATwosPartyWhoseMembersExceedTheThreeHundredPointSpread() {
        UUID owner = UUID.randomUUID();
        UUID teammate = UUID.randomUUID();
        List<UUID> userIds = List.of(owner, teammate);
        when(eloRatingService.ratingsFor(eq(userIds), eq(MatchMode.TWOS)))
                .thenReturn(Map.of(owner, 1000, teammate, 1301));

        List<MatchEntrant> party = List.of(
                com.example.botfight.support.TestKits.entrant(owner, "owner", "owner@example.com", "owner-socket"),
                com.example.botfight.support.TestKits.entrant(teammate, "teammate", "teammate@example.com", "teammate-socket"));

        assertThatThrownBy(() -> service.joinQueue(com.example.botfight.support.TestKits.queue(
                owner,
                "owner",
                "owner@example.com",
                "owner-socket",
                MatchMode.TWOS,
                party,
                UUID.randomUUID(),
                QueuePool.REGISTERED)))
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
