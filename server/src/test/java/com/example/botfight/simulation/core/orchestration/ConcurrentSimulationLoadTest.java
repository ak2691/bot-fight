package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.service.submission.LegacyAbilityPayloadMigration;
import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.combat.ProjectileSimulationService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.lang.management.ManagementFactory;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import java.util.zip.Deflater;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Temporary direct simulation load test. It intentionally bypasses WebSocket,
 * STOMP, persistence, and replay scheduling so that the authoritative combat
 * calculation can be measured in isolation.
 *
 * Run with:
 *   .\mvnw.cmd -Dtest=ConcurrentSimulationLoadTest test
 *
 * Override the simulated worker count with:
 *   -Dsimulation.load.workers=4
 */
class ConcurrentSimulationLoadTest {
    private static final int MATCH_COUNT = 50;
    private static final int DEFAULT_WORKER_COUNT = 2;
    private static final int WORKER_COUNT = Math.max(
            1,
            Integer.getInteger("simulation.load.workers", DEFAULT_WORKER_COUNT));
    private static final int ARENA_WIDTH = 1_600;
    private static final int ARENA_HEIGHT = 1_600;
    private static final int MATCH_DURATION_MS = 60_000;
    private static final int REPLAY_RECIPIENT_COUNT = 2;
    private static final List<String> LOAD_TEST_ABILITIES = List.of(
            "throw_grenade",
            "shoot_fireball",
            "proximity_mine",
            "silence_pulse",
            "hunter_drone",
            "wind_burst");

    private final JsonMapper jsonMapper = new JsonMapper();

    @Test
    void runsFiftyIndependentMatchesConcurrentlyAndReportsCapacityMetrics() throws Exception {
        DuelSimulationService simulationService = newSimulationService();
        JsonNode sharedBrain = loadTestBrain();
        List<LoadTestRequest> requests = requests(sharedBrain);
        CountDownLatch release = new CountDownLatch(1);
        List<Future<Measurement>> futures = new ArrayList<>(MATCH_COUNT);
        ExecutorService executor = Executors.newFixedThreadPool(
                WORKER_COUNT,
                Thread.ofPlatform().name("simulation-load-", 0).factory());

        Runtime runtime = Runtime.getRuntime();
        long heapBefore = stabilizedUsedHeap(runtime);
        long processCpuBefore = processCpuNanos();
        try {
            for (LoadTestRequest loadTestRequest : requests) {
                long submittedAt = System.nanoTime();
                futures.add(executor.submit(() -> {
                    release.await();
                    long simulationStartedAt = System.nanoTime();
                    MatchReplayDTO playback = simulationService.simulateCompact(loadTestRequest.request());
                    long simulationFinishedAt = System.nanoTime();
                    return new Measurement(
                            loadTestRequest.index(),
                            submittedAt,
                            simulationStartedAt,
                            simulationFinishedAt,
                            loadTestRequest.request().matchId(),
                            playback,
                            playback.frames().size(),
                            playback.frames().stream()
                                    .mapToInt(frame -> frame.entities() == null ? 0 : frame.entities().size())
                                    .max()
                                    .orElse(0),
                            playback.result());
                }));
            }

            long batchReleasedAt = System.nanoTime();
            release.countDown();
            List<Measurement> measurements = futures.stream()
                    .map(this::await)
                    .sorted(Comparator.comparingInt(Measurement::index))
                    .toList();
            long batchFinishedAt = System.nanoTime();
            long heapAfterSimulation = stabilizedUsedHeap(runtime);
            long processCpuAfter = processCpuNanos();
            List<PayloadMeasurement> payloadMeasurements = measurements.stream()
                    .map(this::measurePayloads)
                    .toList();
            long heapAfterPayloads = stabilizedUsedHeap(runtime);

            logReport(
                    batchReleasedAt,
                    batchFinishedAt,
                    heapBefore,
                    heapAfterSimulation,
                    heapAfterPayloads,
                    processCpuBefore,
                    processCpuAfter,
                    measurements,
                    payloadMeasurements);

            assertThat(measurements).hasSize(MATCH_COUNT);
            assertThat(measurements)
                    .allSatisfy(measurement -> assertThat(measurement.frames()).isGreaterThan(0));
        } finally {
            executor.shutdownNow();
            executor.awaitTermination(10, TimeUnit.SECONDS);
        }
    }

