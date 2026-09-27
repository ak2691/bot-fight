package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.chat.MatchChatService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.lifecycle.MatchLifecycleService;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.match.submission.MatchSubmissionService;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class MatchLifecycleServiceTest {

    @Test
    void reservesWholeRosterBeforePersistenceAndRejectsOverlappingStarts() throws Exception {
        MatchRuntimeState state = new MatchRuntimeState();
        MatchPersistenceService persistence = mock(MatchPersistenceService.class);
        CountDownLatch firstPersistenceEntered = new CountDownLatch(1);
        CountDownLatch releaseFirstPersistence = new CountDownLatch(1);
        AtomicInteger persistedMatches = new AtomicInteger();
        when(persistence.createMatch(any(MatchMode.class), anyBoolean())).thenAnswer(invocation -> {
            int call = persistedMatches.incrementAndGet();
            if (call == 1) {
                firstPersistenceEntered.countDown();
                if (!releaseFirstPersistence.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("timed out waiting to release match persistence");
                }
            }
            return matchWithSeed(call);
        });
        MatchLifecycleService lifecycle = lifecycle(state, persistence);

        UUID firstPlayer = UUID.randomUUID();
        UUID sharedPlayer = UUID.randomUUID();
        UUID unrelatedFirst = UUID.randomUUID();
        UUID unrelatedSecond = UUID.randomUUID();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> firstStart = executor.submit(() -> lifecycle.startMatch(
                    entrant(firstPlayer, "first", "first@example.com", "first-socket"),
                    entrant(sharedPlayer, "shared", "shared@example.com", "shared-socket")));
            assertThat(firstPersistenceEntered.await(2, TimeUnit.SECONDS)).isTrue();

            assertThatThrownBy(() -> lifecycle.startMatch(
                    entrant(sharedPlayer, "shared", "shared@example.com", "shared-custom-socket"),
                    entrant(UUID.randomUUID(), "overlap", "overlap@example.com", "overlap-socket")))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("already in a match or starting a match");
            assertThat(state.isMatchStartReserved(unrelatedFirst)).isFalse();
            assertThat(state.activeSessionForUser(firstPlayer)).isNull();

            lifecycle.startMatch(
                    entrant(unrelatedFirst, "unrelated-one", "unrelated-one@example.com", "unrelated-one-socket"),
                    entrant(unrelatedSecond, "unrelated-two", "unrelated-two@example.com", "unrelated-two-socket"));
            assertThat(persistedMatches).hasValue(2);

            releaseFirstPersistence.countDown();
            firstStart.get(2, TimeUnit.SECONDS);
        } finally {
            releaseFirstPersistence.countDown();
            executor.shutdownNow();
        }

        assertThat(state.activeSessionForUser(firstPlayer))
                .isSameAs(state.activeSessionForUser(sharedPlayer));
        assertThat(state.activeSessionForUser(unrelatedFirst))
                .isSameAs(state.activeSessionForUser(unrelatedSecond));
        assertThat(state.activeSessionForUser(firstPlayer))
                .isNotSameAs(state.activeSessionForUser(unrelatedFirst));
        assertThat(state.isMatchStartReserved(firstPlayer)).isFalse();
        assertThat(state.isMatchStartReserved(sharedPlayer)).isFalse();
        verify(persistence, times(2)).createMatch(any(MatchMode.class), anyBoolean());
    }

    @Test
    void persistenceFailureReleasesEveryRosterReservationForRetry() {
        MatchRuntimeState state = new MatchRuntimeState();
        MatchPersistenceService persistence = mock(MatchPersistenceService.class);
        AtomicInteger persistedMatches = new AtomicInteger();
        when(persistence.createMatch(any(MatchMode.class), anyBoolean()))
                .thenAnswer(invocation -> matchWithSeed(persistedMatches.incrementAndGet()));
        AtomicBoolean failFirstParticipantsWrite = new AtomicBoolean(true);
        doAnswer(invocation -> {
            if (failFirstParticipantsWrite.getAndSet(false)) {
                throw new IllegalStateException("simulated participant persistence failure");
            }
            return null;
        }).when(persistence).createParticipants(any(Match.class), any(MatchSession.class));
        MatchLifecycleService lifecycle = lifecycle(state, persistence);
        UUID firstPlayer = UUID.randomUUID();
        UUID secondPlayer = UUID.randomUUID();
        List<MatchEntrant> roster = List.of(
                entrant(firstPlayer, "first", "first@example.com", "first-socket"),
                entrant(secondPlayer, "second", "second@example.com", "second-socket"));

        assertThatThrownBy(() -> lifecycle.startMatch(roster.get(0), roster.get(1)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("simulated participant persistence failure");
        assertThat(state.isMatchStartReserved(firstPlayer)).isFalse();
        assertThat(state.isMatchStartReserved(secondPlayer)).isFalse();
        assertThat(state.activeSessionForUser(firstPlayer)).isNull();
        assertThat(state.activeSessionForUser(secondPlayer)).isNull();

        lifecycle.startMatch(roster.get(0), roster.get(1));

        assertThat(state.activeSessionForUser(firstPlayer))
                .isSameAs(state.activeSessionForUser(secondPlayer));
        assertThat(state.isMatchStartReserved(firstPlayer)).isFalse();
        assertThat(state.isMatchStartReserved(secondPlayer)).isFalse();
        verify(persistence, times(2)).createParticipants(any(Match.class), any(MatchSession.class));
    }

    @Test
    void socketRegistrationFailureDoesNotPublishSessionAndClearsAttemptedSockets() {
        MatchRuntimeState state = new MatchRuntimeState();
        MatchPersistenceService persistence = mock(MatchPersistenceService.class);
        when(persistence.createMatch(any(MatchMode.class), anyBoolean())).thenReturn(matchWithSeed(1));
        MatchConnectionService connections = mock(MatchConnectionService.class);
        MatchEventFactory eventFactory = mock(MatchEventFactory.class);
        MatchLifecycleService lifecycle = lifecycle(state, persistence, connections, eventFactory);
        UUID firstPlayer = UUID.randomUUID();
        UUID secondPlayer = UUID.randomUUID();
        doThrow(new IllegalStateException("simulated socket registration failure"))
                .when(connections).registerSocket(secondPlayer, "second-socket");

        assertThatThrownBy(() -> lifecycle.startMatch(
                entrant(firstPlayer, "first", "first@example.com", "first-socket"),
                entrant(secondPlayer, "second", "second@example.com", "second-socket")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("simulated socket registration failure");

        assertNoPublishedStart(state, firstPlayer, secondPlayer);
        verify(connections).clear(firstPlayer);
        verify(connections).clear(secondPlayer);
    }

    @Test
    void eventFactoryFailureDoesNotPublishSessionOrRegisterSockets() {
        MatchRuntimeState state = new MatchRuntimeState();
        MatchPersistenceService persistence = mock(MatchPersistenceService.class);
        when(persistence.createMatch(any(MatchMode.class), anyBoolean())).thenReturn(matchWithSeed(1));
        MatchConnectionService connections = mock(MatchConnectionService.class);
        MatchEventFactory eventFactory = mock(MatchEventFactory.class);
        doAnswer(invocation -> {
            throw new IllegalStateException("simulated start-event failure");
        }).when(eventFactory).forPlayer(
                any(MatchSession.class),
                any(MatchPlayer.class),
                eq("MATCH_STARTED"),
                eq("LOADOUT_SELECT"),
                isNull(),
                eq("Match accepted. Choose your opening loadout."));
        MatchLifecycleService lifecycle = lifecycle(state, persistence, connections, eventFactory);
        UUID firstPlayer = UUID.randomUUID();
        UUID secondPlayer = UUID.randomUUID();

        assertThatThrownBy(() -> lifecycle.startMatch(
                entrant(firstPlayer, "first", "first@example.com", "first-socket"),
                entrant(secondPlayer, "second", "second@example.com", "second-socket")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("simulated start-event failure");

        assertNoPublishedStart(state, firstPlayer, secondPlayer);
        verifyNoInteractions(connections);
    }

    private MatchLifecycleService lifecycle(
            MatchRuntimeState state,
            MatchPersistenceService persistence) {
        return lifecycle(
                state,
                persistence,
                mock(MatchConnectionService.class),
                mock(MatchEventFactory.class));
    }

    private MatchLifecycleService lifecycle(
            MatchRuntimeState state,
            MatchPersistenceService persistence,
            MatchConnectionService connections,
            MatchEventFactory eventFactory) {
        return new MatchLifecycleService(
                state,
                persistence,
                connections,
                eventFactory,
                mock(MatchSubmissionService.class),
                mock(MatchChatService.class),
                Clock.systemUTC());
    }

    private void assertNoPublishedStart(MatchRuntimeState state, UUID firstPlayer, UUID secondPlayer) {
        assertThat(state.activeSessionForUser(firstPlayer)).isNull();
        assertThat(state.activeSessionForUser(secondPlayer)).isNull();
        assertThat(state.isMatchStartReserved(firstPlayer)).isFalse();
        assertThat(state.isMatchStartReserved(secondPlayer)).isFalse();
    }

    private static MatchEntrant entrant(
            UUID userId,
            String username,
            String principalName,
            String socketSessionId) {
        return new MatchEntrant(userId, username, principalName, socketSessionId);
    }

    private static Match matchWithSeed(int seed) {
        Match match = new Match();
        match.setId(UUID.randomUUID());
        match.setSimulationSeed((long) seed);
        return match;
    }
}
