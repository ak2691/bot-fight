package com.example.botfight.service.match;

import com.example.botfight.DTO.match.MatchChatEventDTO;
import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchPhase;
import com.example.botfight.service.matchmaking.MatchmakingService;
import jakarta.annotation.PostConstruct;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Lazy;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Owns lifecycle deadlines and bounded authoritative simulation dispatch. */
@Service
public class MatchScheduler {
    private static final Logger log = LoggerFactory.getLogger(MatchScheduler.class);
    private static final int MAX_SIMULATION_ATTEMPTS = 3;
    private final TaskScheduler scheduler;
    private final AsyncTaskExecutor simulationExecutor;
    private final MatchService matches;
    private final MatchmakingService matchmaking;
    private final MatchEventPublisher publisher;
    private final Clock clock;
    private final ConcurrentHashMap<Key, Ticket> pending = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Simulation, SimulationClaim> simulations = new ConcurrentHashMap<>();

    public MatchScheduler(
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler,
            @Qualifier("matchSimulationExecutor") AsyncTaskExecutor simulationExecutor,
            @Lazy MatchService matches, @Lazy MatchmakingService matchmaking,
            @Lazy MatchEventPublisher publisher, Clock clock) {
        this.scheduler = scheduler;
        this.simulationExecutor = simulationExecutor;
        this.matches = matches;
        this.matchmaking = matchmaking;
        this.publisher = publisher;
        this.clock = clock;
    }

    @PostConstruct
    public void startSweeps() {
        scheduler.scheduleWithFixedDelay(() -> safely(() -> {
            publisher.publish(matches.resolveExpiredLoadoutSelections());
            publisher.publish(matches.resolveExpiredBuildingSessions());
        }), Duration.ofMillis(250));
        scheduler.scheduleWithFixedDelay(() -> safely(() -> publisher.publish(matchmaking.sweepQueues())),
                Duration.ofSeconds(2));
    }

    public void schedule(UUID matchId, MatchPhase phase, Instant deadline, Runnable task) {
        MatchSession session = matches.sessionForScheduling(matchId);
        if (session == null || session.phase() != phase) return;
        int round = session.roundNumber();
        scheduleTask(new Key(matchId, phase.name(), deadline), deadline,
                () -> matches.isSchedulingDeadlineCurrent(matchId, phase, round, deadline), task);
    }

    /** Called by timing services after storing a pick/build deadline. */
    public void deadlinesChanged(MatchSession session) {
        if (session.phase() == MatchPhase.KIT_REVEAL && session.loadoutSelectionEndsAt() != null) {
            schedule(session.matchId(), session.phase(), session.loadoutSelectionEndsAt(),
                    () -> publisher.publish(matches.resolveLoadoutSelectionTimeout(session.matchId())));
        } else if (session.phase() == MatchPhase.BUILDING) {
            session.players().stream().filter(player -> !player.finished())
                    .map(player -> player.buildExpiresAt()).filter(java.util.Objects::nonNull).distinct()
                    .forEach(deadline -> schedule(session.matchId(), session.phase(), deadline,
                            () -> publisher.publish(matches.resolveBuildingTimeout(session.matchId(), session.buildingEndsAt()))));
        }
    }

    /** Replay boundaries are scheduled from authoritative state, never a projected socket event. */
    public void replay(MatchSession session) {
        if (session.ended()) {
            schedule(session.matchId(), MatchPhase.REPLAY, session.resultRevealsAt(),
                    () -> matches.revealCompletedMatchResult(session.matchId()));
            scheduleTask(new Key(session.matchId(), "terminal expiry", session.roundReadyAt()), session.roundReadyAt(),
                    () -> {
                        MatchSession current = matches.sessionForScheduling(session.matchId());
                        return current != null && current.ended() && current.roundReadyAt().equals(session.roundReadyAt());
                    }, () -> matches.expireCompletedMatch(session.matchId()));
        } else {
            schedule(session.matchId(), MatchPhase.REPLAY, session.roundReadyAt(), () -> {
                publisher.publish(matches.beginNextRound(session.matchId(), session.roundNumber()));
                session.players().forEach(player -> publisher.publish(matches.promotePendingDisconnect(player.principalName())));
            });
        }
    }

    public void acceptance(UUID matchId, Instant deadline) {
        scheduleTask(new Key(matchId, "acceptance", deadline), deadline,
                () -> matchmaking.isPendingDeadlineCurrent(matchId, deadline),
                () -> publisher.publish(matchmaking.resolvePendingMatchTimeout(matchId, deadline)));
    }

    public void chat(UUID matchId, Instant deadline) {
        scheduleTask(new Key(matchId, "chat", deadline), deadline,
                () -> deadline.equals(matches.matchChatCloseAt(matchId)), () -> {
                    var closure = matches.closeMatchChat(matchId);
                    if (closure == null) return;
                    Instant now = Instant.now(clock);
                    publisher.chat(closure.recipientPrincipalNames(), new MatchChatEventDTO(
                            "MATCH_CHAT_CLOSED", null, matchId, null, closure.message(), now, deadline, now));
                });
    }

    public void disconnect(UUID matchId, String principal, Instant deadline) {
        scheduleTask(new Key(matchId, "disconnect:" + principal, deadline), deadline.plusMillis(250),
                () -> true, () -> publisher.publish(matches.resolveDisconnectTimeout(principal, deadline)));
    }