    private void logReport(
            long batchReleasedAt,
            long batchFinishedAt,
            long heapBefore,
            long heapAfterSimulation,
            long heapAfterPayloads,
            long processCpuBefore,
            long processCpuAfter,
            List<Measurement> measurements,
            List<PayloadMeasurement> payloadMeasurements) {
        List<Long> queueWaits = measurements.stream().map(Measurement::queueWaitNanos).sorted().toList();
        List<Long> simulationTimes = measurements.stream().map(Measurement::simulationNanos).sorted().toList();
        List<Long> replayJsonSizes = payloadMeasurements.stream()
                .map(PayloadMeasurement::replayJsonBytes)
                .sorted()
                .toList();
        List<Long> batchJsonSizes = payloadMeasurements.stream()
                .map(PayloadMeasurement::batchJsonBytes)
                .sorted()
                .toList();
        List<Long> batchCompressedSizes = payloadMeasurements.stream()
                .map(PayloadMeasurement::batchCompressedBytes)
                .sorted()
                .toList();
        long totalBatchJsonBytes = payloadMeasurements.stream()
                .mapToLong(PayloadMeasurement::batchJsonBytes)
                .sum();
        long totalBatchCompressedBytes = payloadMeasurements.stream()
                .mapToLong(PayloadMeasurement::batchCompressedBytes)
                .sum();
        double batchWallSeconds = nanosToSeconds(batchFinishedAt - batchReleasedAt);
        double processCpuSeconds = nanosToSeconds(processCpuAfter - processCpuBefore);

        System.out.println();
        System.out.println("[simulation-load] Direct authoritative simulation load test");
        System.out.printf(Locale.ROOT, "[simulation-load] matches=%d workers=%d durationMs=%d%n",
                MATCH_COUNT, WORKER_COUNT, MATCH_DURATION_MS);
        System.out.printf(Locale.ROOT,
                "[simulation-load] websocket=false persistence=false replayScheduling=false abilities=%s%n",
                LOAD_TEST_ABILITIES);
        System.out.printf(Locale.ROOT, "[simulation-load] batchWallMs=%.2f processCpuSeconds=%.3f equivalentCpuCores=%.2f%n",
                batchWallSeconds * 1_000, processCpuSeconds,
                batchWallSeconds == 0 ? 0 : processCpuSeconds / batchWallSeconds);
        System.out.printf(Locale.ROOT, "[simulation-load] heapBeforeMb=%.2f heapAfterMb=%.2f heapDeltaMb=%.2f%n",
                bytesToMegabytes(heapBefore), bytesToMegabytes(heapAfterSimulation),
                bytesToMegabytes(heapAfterSimulation - heapBefore));
        System.out.printf(Locale.ROOT,
                "[simulation-load] heapAfterPayloadsMb=%.2f payloadHeapDeltaMb=%.2f%n",
                bytesToMegabytes(heapAfterPayloads),
                bytesToMegabytes(heapAfterPayloads - heapAfterSimulation));
        System.out.printf(Locale.ROOT, "[simulation-load] queueWaitMs=p50:%.2f p95:%.2f max:%.2f%n",
                nanosToMillis(percentile(queueWaits, 0.50)),
                nanosToMillis(percentile(queueWaits, 0.95)),
                nanosToMillis(queueWaits.getLast()));
        System.out.printf(Locale.ROOT, "[simulation-load] simulationMs=p50:%.2f p95:%.2f max:%.2f%n",
                nanosToMillis(percentile(simulationTimes, 0.50)),
                nanosToMillis(percentile(simulationTimes, 0.95)),
                nanosToMillis(simulationTimes.getLast()));
        System.out.printf(Locale.ROOT,
                "[simulation-load] compactReplayJsonBytes=p50:%d p95:%d max:%d total:%d%n",
                percentile(replayJsonSizes, 0.50),
                percentile(replayJsonSizes, 0.95),
                replayJsonSizes.getLast(),
                replayJsonSizes.stream().mapToLong(Long::longValue).sum());
        System.out.printf(Locale.ROOT,
                "[simulation-load] replayBatches=%d batchJsonBytesPerRecipient=p50:%d p95:%d max:%d totalAllMatches:%d%n",
                payloadMeasurements.getFirst().batchCount(),
                percentile(batchJsonSizes, 0.50),
                percentile(batchJsonSizes, 0.95),
                batchJsonSizes.getLast(),
                totalBatchJsonBytes);
        System.out.printf(Locale.ROOT,
                "[simulation-load] batchJsonBytesAllRecipients=%d%n",
                totalBatchJsonBytes * REPLAY_RECIPIENT_COUNT);
        System.out.printf(Locale.ROOT,
                "[simulation-load] batchDeflatedBytesPerRecipient=p50:%d p95:%d max:%d totalAllMatches:%d%n",
                percentile(batchCompressedSizes, 0.50),
                percentile(batchCompressedSizes, 0.95),
                batchCompressedSizes.getLast(),
                totalBatchCompressedBytes);
        System.out.printf(Locale.ROOT,
                "[simulation-load] batchDeflatedBytesAllRecipients=%d%n",
                totalBatchCompressedBytes * REPLAY_RECIPIENT_COUNT);

        for (int index = 0; index < measurements.size(); index += 1) {
            Measurement measurement = measurements.get(index);
            PayloadMeasurement payload = payloadMeasurements.get(index);
            System.out.printf(Locale.ROOT,
                    "[simulation-load] match=%02d queueMs=%.2f simulationMs=%.2f totalMs=%.2f frames=%d maxEntities=%d result=%s compactReplayBytes=%d batches=%d batchJsonBytes=%d batchDeflatedBytes=%d%n",
                    measurement.index(),
                    nanosToMillis(measurement.queueWaitNanos()),
                    nanosToMillis(measurement.simulationNanos()),
                    nanosToMillis(measurement.totalNanos()),
                    measurement.frames(),
                    measurement.maxEntities(),
                    measurement.result(),
                    payload.replayJsonBytes(),
                    payload.batchCount(),
                    payload.batchJsonBytes(),
                    payload.batchCompressedBytes());
        }
    }

