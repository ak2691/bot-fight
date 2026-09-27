package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingPlayerDTO;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.lifecycle.MatchLifecycleService;
import com.example.botfight.service.match.loadout.MatchAbilityGuaranteeService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.submission.MatchSubmissionService;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.matchmaking.QueuePool;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

class MatchmakingServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final MatchService matchService = mock(MatchService.class);
    private final MutableClock clock = new MutableClock(
            Instant.parse("2026-07-24T12:00:00Z"),
            ZoneOffset.UTC);
    private MatchAbilityGuaranteeService guaranteeService;
    private MatchmakingService service;

    @BeforeEach
    void setUp() {
        guaranteeService = new MatchAbilityGuaranteeService();
        service = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)),
                null,
                guaranteeService);
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
                "alpha-secret",
                "first@example.com",
                "socket-first");
        var found = service.joinQueue(
                secondUserId,
                "bravo-secret",
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
        assertIdentityFreeAcceptanceEvents(found, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        verify(matchService, never()).startMatch(any(), any());

        UUID pendingMatchId = found.getFirst().event().matchId();
        var firstAccepted = service.acceptMatch(pendingMatchId, firstUserId, "socket-first-tab-two");
        assertThat(firstAccepted).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_ACCEPTED");
        });
        assertIdentityFreeAcceptanceEvents(firstAccepted, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        assertThat(firstAccepted.stream()
                .filter(event -> event.principalName().equals("first@example.com"))
                .toList()).singleElement().extracting(OutboundMatchmakingEvent::event)
                .satisfies(event -> {
                    assertThat(event.acceptedByMe()).isTrue();
                    assertThat(event.otherPlayerAccepted()).isFalse();
                });
        assertThat(firstAccepted.stream()
                .filter(event -> event.principalName().equals("second@example.com"))
                .toList()).singleElement().extracting(OutboundMatchmakingEvent::event)
                .satisfies(event -> {
                    assertThat(event.acceptedByMe()).isFalse();
                    assertThat(event.otherPlayerAccepted()).isTrue();
                });

        ArgumentCaptor<MatchEntrant> firstCaptor =
                ArgumentCaptor.forClass(MatchEntrant.class);
        ArgumentCaptor<MatchEntrant> secondCaptor =
                ArgumentCaptor.forClass(MatchEntrant.class);
        MatchmakingEventDTO started = startedEvent(firstUserId, secondUserId);
        when(matchService.startMatch(any(), any())).thenReturn(List.of(
                new OutboundMatchmakingEvent("first@example.com", started)));
        var startedEvents = service.acceptMatch(pendingMatchId, secondUserId, "socket-second-tab-two");
        verify(matchService).startMatch(
                firstCaptor.capture(),
                secondCaptor.capture());
        assertThat(firstCaptor.getValue().userId()).isEqualTo(firstUserId);
        assertThat(secondCaptor.getValue().userId()).isEqualTo(secondUserId);
        assertThat(startedEvents).singleElement().satisfies(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_STARTED");
            assertThat(event.event().eventSchemaVersion()).isEqualTo(2);
            assertThat(event.event().viewerUserId()).isEqualTo(firstUserId);
            assertThat(event.event().players()).filteredOn(player -> !player.userId().equals(firstUserId))
                    .singleElement().extracting(MatchmakingPlayerDTO::username).isEqualTo("bravo-secret");
        });
        String startedJson = jsonMapper.writeValueAsString(started);
        assertThat(startedJson).contains("bravo-secret", secondUserId.toString());
    }

    @Test
    void matchEventV2SerializesOneCanonicalRosterAndReducesFourPlayerPayloadSize() throws Exception {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        MatchmakingEventDTO twoPlayerEvent = startedEvent(firstUserId, secondUserId);
        List<MatchmakingPlayerDTO> roster = List.of(
                new MatchmakingPlayerDTO(firstUserId, "alpha-one", 1, 1, false, 0, "melee", true, true),
                new MatchmakingPlayerDTO(secondUserId, "alpha-two", 2, 1, false, 0, "ranged", true, true),
                new MatchmakingPlayerDTO(UUID.randomUUID(), "bravo-one", 3, 2, false, 0, "melee", true, true),
                new MatchmakingPlayerDTO(UUID.randomUUID(), "bravo-two", 4, 2, false, 0, "ranged", true, true));
        MatchmakingEventDTO event = twoPlayerEvent
                .withReplayParticipants(roster.getFirst(), roster.get(2), roster)
                .withViewerUserId(firstUserId);

        String serialized = jsonMapper.writeValueAsString(event);
        assertThat(event.eventSchemaVersion()).isEqualTo(2);
        assertThat(event.viewerUserId()).isEqualTo(firstUserId);
        assertThat(serialized)
                .contains("\"eventSchemaVersion\":2", "\"viewerUserId\":\"" + firstUserId + "\"")
                .doesNotContain("\"player\":", "\"opponent\":");

        Map<String, Object> legacyPayload = new LinkedHashMap<>(jsonMapper.readValue(serialized, Map.class));
        legacyPayload.remove("eventSchemaVersion");
        legacyPayload.remove("viewerUserId");
        legacyPayload.put("player", roster.getFirst());
        legacyPayload.put("opponent", roster.get(2));
        int legacyBytes = jsonMapper.writeValueAsBytes(legacyPayload).length;
        int canonicalBytes = jsonMapper.writeValueAsBytes(event).length;
        System.out.printf("AUD-13 four-player event payload: %d -> %d bytes%n", legacyBytes, canonicalBytes);
        assertThat(canonicalBytes).isLessThan(legacyBytes);
    }

    @Test
    void blockedMatchPersistenceDoesNotHoldTheQueueMonitor() throws Exception {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID unrelatedUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "second", "second@example.com", "socket-second");
        service.acceptMatch(found.getFirst().event().matchId(), firstUserId, "socket-first");
        service.joinQueue(unrelatedUserId, "waiting", "waiting@example.com", "socket-waiting");

        CountDownLatch startEntered = new CountDownLatch(1);
        CountDownLatch releaseStart = new CountDownLatch(1);
        when(matchService.startMatch(any(), any())).thenAnswer(invocation -> {
            startEntered.countDown();
            if (!releaseStart.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("timed out waiting to release match persistence");
            }
            return List.of();
        });

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<List<OutboundMatchmakingEvent>> blockedAcceptance = executor.submit(() ->
                    service.acceptMatch(
                            found.getFirst().event().matchId(), secondUserId, "socket-second"));
            assertThat(startEntered.await(2, TimeUnit.SECONDS)).isTrue();

            Future<?> unrelatedLeave = executor.submit(() -> service.leaveQueue(unrelatedUserId));
            unrelatedLeave.get(1, TimeUnit.SECONDS);
            assertThat(service.hasTransientActivity(unrelatedUserId)).isFalse();

            releaseStart.countDown();
            assertThat(blockedAcceptance.get(2, TimeUnit.SECONDS)).isEmpty();
        } finally {
            releaseStart.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void blockedRatingReadDoesNotHoldTheQueueMonitor() throws Exception {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        CountDownLatch firstRatingReadEntered = new CountDownLatch(1);
        CountDownLatch releaseFirstRatingRead = new CountDownLatch(1);
        AtomicInteger ratingReadCount = new AtomicInteger();
        EloRatingService ratingService = mock(EloRatingService.class);
        when(ratingService.ratingsFor(any(), eq(MatchMode.ONES))).thenAnswer(invocation -> {
            List<UUID> userIds = invocation.getArgument(0);
            if (ratingReadCount.incrementAndGet() == 1) {
                firstRatingReadEntered.countDown();
                if (!releaseFirstRatingRead.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("timed out waiting to release the first rating read");
                }
            }
            return userIds.stream().collect(java.util.stream.Collectors.toMap(
                    userId -> userId,
                    ignored -> EloRatingService.DEFAULT_RATING));
        });
        service = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)),
                ratingService);

        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<List<OutboundMatchmakingEvent>> firstJoin = executor.submit(() ->
                    service.joinQueue(firstUserId, "first", "first@example.com", "socket-first"));
            assertThat(firstRatingReadEntered.await(2, TimeUnit.SECONDS)).isTrue();

            var secondJoin = service.joinQueue(
                    secondUserId, "second", "second@example.com", "socket-second");
            assertThat(secondJoin).singleElement()
                    .extracting(event -> event.event().type())
                    .isEqualTo("QUEUE_WAITING");

            releaseFirstRatingRead.countDown();
            assertThat(firstJoin.get(2, TimeUnit.SECONDS)).hasSize(2)
                    .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
        } finally {
            releaseFirstRatingRead.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void finalQueueAcceptanceAndCustomStartCannotPersistOverlappingMatches() throws Exception {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        MatchRuntimeState runtimeState = new MatchRuntimeState();
        MatchPersistenceService persistence = mock(MatchPersistenceService.class);
        CountDownLatch persistenceEntered = new CountDownLatch(1);
        CountDownLatch releasePersistence = new CountDownLatch(1);
        AtomicInteger persistedMatches = new AtomicInteger();
        when(persistence.createMatch(any(MatchMode.class), anyBoolean())).thenAnswer(invocation -> {
            int call = persistedMatches.incrementAndGet();
            Match match = new Match();
            match.setId(UUID.randomUUID());
            match.setSimulationSeed((long) call);
            if (call == 1) {
                persistenceEntered.countDown();
                if (!releasePersistence.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("timed out waiting to release queue match persistence");
                }
            }
            return match;
        });
        MatchLifecycleService lifecycle = new MatchLifecycleService(
                runtimeState,
                persistence,
                mock(MatchConnectionService.class),
                mock(MatchEventFactory.class),
                mock(MatchSubmissionService.class),
                mock(MatchChatService.class),
                clock);
        when(matchService.isMatchStartReserved(any(UUID.class))).thenAnswer(invocation ->
                runtimeState.isMatchStartReserved(invocation.getArgument(0)));
        when(matchService.startMatch(any(), any())).thenAnswer(invocation -> lifecycle.startMatch(
                invocation.getArgument(0), invocation.getArgument(1)));

        MatchmakingService queue = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)));
        queue.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        var found = queue.joinQueue(secondUserId, "second", "second@example.com", "socket-second");
        UUID pendingMatchId = found.getFirst().event().matchId();
        queue.acceptMatch(pendingMatchId, firstUserId, "socket-first");

        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<List<OutboundMatchmakingEvent>> queueStart = executor.submit(() ->
                    queue.acceptMatch(pendingMatchId, secondUserId, "socket-second"));
            assertThat(persistenceEntered.await(2, TimeUnit.SECONDS)).isTrue();

            List<MatchEntrant> customRoster = List.of(
                    new MatchEntrant(firstUserId, "first", "first@example.com", null, 1),
                    new MatchEntrant(secondUserId, "second", "second@example.com", null, 2));
            assertThatThrownBy(() -> lifecycle.startTeamMatch(customRoster, MatchMode.CUSTOM, false))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("already in a match or starting a match");
            assertThatThrownBy(() -> queue.cancelConflictingQueueState(List.of(firstUserId, secondUserId)))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("already starting");
            assertThat(persistedMatches).hasValue(1);

            releasePersistence.countDown();
            assertThat(queueStart.get(2, TimeUnit.SECONDS)).hasSize(2);
        } finally {
            releasePersistence.countDown();
            executor.shutdownNow();
        }

        assertThat(persistedMatches).hasValue(1);
        assertThat(runtimeState.activeSessionForUser(firstUserId))
                .isSameAs(runtimeState.activeSessionForUser(secondUserId));
        assertThat(runtimeState.isMatchStartReserved(firstUserId)).isFalse();
        assertThat(runtimeState.isMatchStartReserved(secondUserId)).isFalse();
        assertThat(queue.hasTransientActivity(firstUserId)).isFalse();
    }

    @Test
    void externalStartPreparationRejectsQueuedUsersAndFencesNewJoinsUntilReleased() {
        UUID userId = UUID.randomUUID();
        var waiting = service.joinQueue(
                userId, "queued", "queued@example.com", "queued-socket");
        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");

        assertThatThrownBy(() -> service.prepareExternalMatchStart(List.of(userId)))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("Leave ranked matchmaking");
        assertThat(service.hasTransientActivity(userId)).isTrue();

        service.leaveQueue(userId);
        MatchmakingService.ExternalMatchStartPreparation preparation =
                service.prepareExternalMatchStart(List.of(userId));

        assertThat(preparation.reservationId()).isNotNull();
        assertThat(preparation.cancellationEvents()).isEmpty();
        assertThat(service.hasTransientActivity(userId)).isFalse();
        assertThatThrownBy(() -> service.joinQueue(
                userId, "queued", "queued@example.com", "queued-socket"))
                .isInstanceOf(AuthException.class)
                .hasMessageContaining("already starting another match");

        service.releaseExternalMatchStart(preparation.reservationId());
        assertThat(service.joinQueue(
                userId, "queued", "queued@example.com", "queued-socket"))
                .singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");
    }

    @Test
    void boundedTwosSearchFindsAFeasibleClusterAfterManyIncompatibleParties() {
        Map<UUID, Integer> ratingsByUserId = new HashMap<>();
        EloRatingService ratingService = mock(EloRatingService.class);
        when(ratingService.ratingsFor(any(), eq(MatchMode.TWOS))).thenAnswer(invocation -> {
            List<UUID> userIds = invocation.getArgument(0);
            return userIds.stream().collect(java.util.stream.Collectors.toMap(
                    userId -> userId,
                    userId -> ratingsByUserId.get(userId)));
        });
        service = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)),
                ratingService);

        for (int index = 0; index < 36; index++) {
            UUID ownerId = new UUID(1, index * 2L + 1);
            UUID teammateId = new UUID(1, index * 2L + 2);
            ratingsByUserId.put(ownerId, index * 1000);
            ratingsByUserId.put(teammateId, index * 1000);
            var waiting = service.joinQueue(
                    ownerId,
                    "owner-" + index,
                    "owner-" + index + "@example.com",
                    "owner-socket-" + index,
                    MatchMode.TWOS,
                    List.of(
                            entrant(ownerId, "owner-" + index, "owner-" + index + "@example.com", "owner-socket-" + index),
                            entrant(teammateId, "teammate-" + index, "teammate-" + index + "@example.com", "teammate-socket-" + index)),
                    UUID.randomUUID());
            assertThat(waiting).hasSize(2).allSatisfy(event ->
                    assertThat(event.event().type()).isEqualTo("QUEUE_WAITING"));
        }

        UUID highOwnerOne = new UUID(2, 1);
        UUID highTeammateOne = new UUID(2, 2);
        UUID highOwnerTwo = new UUID(2, 3);
        UUID highTeammateTwo = new UUID(2, 4);
        for (UUID userId : List.of(highOwnerOne, highTeammateOne, highOwnerTwo, highTeammateTwo)) {
            ratingsByUserId.put(userId, 100_000);
        }
        service.joinQueue(
                highOwnerOne,
                "high-owner-one",
                "high-owner-one@example.com",
                "high-owner-one-socket",
                MatchMode.TWOS,
                List.of(
                        entrant(highOwnerOne, "high-owner-one", "high-owner-one@example.com", "high-owner-one-socket"),
                        entrant(highTeammateOne, "high-teammate-one", "high-teammate-one@example.com", "high-teammate-one-socket")),
                UUID.randomUUID());
        var found = service.joinQueue(
                highOwnerTwo,
                "high-owner-two",
                "high-owner-two@example.com",
                "high-owner-two-socket",
                MatchMode.TWOS,
                List.of(
                        entrant(highOwnerTwo, "high-owner-two", "high-owner-two@example.com", "high-owner-two-socket"),
                        entrant(highTeammateTwo, "high-teammate-two", "high-teammate-two@example.com", "high-teammate-two-socket")),
                UUID.randomUUID());

        assertThat(found).hasSize(4).allSatisfy(event ->
                assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
        assertThat(found).extracting(OutboundMatchmakingEvent::principalName)
                .containsExactlyInAnyOrder(
                        "high-owner-one@example.com",
                        "high-teammate-one@example.com",
                        "high-owner-two@example.com",
                        "high-teammate-two@example.com");
    }

    @Test
    void twosSelectionTieBreaksDeterministicallyFromStableUserIds() {
        assertThat(runEqualRatingTwosSelection()).isEqualTo(runEqualRatingTwosSelection());
    }

    @Test
    void keepsGuestAndRegisteredPlayersInSeparatePools() {
        UUID guestOne = UUID.randomUUID();
        UUID registered = UUID.randomUUID();
        UUID guestTwo = UUID.randomUUID();

        var guestWaiting = service.joinQueue(
                guestOne,
                "Guest-ONE",
                "guest-one@example.invalid",
                "guest-socket-one",
                MatchMode.ONES,
                List.of(new MatchEntrant(
                        guestOne, "Guest-ONE", "guest-one@example.invalid", "guest-socket-one")),
                null,
                List.of(),
                QueuePool.GUEST);
        var registeredWaiting = service.joinQueue(
                registered,
                "registered",
                "registered@example.com",
                "registered-socket",
                MatchMode.ONES,
                List.of(new MatchEntrant(
                        registered, "registered", "registered@example.com", "registered-socket")),
                null,
                List.of(),
                QueuePool.REGISTERED);

        assertThat(guestWaiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");
        assertThat(registeredWaiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");

        when(matchService.startMatch(any(), any(), eq(MatchMode.ONES), eq(false)))
                .thenReturn(List.of());
        var guestMatchFound = service.joinQueue(
                guestTwo,
                "Guest-TWO",
                "guest-two@example.invalid",
                "guest-socket-two",
                MatchMode.ONES,
                List.of(new MatchEntrant(
                        guestTwo, "Guest-TWO", "guest-two@example.invalid", "guest-socket-two")),
                null,
                List.of(),
                QueuePool.GUEST);

        assertThat(guestMatchFound).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
        UUID pendingMatchId = guestMatchFound.getFirst().event().matchId();
        service.acceptMatch(pendingMatchId, guestOne, "guest-socket-one");
        service.acceptMatch(pendingMatchId, guestTwo, "guest-socket-two");

        verify(matchService).startMatch(any(), any(), eq(MatchMode.ONES), eq(false));
        verify(matchService, never()).startMatch(any(), any(), eq(MatchMode.ONES), eq(true));
    }

    @Test
    void carriesQueueGuaranteesIntoTheAcceptedMatch() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        var waiting = service.joinQueue(
                firstUserId,
                "first",
                "first@example.com",
                "socket-first",
                MatchMode.ONES,
                List.of(new MatchEntrant(
                        firstUserId, "untrusted-name", "untrusted@example.com", "stale-socket")),
                null,
                Arrays.asList(1, null, 21));
        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");

        var found = service.joinQueue(
                secondUserId,
                "second",
                "second@example.com",
                "socket-second");
        UUID pendingMatchId = found.getFirst().event().matchId();
        service.acceptMatch(pendingMatchId, firstUserId, "socket-first");
        service.acceptMatch(pendingMatchId, secondUserId, "socket-second");

        ArgumentCaptor<MatchEntrant> firstCaptor = ArgumentCaptor.forClass(MatchEntrant.class);
        ArgumentCaptor<MatchEntrant> secondCaptor = ArgumentCaptor.forClass(MatchEntrant.class);
        verify(matchService).startMatch(firstCaptor.capture(), secondCaptor.capture());

        assertThat(firstCaptor.getValue().guaranteedAbilities())
                .containsEntry(1, 1)
                .containsEntry(3, 21)
                .doesNotContainKey(2);
        assertThat(secondCaptor.getValue().guaranteedAbilities()).isEmpty();
    }

    @Test
    void explicitEmptyQueueSlotsClearTheSavedGuarantees() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        guaranteeService.setForUser(firstUserId, Arrays.asList(1, null, 21));

        service.joinQueue(
                firstUserId,
                "first",
                "first@example.com",
                "socket-first",
                MatchMode.ONES,
                List.of(new MatchEntrant(
                        firstUserId, "first", "first@example.com", "socket-first")),
                null,
                Arrays.asList(null, null, null));
        var found = service.joinQueue(
                secondUserId,
                "second",
                "second@example.com",
                "socket-second");
        UUID pendingMatchId = found.getFirst().event().matchId();
        service.acceptMatch(pendingMatchId, firstUserId, "socket-first");
        service.acceptMatch(pendingMatchId, secondUserId, "socket-second");

        ArgumentCaptor<MatchEntrant> firstCaptor = ArgumentCaptor.forClass(MatchEntrant.class);
        verify(matchService).startMatch(firstCaptor.capture(), any());

        assertThat(firstCaptor.getValue().guaranteedAbilities()).isEmpty();
    }

    @Test
    void acceptanceStatusIsRecipientRelativeWhenTheOtherPlayerAcceptsFirst() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "alpha-secret", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "bravo-secret", "second@example.com", "socket-second");

        var accepted = service.acceptMatch(
                found.getFirst().event().matchId(), secondUserId, "socket-second");

        assertIdentityFreeAcceptanceEvents(accepted, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        assertThat(accepted.stream()
                .filter(event -> event.principalName().equals("first@example.com"))
                .toList()).singleElement().extracting(OutboundMatchmakingEvent::event)
                .satisfies(event -> {
                    assertThat(event.acceptedByMe()).isFalse();
                    assertThat(event.otherPlayerAccepted()).isTrue();
                });
        assertThat(accepted.stream()
                .filter(event -> event.principalName().equals("second@example.com"))
                .toList()).singleElement().extracting(OutboundMatchmakingEvent::event)
                .satisfies(event -> {
                    assertThat(event.acceptedByMe()).isTrue();
                    assertThat(event.otherPlayerAccepted()).isFalse();
                });
    }

    @Test
    void finalDisconnectFromAnotherTabRemovesTheUserQueueEntry() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(
                firstUserId,
                "alpha-secret",
                "first@example.com",
                "socket-queue-tab");

        assertThat(service.markDisconnected("first@example.com", "socket-final-tab")).isTrue();
        var found = service.joinQueue(
                UUID.randomUUID(),
                "bravo-secret",
                "second@example.com",
                "socket-second");

        assertThat(found).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void disconnectKeepsAQueuedPlayerOutOfMatchingDuringTheReconnectGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");

        assertThat(service.markDisconnected("first@example.com", "socket-first")).isTrue();
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
    void requiresBothPlayersCurrentRatingRangesToIncludeTheMatch() {
        UUID olderUserId = UUID.randomUUID();
        UUID newerUserId = UUID.randomUUID();
        EloRatingService ratingService = mock(EloRatingService.class);
        when(ratingService.ratingsFor(any(), eq(MatchMode.ONES)))
                .thenReturn(Map.of(olderUserId, 1100, newerUserId, 1290));
        service = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)),
                ratingService);

        service.joinQueue(olderUserId, "older", "older@example.com", "older-socket");
        clock.advance(Duration.ofSeconds(45));
        var waiting = service.joinQueue(
                newerUserId, "newer", "newer@example.com", "newer-socket");

        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");
        clock.advance(Duration.ofSeconds(44));
        assertThat(service.sweepQueues()).isEmpty();
        clock.advance(Duration.ofSeconds(1));

        assertThat(service.sweepQueues()).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
    }

    @Test
    void ratingRangeExpandsToFourHundred() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        EloRatingService ratingService = mock(EloRatingService.class);
        when(ratingService.ratingsFor(any(), eq(MatchMode.ONES)))
                .thenReturn(Map.of(firstUserId, 1100, secondUserId, 1490));
        service = new MatchmakingService(
                matchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)),
                ratingService);

        service.joinQueue(firstUserId, "first", "first@example.com", "first-socket");
        var waiting = service.joinQueue(
                secondUserId, "second", "second@example.com", "second-socket");

        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");
        clock.advance(Duration.ofSeconds(105));

        assertThat(service.sweepQueues()).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
    }

    @Test
    void reconnectRebindsTheExistingQueueEntryWithoutResettingItsPosition() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        Instant queuedAt = clock.instant();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        service.markDisconnected("first@example.com", "socket-first");
        service.joinQueue(secondUserId, "second", "second@example.com", "socket-second");

        clock.advance(Duration.ofSeconds(9));
        var resumed = service.resumeQueuedPlayer(firstUserId, "socket-replacement");

        assertThat(resumed).singleElement()
                .satisfies(event -> {
                    assertThat(event.event().type()).isEqualTo("QUEUE_WAITING");
                    assertThat(event.event().queueStartedAt()).isEqualTo(queuedAt);
                });
        var found = service.sweepQueues();
        assertThat(found).hasSize(2)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void partyIsIneligibleUntilEveryMemberReconnects() {
        UUID partyOwnerId = UUID.randomUUID();
        UUID teammateId = UUID.randomUUID();
        UUID firstSoloId = UUID.randomUUID();
        UUID secondSoloId = UUID.randomUUID();

        service.joinQueue(
                partyOwnerId,
                "party-owner",
                "party-owner@example.com",
                "party-owner-socket",
                MatchMode.TWOS,
                List.of(
                        entrant(partyOwnerId, "party-owner", "party-owner@example.com", "party-owner-socket"),
                        entrant(teammateId, "teammate", "teammate@example.com", "teammate-socket")),
                UUID.randomUUID());
        service.markDisconnected("teammate@example.com", "teammate-socket");
        service.joinQueue(firstSoloId, "solo-one", "solo-one@example.com", "solo-one-socket", MatchMode.TWOS);
        var waiting = service.joinQueue(
                secondSoloId,
                "solo-two",
                "solo-two@example.com",
                "solo-two-socket",
                MatchMode.TWOS);

        assertThat(waiting).singleElement()
                .extracting(event -> event.event().type())
                .isEqualTo("QUEUE_WAITING");

        service.resumeQueuedPlayer(teammateId, "teammate-replacement-socket");
        var found = service.sweepQueues();

        assertThat(found).hasSize(4)
                .allSatisfy(event -> assertThat(event.event().type()).isEqualTo("MATCH_FOUND"));
    }

    @Test
    void expiredDisconnectedQueueEntryIsRemovedAfterTheGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        service.markDisconnected("first@example.com", "socket-first");

        clock.advance(Duration.ofSeconds(10));
        var expired = service.sweepQueues();

        assertThat(expired).singleElement().satisfies(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_ERROR");
            assertThat(event.event().message()).contains("10 seconds");
        });
        assertThat(service.resumeQueuedPlayer(firstUserId, "socket-too-late")).isEmpty();
    }

    @Test
    void reconnectDoesNotConsumeTheNormalQueueJoinRateLimit() {
        UUID firstUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "first", "first@example.com", "socket-first");
        service.markDisconnected("first@example.com", "socket-first");

        for (int attempt = 0; attempt < 5; attempt++) {
            assertThat(service.resumeQueuedPlayer(firstUserId, "socket-replacement-" + attempt))
                    .singleElement()
                    .extracting(event -> event.event().type())
                    .isEqualTo("QUEUE_WAITING");
        }
    }

    @Test
    void provisionalMatchSurvivesSocketReplacementBeforeAcceptance() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "alpha-secret", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "bravo-secret", "second@example.com", "socket-second");

        service.markDisconnected("first@example.com", "socket-first");
        var resumed = service.resumePendingMatch(firstUserId, "socket-replacement");

        assertThat(resumed).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_FOUND");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
            assertThat(event.event().matchId()).isEqualTo(found.getFirst().event().matchId());
        });
        assertIdentityFreeAcceptanceEvents(resumed, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void acceptsDuringTheTwoSecondHiddenGraceAfterTheVisibleWindow() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "alpha-secret", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "bravo-secret", "second@example.com", "socket-second");

        service.acceptMatch(found.getFirst().event().matchId(), firstUserId, "socket-first");
        clock.advance(Duration.ofSeconds(21));
        service.acceptMatch(found.getFirst().event().matchId(), secondUserId, "socket-second");

        verify(matchService).startMatch(any(), any());
    }

    @Test
    void expiresAnUnacceptedMatchAfterTheAcceptanceWindowAndGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "alpha-secret", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "bravo-secret", "second@example.com", "socket-second");
        UUID pendingMatchId = found.getFirst().event().matchId();
        Instant expectedDeadline = found.getFirst().event().matchAcceptanceEndsAt();

        clock.advance(Duration.ofSeconds(22));
        var expired = service.resolvePendingMatchTimeout(pendingMatchId, expectedDeadline);

        assertThat(expired).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_ACCEPTANCE_EXPIRED");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
        });
        assertIdentityFreeAcceptanceEvents(expired, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        assertThat(service.resolvePendingMatchTimeout(pendingMatchId, expectedDeadline)).isEmpty();
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void aLateAcceptanceRequestReturnsExpiredEventsAndCannotStartTheMatch() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "alpha-secret", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "bravo-secret", "second@example.com", "socket-second");
        UUID pendingMatchId = found.getFirst().event().matchId();

        clock.advance(Duration.ofSeconds(22));
        var expired = service.acceptMatch(pendingMatchId, firstUserId, "socket-first");

        assertThat(expired).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_ACCEPTANCE_EXPIRED");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
        });
        assertIdentityFreeAcceptanceEvents(expired, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        verify(matchService, never()).startMatch(any(), any());
    }

    @Test
    void cancellationNotifiesBothPlayersWithoutParticipantData() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "alpha-secret", "first@example.com", "socket-first");
        var found = service.joinQueue(secondUserId, "bravo-secret", "second@example.com", "socket-second");

        var cancelled = service.cancelPendingMatch(
                found.getFirst().event().matchId(), firstUserId, "socket-first-tab-two");

        assertThat(cancelled).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_ACCEPTANCE_CANCELLED");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
        });
        assertIdentityFreeAcceptanceEvents(cancelled, "alpha-secret", firstUserId, "bravo-secret", secondUserId);
        assertThat(service.resumePendingMatch(firstUserId, "socket-first")).isEmpty();
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
                .hasMessage(RateLimitExceededException.GENERIC_MESSAGE);

        clock.advance(Duration.ofSeconds(3));
        service.joinQueue(userId, "pilot", "pilot@example.com", "socket-four");
    }

    @Test
    void aPartyCanBeMatchedWithTwoSoloPlayersInTheSameTwosPool() {
        UUID partyOwnerId = UUID.randomUUID();
        UUID teammateId = UUID.randomUUID();
        UUID firstSoloId = UUID.randomUUID();
        UUID secondSoloId = UUID.randomUUID();
        UUID partyId = UUID.randomUUID();
        List<MatchEntrant> party = List.of(
                entrant(partyOwnerId, "party-owner", "party-owner@example.com", "party-owner-socket"),
                entrant(teammateId, "teammate", "teammate@example.com", null));

        var partyWaiting = service.joinQueue(
                partyOwnerId,
                "party-owner",
                "party-owner@example.com",
                "party-owner-socket",
                MatchMode.TWOS,
                party,
                partyId);
        service.joinQueue(
                firstSoloId,
                "solo-one",
                "solo-one@example.com",
                "solo-one-socket",
                MatchMode.TWOS);
        var found = service.joinQueue(
                secondSoloId,
                "solo-two",
                "solo-two@example.com",
                "solo-two-socket",
                MatchMode.TWOS);

        assertThat(partyWaiting).hasSize(2).allSatisfy(event ->
                assertThat(event.event().type()).isEqualTo("QUEUE_WAITING"));
        assertThat(found).hasSize(4).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_FOUND");
            assertThat(event.event().status()).isEqualTo("MATCH_ACCEPT");
        });

        UUID matchId = found.getFirst().event().matchId();
        service.acceptMatch(matchId, partyOwnerId, "party-owner-socket");
        service.acceptMatch(matchId, teammateId, "teammate-replacement-socket");
        service.acceptMatch(matchId, firstSoloId, "solo-one-socket");
        service.acceptMatch(matchId, secondSoloId, "solo-two-socket");

        ArgumentCaptor<List> entrantsCaptor = ArgumentCaptor.forClass(List.class);
        verify(matchService).startTeamMatch(entrantsCaptor.capture(), eq(MatchMode.TWOS));
        List<?> startedEntrants = entrantsCaptor.getValue();
        assertThat(startedEntrants).hasSize(4);
        assertThat(startedEntrants).extracting(entry -> ((MatchEntrant) entry).teamNumber())
                .containsExactlyInAnyOrder(1, 1, 2, 2);
        assertThat(startedEntrants.stream()
                .map(entry -> (MatchEntrant) entry)
                .filter(entry -> entry.userId().equals(partyOwnerId)
                        || entry.userId().equals(teammateId))
                .map(MatchEntrant::teamNumber)
                .distinct())
                .containsExactly(1);
    }

    @Test
    void fourSoloPlayersReceiveOneAcceptanceEventEachForTwos() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID thirdUserId = UUID.randomUUID();
        UUID fourthUserId = UUID.randomUUID();
        service.joinQueue(firstUserId, "one", "one@example.com", "socket-one", MatchMode.TWOS);
        service.joinQueue(secondUserId, "two", "two@example.com", "socket-two", MatchMode.TWOS);
        service.joinQueue(thirdUserId, "three", "three@example.com", "socket-three", MatchMode.TWOS);
        var found = service.joinQueue(
                fourthUserId,
                "four",
                "four@example.com",
                "socket-four",
                MatchMode.TWOS);

        assertThat(found).hasSize(4).extracting(event -> event.event().type())
                .containsOnly("MATCH_FOUND");
        UUID matchId = found.getFirst().event().matchId();
        service.acceptMatch(matchId, firstUserId, "socket-one");
        service.acceptMatch(matchId, secondUserId, "socket-two");
        service.acceptMatch(matchId, thirdUserId, "socket-three");
        service.acceptMatch(matchId, fourthUserId, "socket-four");

        verify(matchService).startTeamMatch(any(), eq(MatchMode.TWOS));
    }

    private List<String> runEqualRatingTwosSelection() {
        MatchService isolatedMatchService = mock(MatchService.class);
        when(isolatedMatchService.activeMatchStatus(any())).thenReturn(ActiveMatchStatusDTO.none());
        when(isolatedMatchService.isMatchStartReserved(any(UUID.class))).thenReturn(false);
        when(isolatedMatchService.startTeamMatch(any(), eq(MatchMode.TWOS))).thenReturn(List.of());
        MatchmakingService isolatedQueue = new MatchmakingService(
                isolatedMatchService,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)));

        List<UUID> userIds = List.of(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                UUID.fromString("00000000-0000-0000-0000-000000000004"));
        List<String> sockets = List.of("socket-1", "socket-2", "socket-3", "socket-4");
        List<OutboundMatchmakingEvent> found = List.of();
        for (int index = 0; index < userIds.size(); index++) {
            found = isolatedQueue.joinQueue(
                    userIds.get(index),
                    "player-" + index,
                    "player-" + index + "@example.com",
                    sockets.get(index),
                    MatchMode.TWOS);
        }
        UUID pendingMatchId = found.getFirst().event().matchId();
        for (int index = 0; index < userIds.size(); index++) {
            isolatedQueue.acceptMatch(pendingMatchId, userIds.get(index), sockets.get(index));
        }

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<MatchEntrant>> entrantsCaptor =
                (ArgumentCaptor<List<MatchEntrant>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(List.class);
        verify(isolatedMatchService, times(1)).startTeamMatch(
                entrantsCaptor.capture(), eq(MatchMode.TWOS));
        return entrantsCaptor.getValue().stream()
                .map(entrant -> entrant.userId() + ":" + entrant.teamNumber())
                .sorted()
                .toList();
    }

    private static MatchEntrant entrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        return new MatchEntrant(userId, username, principalName, socketSessionId);
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

    private void assertIdentityFreeAcceptanceEvents(
            List<OutboundMatchmakingEvent> events,
            String firstUsername,
            UUID firstUserId,
            String secondUsername,
            UUID secondUserId) {
        assertThat(events).allSatisfy(outbound -> {
            MatchmakingEventDTO event = outbound.event();
            assertThat(event.eventSchemaVersion()).isEqualTo(2);
            assertThat(event.viewerUserId()).isIn(firstUserId, secondUserId);
            assertThat(event.players()).isEmpty();
            assertThat(event.acceptedByMe()).isNotNull();
            assertThat(event.otherPlayerAccepted()).isNotNull();
            String serialized = jsonMapper.writeValueAsString(event);
            assertThat(serialized).doesNotContain("acceptedUserId");
            assertThat(serialized).doesNotContain(firstUsername, secondUsername);
            UUID otherUserId = event.viewerUserId().equals(firstUserId) ? secondUserId : firstUserId;
            assertThat(serialized).contains(event.viewerUserId().toString());
            assertThat(serialized).doesNotContain(otherUserId.toString());
        });
    }

    private MatchmakingEventDTO startedEvent(UUID firstUserId, UUID secondUserId) {
        return new MatchmakingEventDTO(
                "MATCH_STARTED",
                UUID.randomUUID(),
                null,
                "LOADOUT_SELECT",
                new MatchmakingPlayerDTO(firstUserId, "alpha-secret", 1, false, 0, "melee", false),
                new MatchmakingPlayerDTO(secondUserId, "bravo-secret", 2, false, 0, "melee", false),
                List.of(
                        new MatchmakingPlayerDTO(firstUserId, "alpha-secret", 1, false, 0, "melee", false),
                        new MatchmakingPlayerDTO(secondUserId, "bravo-secret", 2, false, 0, "melee", false)),
                clock.instant(),
                null,
                null,
                null,
                null,
                null,
                null,
                "duel-v1",
                null,
                1,
                2,
                "Match accepted.",
                null,
                List.of(),
                List.of(),
                List.of(),
                null,
                List.of(),
                100);
    }
}
