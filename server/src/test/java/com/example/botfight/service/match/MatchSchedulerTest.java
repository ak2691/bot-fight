package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.example.botfight.DTO.match.MatchChatEventDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.service.match.model.MatchChatClosure;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchPhase;
import com.example.botfight.service.matchmaking.MatchmakingService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class MatchSchedulerTest {
    private final MutableClock clock = new MutableClock();
    private final TaskScheduler tasks = mock(TaskScheduler.class);
    private final AsyncTaskExecutor executor = mock(AsyncTaskExecutor.class);
    private final MatchService matches = mock(MatchService.class);
    private final MatchmakingService matchmaking = mock(MatchmakingService.class);
    private final MatchEventPublisher publisher = mock(MatchEventPublisher.class);
    private final UUID id = UUID.randomUUID();
    private final List<Scheduled> scheduled = new ArrayList<>();
    private final List<Runnable> simulations = new ArrayList<>();
    private final MatchScheduler scheduler = new MatchScheduler(tasks, executor, matches, matchmaking, publisher, clock);
    private MatchSession active;

    @BeforeEach void setUp() {
        active = session(MatchPhase.KIT_REVEAL, 1, clock.instant().plusSeconds(32));
        when(matches.sessionForScheduling(id)).thenAnswer(ignored -> active);
        when(matches.isSchedulingDeadlineCurrent(eq(id), any(), anyInt(), any())).thenReturn(true);
        when(matches.completeSimulation(id)).thenReturn(List.of());
        when(matches.cancelFailedSimulation(id, 1)).thenReturn(List.of());
        when(tasks.schedule(any(Runnable.class), any(Instant.class))).thenAnswer(invocation -> {
            ScheduledFuture<?> future = mock(ScheduledFuture.class);
            scheduled.add(new Scheduled(invocation.getArgument(0), invocation.getArgument(1), future));
            return future;
        });
        doAnswer(invocation -> { simulations.add(invocation.getArgument(0)); return null; }).when(executor).execute(any(Runnable.class));
    }

    private MatchSession session(MatchPhase phase, int round, Instant deadline) {
        return new MatchSession(id, 42, List.of(), deadline, null, null, round, null, null, null, null,
                false, MatchMode.ONES, 300, 30, Set.of(), List.of(), phase);
    }
    private void fire(int index) { Scheduled task = scheduled.get(index); clock.now = task.deadline(); task.task().run(); }
    private void loading() { active = session(MatchPhase.SIMULATION_LOADING, 1, null); }

    @Test void schedulesQueueAndDeadlineSweeps() {
        scheduler.startSweeps();
        ArgumentCaptor<Runnable> callbacks = ArgumentCaptor.forClass(Runnable.class);
        verify(tasks).scheduleWithFixedDelay(callbacks.capture(), eq(Duration.ofMillis(250)));
        callbacks.getValue().run();
        verify(matches).resolveExpiredLoadoutSelections();
        verify(matches).resolveExpiredBuildingSessions();
        verify(tasks).scheduleWithFixedDelay(callbacks.capture(), eq(Duration.ofSeconds(2)));
        callbacks.getValue().run();
        verify(matchmaking).sweepQueues();
    }

    @Test void deduplicatesDeadlinesAndReleasesCompletedKeys() {
        AtomicInteger calls = new AtomicInteger();
        for (int i = 0; i < 50; i++) {
            Instant deadline = clock.instant().plusSeconds(1);
            scheduler.schedule(id, active.phase(), deadline, calls::incrementAndGet);
            scheduler.schedule(id, active.phase(), deadline, calls::incrementAndGet);
            assertThat(scheduled).hasSize(i + 1);
            fire(i);
        }
        assertThat(calls).hasValue(50);
    }

    @Test void dropsStalePhaseRoundOrDeadlineAndReleasesKey() {
        Runnable task = mock(Runnable.class);
        Instant deadline = active.loadoutSelectionEndsAt();
        scheduler.schedule(id, active.phase(), deadline, task);
        when(matches.isSchedulingDeadlineCurrent(id, active.phase(), 1, deadline)).thenReturn(false);
        fire(0);
        verifyNoInteractions(task);
        scheduler.schedule(id, active.phase(), deadline, task);
        assertThat(scheduled).hasSize(2);
    }

    @Test void doesNotScheduleAnAlreadyReplacedPhase() {
        scheduler.schedule(id, MatchPhase.BUILDING, clock.instant(), () -> {});
        assertThat(scheduled).isEmpty();
    }

    @Test void earlyCallbackRearmsAtTheAuthoritativeBoundary() {
        Runnable task = mock(Runnable.class);
        scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), task);
        scheduled.getFirst().task().run();
        verifyNoInteractions(task);
        assertThat(scheduled).hasSize(2);
        assertThat(scheduled.get(1).deadline()).isEqualTo(active.loadoutSelectionEndsAt());
        fire(1);
        verify(task).run();
    }

    @Test void alreadyExpiredDeadlineRunsWithoutStartingANewWindow() {
        Runnable task = mock(Runnable.class);
        scheduler.schedule(id, active.phase(), clock.instant().minusSeconds(1), task);
        scheduled.getFirst().task().run();
        verify(task).run();
    }

    @Test void cancelledCallbacksStayHarmlessEvenIfAlreadyDequeued() {
        Runnable task = mock(Runnable.class);
        scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), task);
        scheduler.cancelAll(id);
        verify(scheduled.getFirst().future()).cancel(false);
        fire(0);
        verifyNoInteractions(task);
        scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), task);
        fire(1);
        verify(task).run();
    }

    @Test void rejectedSchedulingReleasesTheDeadlineKey() {
        doThrow(new RejectedExecutionException()).when(tasks).schedule(any(Runnable.class), any(Instant.class));
        assertThatThrownBy(() -> scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), () -> {}))
                .isInstanceOf(RejectedExecutionException.class);
        reset(tasks);
        scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), () -> {});
        verify(tasks).schedule(any(Runnable.class), eq(active.loadoutSelectionEndsAt()));
    }

    @Test void callbackFailureDoesNotRetainItsKey() {
        scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), () -> { throw new IllegalStateException(); });
        fire(0);
        scheduler.schedule(id, active.phase(), active.loadoutSelectionEndsAt(), () -> {});
        assertThat(scheduled).hasSize(2);
    }

    @Test void buildingSchedulesEachPlayersOwnExpiryIncludingCurrentGrace() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        Instant now = clock.instant();
        List<MatchPlayer> players = List.of(
                new MatchPlayer(first, "one", "one", 1, 1, false, null, 0, "custom:s", true, 1000, "PREVIOUS", now.plusSeconds(1)),
                new MatchPlayer(second, "two", "two", 2, 2, false, null, 0, "custom:s", true, 5000, "CURRENT", now.plusSeconds(5)));
        active = new MatchSession(id, 42, players, null, now, now.plusSeconds(7), 1,
                null, null, null, null, false, MatchMode.ONES, 300, 30, Set.of(), List.of(), MatchPhase.BUILDING);
        scheduler.deadlinesChanged(active);
        assertThat(scheduled).extracting(Scheduled::deadline).containsExactly(now.plusSeconds(1), now.plusSeconds(7));
        fire(0);
        verify(matches).resolveBuildingTimeout(id, now.plusSeconds(7));
    }

    @Test void nextPickWaitsForResultHoldAndUsesTheLiveRound() {
        Instant now = clock.instant();
        active = session(MatchPhase.SIMULATION_LOADING, 4, null).withReplay(null, now.plusSeconds(3), now.plusSeconds(23), now.plusSeconds(26), false);
        when(matches.beginNextRound(id, 4)).thenReturn(List.of());
        scheduler.replay(active);
        assertThat(scheduled).extracting(Scheduled::deadline).containsExactly(now.plusSeconds(26));
        fire(0);
        verify(matches).beginNextRound(id, 4);
        verify(matches, never()).revealCompletedMatchResult(any());
    }

    @Test void terminalReplayRevealsThenExpiresWithoutANextRound() {
        Instant now = clock.instant();
        active = session(MatchPhase.SIMULATION_LOADING, 6, null).withReplay(null, now.plusSeconds(3), now.plusSeconds(23), now.plusSeconds(26), true);
        scheduler.replay(active);
        fire(0);
        verify(matches).revealCompletedMatchResult(id);
        verify(matches, never()).expireCompletedMatch(id);
        fire(1);
        verify(matches).expireCompletedMatch(id);
        verify(matches, never()).beginNextRound(any(), anyInt());
    }

    @Test void acceptanceDeadlineIsDeduplicatedAndStaleOffersDoNothing() {
        Instant deadline = clock.instant().plusSeconds(22);
        when(matchmaking.isPendingDeadlineCurrent(id, deadline)).thenReturn(false);
        scheduler.acceptance(id, deadline);
        scheduler.acceptance(id, deadline);
        assertThat(scheduled).hasSize(1);
        fire(0);
        verify(matchmaking, never()).resolvePendingMatchTimeout(any(), any());
        when(matchmaking.isPendingDeadlineCurrent(id, deadline)).thenReturn(true);
        scheduler.acceptance(id, deadline);
        fire(1);
        verify(matchmaking).resolvePendingMatchTimeout(id, deadline);
    }

    @Test void chatClosureFansOutToAllParticipantsAfterItsDeadline() {
        Instant deadline = clock.instant().plusSeconds(30);
        when(matches.matchChatCloseAt(id)).thenReturn(deadline);
        when(matches.closeMatchChat(id)).thenReturn(new MatchChatClosure(id, "Closed", List.of("one", "two")));
        scheduler.chat(id, deadline);
        fire(0);
        ArgumentCaptor<MatchChatEventDTO> event = ArgumentCaptor.forClass(MatchChatEventDTO.class);
        verify(publisher).chat(eq(List.of("one", "two")), event.capture());
        assertThat(event.getValue().type()).isEqualTo("MATCH_CHAT_CLOSED");
    }

    @Test void restoredConnectionSkipsHeartbeatLossDetection() {
        AtomicBoolean disconnected = new AtomicBoolean(true);
        scheduler.detectDisconnect("one", "socket", disconnected::get);
        disconnected.set(false);
        fire(0);
        verify(matches, never()).markDisconnected(any(), any());
    }

    @Test void heartbeatLossDetectionRunsAfterTenSeconds() {
        scheduler.detectDisconnect("one", "socket", () -> true);
        assertThat(scheduled.getFirst().deadline()).isEqualTo(clock.instant().plusSeconds(10));
        fire(0);
        verify(matches).markDisconnected("one", "socket");
    }

    @Test void duplicateSimulationRequestsShareOneExecutorTaskAndDropOnceReplayBegins() {
        loading();
        scheduler.simulate(id, 1);
        scheduler.simulate(id, 1);
        assertThat(simulations).hasSize(1);
        simulations.getFirst().run();
        verify(matches).completeSimulation(id);
        active = session(MatchPhase.REPLAY, 1, null);
        scheduler.simulate(id, 1);
        assertThat(simulations).hasSize(1);
    }

    @Test void loadingIsPublishedBeforeSimulationIsDispatched() {
        loading();
        when(matches.simulationLoadingEvents(id, 1)).thenReturn(List.of());
        scheduler.simulate(id, 1);
        var ordered = inOrder(publisher, executor);
        ordered.verify(publisher).publish(List.of());
        ordered.verify(executor).execute(any(Runnable.class));
    }

    @Test void simulationAndLoadingWaitForSubmissionCommit() {
        loading();
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            scheduler.simulate(id, 1);
            verifyNoInteractions(executor, publisher);
            TransactionSynchronization callback = TransactionSynchronizationManager.getSynchronizations().getFirst();
            callback.afterCommit();
            assertThat(simulations).hasSize(1);
            callback.afterCompletion(TransactionSynchronization.STATUS_COMMITTED);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }

    @Test void rolledBackSubmissionReleasesTheSimulationClaimWithoutPublishing() {
        loading();
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            scheduler.simulate(id, 1);
            TransactionSynchronizationManager.getSynchronizations().getFirst()
                    .afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
            verifyNoInteractions(executor, publisher);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
        scheduler.simulate(id, 1);
        assertThat(simulations).hasSize(1);
    }

    @Test void transientSimulationFailureRetriesOnLifecycleSchedulerThenSucceeds() {
        loading();
        when(matches.completeSimulation(id)).thenThrow(new IllegalStateException()).thenReturn(List.of());
        scheduler.simulate(id, 1);
        simulations.getFirst().run();
        assertThat(scheduled.getFirst().deadline()).isEqualTo(clock.instant().plusMillis(100));
        fire(0);
        simulations.get(1).run();
        verify(matches, times(2)).completeSimulation(id);
        verify(matches, never()).cancelFailedSimulation(any(), any());
    }

    @Test void executorRejectionRetriesThreeTimesThenCancelsWithoutAnOutcome() {
        loading();
        doThrow(new RejectedExecutionException()).when(executor).execute(any(Runnable.class));
        scheduler.simulate(id, 1);
        fire(0);
        fire(1);
        verify(executor, times(3)).execute(any(Runnable.class));
        verify(matches).cancelFailedSimulation(id, 1);
        verify(matches, never()).completeSimulation(any());
    }

    @Test void failedRetrySchedulingAlsoCancelsAndReleasesClaim() {
        loading();
        doThrow(new RejectedExecutionException()).when(executor).execute(any(Runnable.class));
        doThrow(new RejectedExecutionException()).when(tasks).schedule(any(Runnable.class), any(Instant.class));
        scheduler.simulate(id, 1);
        scheduler.simulate(id, 1);
        verify(matches, times(2)).cancelFailedSimulation(id, 1);
    }

    @Test void cancelledSimulationRetryCannotResurrectTheMatch() {
        loading();
        when(matches.completeSimulation(id)).thenThrow(new IllegalStateException());
        scheduler.simulate(id, 1);
        simulations.getFirst().run();
        scheduler.cancelAll(id);
        fire(0);
        assertThat(simulations).hasSize(1);
        verify(matches, never()).cancelFailedSimulation(any(), any());
    }

    @Test void queuedSimulationDoesNotOccupyTheLifecycleScheduler() {
        loading();
        scheduler.simulate(id, 1);
        Runnable independent = mock(Runnable.class);
        scheduler.publishAt(UUID.randomUUID(), "other match", clock.instant().plusSeconds(1), independent);
        fire(0);
        verify(independent).run();
        verify(matches, never()).completeSimulation(any());
        assertThat(simulations).hasSize(1);
    }

    private record Scheduled(Runnable task, Instant deadline, ScheduledFuture<?> future) {}
    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-09T12:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
}