    private PayloadMeasurement measurePayloads(Measurement measurement) {
        try {
            MatchReplayDTO playback = measurement.playback();
            long replayJsonBytes = jsonBytes(playback).length;
            List<MatchmakingEventDTO> replayBatchEvents = replayBatchEvents(measurement.matchId(), playback);
            long batchJsonBytes = 0;
            long batchCompressedBytes = 0;
            for (MatchmakingEventDTO event : replayBatchEvents) {
                byte[] json = jsonBytes(event);
                batchJsonBytes += json.length;
                batchCompressedBytes += deflatedSize(json);
            }
            return new PayloadMeasurement(
                    replayJsonBytes,
                    replayBatchEvents.size(),
                    batchJsonBytes,
                    batchCompressedBytes);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to measure replay payload", exception);
        }
    }

    private List<MatchmakingEventDTO> replayBatchEvents(UUID matchId, MatchReplayDTO playback) {
        int finalElapsedMs = playback.frames().isEmpty()
                ? 0
                : playback.frames().getLast().elapsedMs();
        List<MatchmakingEventDTO> events = new ArrayList<>();
        int sequence = 1;
        for (int startMs = 0; startMs < finalElapsedMs; startMs += 1_000) {
            int windowStartMs = startMs;
            int windowEndMs = Math.min(finalElapsedMs, windowStartMs + 1_000);
            List<MatchReplayDTO.ReplayFrameDTO> frames = playback.frames().stream()
                    .filter(frame -> frame.elapsedMs() > windowStartMs
                            || (windowStartMs == 0 && frame.elapsedMs() == 0))
                    .filter(frame -> frame.elapsedMs() <= windowEndMs)
                    .toList();
            if (frames.isEmpty()) continue;
            boolean terminalBatch = frames.getLast().elapsedMs() >= finalElapsedMs;
            MatchReplayDTO batch = new MatchReplayDTO(
                    null,
                    frames,
                    terminalBatch ? playback.result() : null,
                    terminalBatch ? playback.winnerUserId() : null,
                    terminalBatch ? playback.message() : null,
                    sequence,
                    frames.getLast().elapsedMs(),
                    terminalBatch);
            events.add(MatchmakingEventDTO.replayBatchPayload(
                    matchId,
                    DuelSimulationService.DUEL_RULESET_VERSION,
                    batch,
                    Instant.EPOCH,
                    Instant.EPOCH,
                    Instant.EPOCH));
            sequence += 1;
        }
        return List.copyOf(events);
    }

    private byte[] jsonBytes(Object value) {
        try {
            return jsonMapper.writeValueAsBytes(value);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to serialize replay payload", exception);
        }
    }

    private static long deflatedSize(byte[] json) {
        Deflater deflater = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        try {
            deflater.setInput(json);
            deflater.finish();
            ByteArrayOutputStream compressed = new ByteArrayOutputStream(json.length);
            byte[] buffer = new byte[1_024];
            while (!deflater.finished()) {
                compressed.write(buffer, 0, deflater.deflate(buffer));
            }
            return compressed.size();
        } finally {
            deflater.end();
        }
    }

    private Measurement await(Future<Measurement> future) {
        try {
            return future.get();
        } catch (Exception exception) {
            throw new IllegalStateException("Concurrent simulation load test failed", exception);
        }
    }

