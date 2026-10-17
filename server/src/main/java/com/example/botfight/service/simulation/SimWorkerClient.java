package com.example.botfight.service.simulation;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.simulation.WorkerResult.PuzzleResult;
import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.PuzzleRequest;
import io.micrometer.core.instrument.MeterRegistry;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.HttpServerErrorException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Bounded worker transport: authenticated worker calls are bounded and failures propagate. */
@Service
public class SimWorkerClient implements AutoCloseable {
    private static final Logger LOG = LoggerFactory.getLogger(SimWorkerClient.class);
    private static final Set<String> RESULTS = Set.of("BOT_WIN", "DRAW");
    private static final Set<String> PUZZLE_STATUSES = Set.of("solved", "failed");
    private final RestClient rest;
    private final JsonMapper mapper;
    private final MeterRegistry metrics;
    private final Semaphore authorityPermits;
    private final Duration timeout;

    public SimWorkerClient(
            JsonMapper mapper, MeterRegistry metrics,
            @Value("${sim.worker.url:http://sim-worker:8090}") String url,
            @Value("${sim.worker.secret:}") String secret,
            @Value("${sim.worker.timeout:12s}") Duration timeout,
            @Value("${sim.worker.concurrency:2}") int concurrency) {
        if (concurrency < 1 || timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("sim.worker concurrency and timeout must be positive");
        }
        if (secret.isBlank()) throw new IllegalArgumentException("sim.worker.secret is required");
        authorityPermits = new Semaphore(concurrency, true);
        this.timeout = timeout;
        this.mapper = mapper;
        this.metrics = metrics;
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).build());
        factory.setReadTimeout(timeout);
        rest = RestClient.builder().baseUrl(url).requestFactory(factory)
                .defaultHeader("X-Sim-Worker-Secret", secret).build();

    }

    /** Runs a rated duel in the worker. The replay is the authoritative result. */
    public WorkerResult simulate(DuelSimulationRequest request) {
        return send(request, null);
    }

    /** Runs a puzzle attempt in the worker. The response must include the puzzle outcome. */
    public WorkerResult simulatePuzzle(DuelSimulationRequest request, PuzzleRequest puzzle) {
        if (puzzle == null) throw new IllegalArgumentException("puzzle request is required");
        return send(request, puzzle);
    }

    private WorkerResult send(DuelSimulationRequest request, PuzzleRequest puzzle) {
        if (puzzle != null) {
            try {
                // Timed acquisition honors fair-queue predecessors, even with a zero wait.
                if (!authorityPermits.tryAcquire(0, TimeUnit.MILLISECONDS)) {
                    throw RateLimitExceededException.tooManyRequests(Duration.ofSeconds(1));
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw RateLimitExceededException.tooManyRequests(Duration.ofSeconds(1));
            }
        } else {
            try {
                if (!authorityPermits.tryAcquire(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    throw new RejectedExecutionException("Simulation worker is busy");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new RejectedExecutionException("Interrupted while waiting for simulation worker", interrupted);
            }
        }
        try {
            ObjectNode body = (ObjectNode) mapper.readTree(requestBody(request));
            if (puzzle != null) body.set("puzzle", mapper.valueToTree(puzzle));
            String response = rest.post().uri("/simulate").contentType(MediaType.APPLICATION_JSON)
                    .body(mapper.writeValueAsString(body)).retrieve().body(String.class);
            WorkerResult result = parseResponse(response, puzzle != null);
            metrics.counter("sim.worker.authority.matches").increment();
            LOG.info("SIM_WORKER_RESULT matchId={} engineVersion={} result={} puzzle={}", request.matchId(),
                    result.engineVersion(), result.replay().result(),
                    result.puzzle() == null ? null : result.puzzle().status());
            return result;
        } catch (HttpServerErrorException failure) {
            metrics.counter("sim.worker.authority.failures").increment();
            if (puzzle != null && failure.getStatusCode().value() == 503) {
                throw RateLimitExceededException.tooManyRequests(Duration.ofSeconds(1));
            }
            throw failure;
        } catch (RuntimeException failure) {
            metrics.counter("sim.worker.authority.failures").increment();
            throw failure;
        } finally { authorityPermits.release(); }
    }

    WorkerResult parseResponse(String response, boolean puzzleRequested) {
        JsonNode root = mapper.readTree(response);
        JsonNode replayNode = root.path("replay");
        if (!replayNode.isObject()) throw new IllegalArgumentException("Worker response has no replay");
        if (!RESULTS.contains(replayNode.path("result").asString(""))) {
            throw new IllegalArgumentException("Worker replay has an unsupported result");
        }
        String result = replayNode.path("result").asString("");
        JsonNode winnerNode = replayNode.path("winnerUserId");
        boolean hasWinner = !winnerNode.isMissingNode() && !winnerNode.isNull()
                && !winnerNode.asString("").isBlank();
        if (hasWinner != "BOT_WIN".equals(result)) {
            throw new IllegalArgumentException("Worker replay result and winner disagree");
        }
        JsonNode framesNode = replayNode.path("frames");
        if (!framesNode.isArray()) {
            throw new IllegalArgumentException("Worker replay has no frames array");
        }
        int lastElapsedMs = -1;
        for (JsonNode frame : framesNode) {
            JsonNode elapsedMs = frame.path("elapsedMs");
            if (!frame.isObject() || !elapsedMs.isIntegralNumber()
                    || elapsedMs.asInt() < 0 || elapsedMs.asInt() <= lastElapsedMs) {
                throw new IllegalArgumentException("Worker replay frames have invalid timing");
            }
            lastElapsedMs = elapsedMs.asInt();
        }
        MatchReplayDTO replay = mapper.treeToValue(replayNode, MatchReplayDTO.class);
        PuzzleResult puzzle = null;
        if (puzzleRequested) {
            JsonNode puzzleNode = root.path("puzzle");
            String status = puzzleNode.path("status").asString("");
            if (!PUZZLE_STATUSES.contains(status) || !puzzleNode.path("elapsedMs").isIntegralNumber()) {
                throw new IllegalArgumentException("Worker response has no puzzle outcome");
            }
            puzzle = new PuzzleResult(status, puzzleNode.path("elapsedMs").asInt());
        }
        return new WorkerResult(root.path("engineVersion").asString(""), replay, puzzle);
    }

    public String requestBody(DuelSimulationRequest request) {
        ObjectNode body = (ObjectNode) mapper.valueToTree(request);
        body.put("seed", Long.toString(request.seed()));
        // Missing-submission brains are server-created empty objects, not submitted brains.
        // Supply an empty tree so the worker envelope stays schema-valid.
        for (JsonNode bot : body.path("bots")) completeEmptyBrain(bot.path("brain"));
        return mapper.writeValueAsString(body);
    }

    private void completeEmptyBrain(JsonNode brain) {
        if (brain instanceof ObjectNode object && !brain.has("version") && !brain.has("roots")) {
            object.put("version", "bot-logic-tree-v2");
            object.putArray("roots");
        }
    }

    @Override public void close() { /* JDK transport owns no application executor. */ }
}