    public void detectDisconnect(String principal, String sessionId, BooleanSupplier stillDisconnected) {
        Instant deadline = Instant.now(clock).plusSeconds(10);
        scheduleTask(new Key(null, "connection:" + sessionId, deadline), deadline, stillDisconnected,
                () -> publisher.publish(matches.markDisconnected(principal, sessionId)));
    }

    public void publishAt(UUID matchId, String publicationId, Instant deadline, Runnable task) {
        scheduleTask(new Key(matchId, "publish:" + publicationId, deadline), deadline, () -> true, task);
    }

    public void cancelPublications(UUID matchId) {
        pending.forEach((key, ticket) -> {
            if (java.util.Objects.equals(matchId, key.matchId()) && key.kind().startsWith("publish:")) cancel(key, ticket);
        });
    }

    public void cancelAll(UUID matchId) {
        pending.forEach((key, ticket) -> { if (java.util.Objects.equals(matchId, key.matchId())) cancel(key, ticket); });
        simulations.keySet().removeIf(key -> key.matchId().equals(matchId));
    }

    private void cancel(Key key, Ticket ticket) {
        if (!pending.remove(key, ticket)) return;
        ScheduledFuture<?> future = ticket.future.get();
        if (future != null) future.cancel(false);
    }

    private void scheduleTask(Key key, Instant runAt, BooleanSupplier current, Runnable task) {
        Ticket ticket = new Ticket();
        if (pending.putIfAbsent(key, ticket) != null) return;
        arm(key, ticket, runAt, current, task);
    }

    private void arm(Key key, Ticket ticket, Instant runAt, BooleanSupplier current, Runnable task) {
        try {
            ScheduledFuture<?> future = scheduler.schedule(() -> {
                if (pending.get(key) != ticket) return;
                if (Instant.now(clock).isBefore(runAt)) {
                    arm(key, ticket, runAt, current, task);
                    return;
                }
                if (!pending.remove(key, ticket)) return;
                safely(() -> { if (current.getAsBoolean()) task.run(); });
            }, runAt);
            ticket.future.set(future);
            // Cancellation or execution may race with schedule() returning its future.
            if (pending.get(key) != ticket && future != null) future.cancel(false);
        } catch (RuntimeException failure) {
            pending.remove(key, ticket);
            throw failure;
        }
    }

    public void simulate(UUID matchId, int round) {
        Simulation key = new Simulation(matchId, round);
        SimulationClaim claim = new SimulationClaim();
        if (simulations.putIfAbsent(key, claim) != null) return;
        Runnable dispatch = () -> {
            if (!current(key, claim)) { simulations.remove(key, claim); return; }
            try {
                submit(key, claim, 1);
            } catch (RuntimeException failure) {
                retry(key, claim, 1, failure);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()
                && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { dispatch.run(); }
                @Override public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) simulations.remove(key, claim);
                }
            });
        } else dispatch.run();
    }

    private boolean current(Simulation key, SimulationClaim claim) {
        if (simulations.get(key) != claim) return false;
        MatchSession session = matches.sessionForScheduling(key.matchId());
        return session != null && session.roundNumber() == key.round()
                && (session.phase() == MatchPhase.SIMULATION_LOADING || session.phase() == MatchPhase.SIMULATING);
    }

    private void submit(Simulation key, SimulationClaim claim, int attempt) {
        if (!current(key, claim)) { simulations.remove(key, claim); return; }
        try {
            if (!claim.announced) {
                publisher.publish(matches.simulationLoadingEvents(key.matchId(), key.round()));
                claim.announced = true;
            }
            simulationExecutor.execute(() -> {
                if (!current(key, claim)) { simulations.remove(key, claim); return; }
                try {
                    publisher.publish(matches.completeSimulation(key.matchId()));
                    simulations.remove(key, claim);
                } catch (RuntimeException failure) { retry(key, claim, attempt, failure); }
            });
        } catch (RuntimeException failure) { retry(key, claim, attempt, failure); }
    }

    private void retry(Simulation key, SimulationClaim claim, int attempt, RuntimeException failure) {
        if (!current(key, claim)) { simulations.remove(key, claim); return; }
        if (attempt < MAX_SIMULATION_ATTEMPTS) {
            Instant retryAt = Instant.now(clock).plusMillis(100);
            try {
                scheduleTask(new Key(key.matchId(), "simulation:" + key.round(), retryAt), retryAt,
                        () -> true, () -> submit(key, claim, attempt + 1));
                return;
            } catch (RuntimeException rejected) { failure.addSuppressed(rejected); }
        }
        log.error("Authoritative simulation exhausted retries matchId={} round={}", key.matchId(), key.round(), failure);
        try { publisher.publish(matches.cancelFailedSimulation(key.matchId(), key.round())); }
        finally { simulations.remove(key, claim); }
    }

    private void safely(Runnable task) {
        try { task.run(); }
        catch (RuntimeException failure) { log.error("Match scheduling callback failed", failure); }
    }

    private record Key(UUID matchId, String kind, Instant deadline) {}
    private record Simulation(UUID matchId, int round) {}
    private static final class SimulationClaim { volatile boolean announced; }
    private static final class Ticket { final AtomicReference<ScheduledFuture<?>> future = new AtomicReference<>(); }
}