    private List<LoadTestRequest> requests(JsonNode sharedBrain) {
        return IntStream.range(0, MATCH_COUNT)
                .mapToObj(index -> {
                    UUID matchId = UUID.nameUUIDFromBytes(("load-match-" + index).getBytes());
                    DuelSimulationService.DuelArenaRequest arena =
                            new DuelSimulationService.DuelArenaRequest(
                                    ARENA_WIDTH, ARENA_HEIGHT, MATCH_DURATION_MS);
                    return new LoadTestRequest(
                            index + 1,
                            new DuelSimulationService.DuelSimulationRequest(
                                    matchId,
                                    DuelSimulationService.DUEL_RULESET_VERSION,
                                    10_000L + index,
                                    arena,
                                    List.of(
                                            bot(index, 1, 500, 800, sharedBrain),
                                            bot(index, 2, 1_100, 800, sharedBrain))));
                })
                .toList();
    }

    private DuelSimulationService.DuelBotRequest bot(
            int matchIndex,
            int slot,
            double x,
            double y,
            JsonNode brain) {
        return new DuelSimulationService.DuelBotRequest(
                UUID.nameUUIDFromBytes(("load-user-" + matchIndex + "-" + slot).getBytes()),
                "load-test-" + matchIndex + "-" + slot,
                slot,
                x,
                y,
                slot == 1 ? 90.0 : 270.0,
                60,
                "custom",
                brain);
    }

    private JsonNode loadTestBrain() {
        try {
            String abilities = LOAD_TEST_ABILITIES.stream()
                    .map("\"%s\""::formatted)
                    .collect(java.util.stream.Collectors.joining(","));
            String roots = IntStream.range(0, LOAD_TEST_ABILITIES.size())
                    .mapToObj(index -> """
                            {"createdOrder":%d,"branches":[{"createdOrder":0,"conditions":[{"type":"expression","left":"bot.selectedAbilityReady","ability":"%s","comparator":"eq","right":{"type":"boolean","value":true}}],"actions":[{"action":"%s"}],"children":[]}]}
                            """.formatted(index, LOAD_TEST_ABILITIES.get(index), LOAD_TEST_ABILITIES.get(index)))
                    .collect(java.util.stream.Collectors.joining(","));
            return LegacyAbilityPayloadMigration.normalize(jsonMapper.readTree(
                    """
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":[%s]},"roots":[%s]}
                    """.formatted(abilities, roots)));
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to create load-test brain", exception);
        }
    }

    private DuelSimulationService newSimulationService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ProjectileSimulationService projectileSimulationService = new ProjectileSimulationService(botStateService);
        ActionExecutionService actionExecutionService = new ActionExecutionService(
                botStateService, projectileSimulationService);
        ConditionResolutionService conditionResolutionService = new ConditionResolutionService(
                new ConditionEvaluationService(), actionExecutionService);
        return new DuelSimulationService(
                conditionResolutionService,
                new ReplayMappingService(),
                botStateService,
                projectileSimulationService,
                actionExecutionService);
    }

    private static long usedHeap(Runtime runtime) {
        return runtime.totalMemory() - runtime.freeMemory();
    }

    private static long stabilizedUsedHeap(Runtime runtime) {
        System.gc();
        try {
            Thread.sleep(100);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
        return usedHeap(runtime);
    }

    private static long processCpuNanos() {
        java.lang.management.OperatingSystemMXBean operatingSystemBean =
                ManagementFactory.getOperatingSystemMXBean();
        if (operatingSystemBean instanceof com.sun.management.OperatingSystemMXBean processBean) {
            return Math.max(0, processBean.getProcessCpuTime());
        }
        return 0;
    }

    private static long percentile(List<Long> sortedValues, double percentile) {
        int index = (int) Math.ceil(percentile * sortedValues.size()) - 1;
        return sortedValues.get(Math.max(0, Math.min(index, sortedValues.size() - 1)));
    }

    private static double nanosToSeconds(long nanos) {
        return nanos / 1_000_000_000.0;
    }

    private static double nanosToMillis(long nanos) {
        return nanos / 1_000_000.0;
    }

    private static double bytesToMegabytes(long bytes) {
        return bytes / (1024.0 * 1024.0);
    }

    private record LoadTestRequest(int index, DuelSimulationService.DuelSimulationRequest request) {
    }

    private record Measurement(
            int index,
            long submittedAt,
            long simulationStartedAt,
            long simulationFinishedAt,
            UUID matchId,
            MatchReplayDTO playback,
            int frames,
            int maxEntities,
            String result) {
        long queueWaitNanos() {
            return simulationStartedAt - submittedAt;
        }

        long simulationNanos() {
            return simulationFinishedAt - simulationStartedAt;
        }

        long totalNanos() {
            return simulationFinishedAt - submittedAt;
        }
    }

    private record PayloadMeasurement(
            long replayJsonBytes,
            int batchCount,
            long batchJsonBytes,
            long batchCompressedBytes) {
    }
}
