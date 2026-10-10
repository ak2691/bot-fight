package com.example.botfight.service.simulation;

import java.util.Set;

import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import io.micrometer.core.instrument.MeterRegistry;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Bounded worker transport: authenticated worker calls are bounded and failures propagate. */
@Service
public class SimWorkerClient implements AutoCloseable {
    private static final Logger LOG = LoggerFactory.getLogger(SimWorkerClient.class);
    private final RestClient rest;
    private final JsonMapper mapper;
    private final MeterRegistry metrics;
    private final Semaphore authorityPermits;

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
        authorityPermits = new Semaphore(concurrency);
        this.mapper = mapper;
        this.metrics = metrics;
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).build());
        factory.setReadTimeout(timeout);
        rest = RestClient.builder().baseUrl(url).requestFactory(factory)
                .defaultHeader("X-Sim-Worker-Secret", secret).build();

    }

    public WorkerReplay simulate(DuelSimulationRequest request, JsonNode puzzle) {
        if (!authorityPermits.tryAcquire()) throw new RejectedExecutionException("Simulation worker is busy");
        try {
            ObjectNode body = (ObjectNode) mapper.readTree(requestBody(request));
            if (puzzle != null) body.set("puzzle", puzzle);
            String response = rest.post().uri("/simulate").contentType(MediaType.APPLICATION_JSON)
                    .body(mapper.writeValueAsString(body)).retrieve().body(String.class);
            WorkerReplay replay = parseResponse(response);
            metrics.counter("sim.worker.authority.matches").increment();
            LOG.info("SIM_WORKER_RESULT matchId={} engineVersion={} outcome={} endMs={}", request.matchId(),
                    replay.result().engineVersion(), replay.result().outcome(), replay.result().segmentEndMs());
            return replay;
        } catch (RuntimeException failure) {
            metrics.counter("sim.worker.authority.failures").increment();
            throw failure;
        } finally { authorityPermits.release(); }
    }

    /**
     * Runs the brain schema and the shared brain rules in the worker (POST /validate). Returns the errors;
     * empty means valid. Throws when the worker cannot answer, so a submission is never accepted unchecked.
     */
    public List<String> validateBrain(JsonNode brain, boolean puzzleRules) {
        return validateBrain(brain, puzzleRules, null);
    }

    public List<String> validateBrain(JsonNode brain, boolean puzzleRules, java.util.Map<String, Object> puzzleConstraints) {
        ObjectNode body = mapper.createObjectNode();
        body.set("brain", brain);
        if (puzzleRules) body.put("puzzleRules", true);
        if (puzzleConstraints != null) body.set("puzzleConstraints", mapper.valueToTree(puzzleConstraints));
        JsonNode response = mapper.readTree(rest.post().uri("/validate").contentType(MediaType.APPLICATION_JSON)
                .body(mapper.writeValueAsString(body)).retrieve().body(String.class));
        JsonNode errors = response.path("errors");
        if (!errors.isArray()) throw new IllegalStateException("Invalid worker validation response");
        List<String> messages = new ArrayList<>();
        errors.forEach(error -> messages.add(error.asString()));
        return List.copyOf(messages);
    }

    public WorkerReplay parseResponse(String response) {
        WorkerReplay.Result result = null;
        String initialState = null;
        var batches = new ArrayList<WorkerReplay.Batch>();
        try (var parser = mapper.createParser(response)) {
            if (parser.nextToken() != tools.jackson.core.JsonToken.START_OBJECT)
                throw new IllegalArgumentException("Invalid worker response");
            while (parser.nextToken() != tools.jackson.core.JsonToken.END_OBJECT) {
                String name = parser.currentName();
                parser.nextToken();
                if ("result".equals(name)) result = mapper.readValue(rawValue(parser, response), WorkerReplay.Result.class);
                else if ("replay".equals(name)) {
                    if (parser.currentToken() != tools.jackson.core.JsonToken.START_OBJECT)
                        throw new IllegalArgumentException("Invalid worker replay");
                    while (parser.nextToken() != tools.jackson.core.JsonToken.END_OBJECT) {
                        String field = parser.currentName();
                        parser.nextToken();
                        if ("initialState".equals(field)) initialState = rawValue(parser, response);
                        else if ("batches".equals(field)) readBatches(parser, response, batches);
                        else parser.skipChildren();
                    }
                } else parser.skipChildren();
            }
            if (parser.nextToken() != null) throw new IllegalArgumentException("Trailing worker response");
        }
        if (result == null || result.engineVersion() == null || result.engineVersion().isBlank()
                || result.outcome() == null || !Set.of("CONTINUES", "BOT_WIN", "DRAW").contains(result.outcome())
                || result.endReason() == null || !Set.of("KO", "HP_DECISION", "SEGMENT_END").contains(result.endReason())
                || result.segmentEndMs() < 0 || result.teamHp() == null || result.endState() == null
                || initialState == null || !initialState.startsWith("{"))
            throw new IllegalArgumentException("Invalid worker result");
        if (!batches.isEmpty() && !batches.getLast().terminal()) throw new IllegalArgumentException("Missing terminal batch");
        return new WorkerReplay(result, initialState, List.copyOf(batches));
    }

    private void readBatches(tools.jackson.core.JsonParser parser, String response,
                             List<WorkerReplay.Batch> batches) {
        if (parser.currentToken() != tools.jackson.core.JsonToken.START_ARRAY)
            throw new IllegalArgumentException("Invalid worker batches");
        while (parser.nextToken() != tools.jackson.core.JsonToken.END_ARRAY) {
            if (parser.currentToken() != tools.jackson.core.JsonToken.START_OBJECT)
                throw new IllegalArgumentException("Invalid worker batch");
            Integer sequence = null, end = null;
            Boolean terminal = null;
            String frames = null;
            while (parser.nextToken() != tools.jackson.core.JsonToken.END_OBJECT) {
                String field = parser.currentName();
                parser.nextToken();
                switch (field) {
                    case "sequence" -> sequence = parser.getIntValue();
                    case "endMs" -> end = parser.getIntValue();
                    case "terminal" -> terminal = parser.getBooleanValue();
                    case "frames" -> frames = rawValue(parser, response);
                    default -> parser.skipChildren();
                }
            }
            int previous = batches.isEmpty() ? 0 : batches.getLast().endMs();
            int previousSequence = batches.isEmpty() ? 0 : batches.getLast().sequence();
            if (end == null || sequence == null || terminal == null || end <= previous || sequence <= previousSequence
                    || frames == null || !frames.startsWith("[") || !batches.isEmpty() && batches.getLast().terminal())
                throw new IllegalArgumentException("Invalid worker batch");
            batches.add(new WorkerReplay.Batch(sequence, end, terminal, frames));
        }
    }

    private String rawValue(tools.jackson.core.JsonParser parser, String source) {
        int start = (int) parser.currentTokenLocation().getCharOffset();
        parser.skipChildren();
        int end = (int) parser.currentLocation().getCharOffset();
        return source.substring(start, end);
    }

    public String requestBody(DuelSimulationRequest request) {
        ObjectNode body = (ObjectNode) mapper.valueToTree(request);
        body.put("seed", Long.toString(request.seed()));
        // Missing-submission brains are server-created empty objects, not submitted brains.
        // Supply an empty tree so the worker envelope stays schema-valid.
        for (JsonNode bot : body.path("bots")) completeEmptyBrain(bot.path("brain"));
        for (JsonNode segment : body.path("segments")) {
            for (JsonNode bot : segment.path("bots")) completeEmptyBrain(bot.path("brain"));
        }
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

