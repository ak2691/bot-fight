package com.example.botfight.service.simulation;

import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.match.MatchReplayService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class WorkerAuthorityTest {
    private final JsonMapper mapper = new JsonMapper();
    private final String frames = "[ { \"elapsedMs\" : 1000, \"shapes\" : [{\"kind\":\"bot\",\"abilityVisual\":{\"ms\":12}}] } ]";
    private String response() {
        return """
                {"result":{"engineVersion":"test","outcome":"CONTINUES","endReason":"SEGMENT_END",
                "winnerTeam":null,"teamHp":[{"teamNumber":1,"hp":225},{"teamNumber":2,"hp":225}],
                "segmentEndMs":3000,"endState":[]},"replay":{"initialState":{"shapes":[]},"batches":[
                {"sequence":1,"endMs":1000,"terminal":false,"frames":%s},
                {"sequence":2,"endMs":2000,"terminal":false,"frames":[{"elapsedMs":2000,"shapes":[]}]},
                {"sequence":3,"endMs":3000,"terminal":true,"frames":[{"elapsedMs":3000,"shapes":[]}]}]}}
                """.formatted(frames);
    }
    private SimWorkerClient client() {
        return new SimWorkerClient(mapper, new SimpleMeterRegistry(), "http://127.0.0.1:1", "test", Duration.ofMillis(100), 1);
    }
    @Test void rawFramesSurviveBatchDeliveryMetadataAndSerialization() {
        try (var client = client()) {
            var raw = client.parseResponse(response());
            assertThat(raw.batches().getFirst().frames()).isEqualTo(frames);
            var replay = new MatchReplayDTO("CONTINUES", null, "done", null, null, true, null)
                    .withWorkerReplay(raw);
            var service = new MatchReplayService();
            var batch = service.prepareBatches(replay).getFirst().playback();
            String json = mapper.writeValueAsString(batch.withRatingChange(1, 2));
            assertThat(json).contains("\"frames\":" + frames);
            assertThat(mapper.readTree(json).path("frames").get(0).path("shapes").get(0).path("abilityVisual").path("ms").asInt()).isEqualTo(12);
            assertThat(batch.result()).isNull();
            assertThat(service.resultPayload(replay).result()).isEqualTo("CONTINUES");
            assertThat(service.withWinner(replay, null, "draw").workerReplay()).isEqualTo(raw);
            assertThat(service.finalElapsedMs(replay)).isEqualTo(3000);
        }
    }
    @Test void reconnectUsesOnlyAuthorizedBatchesAndIncludesInitialState() {
        try (var client = client()) {
            var replay = new MatchReplayDTO("CONTINUES", null, "done", null, null, true, null)
                    .withWorkerReplay(client.parseResponse(response()));
            var service = new MatchReplayService();
            Instant start = Instant.parse("2026-10-09T00:00:00Z");
            var before = service.authorizedReplayForReconnect(replay, start, start.minusMillis(1000));
            assertThat(before.workerReplay().batches()).hasSize(1);
            assertThat(before.workerReplay().initialState()).isEqualTo("{\"shapes\":[]}");
            assertThat(before.result()).isNull();
            assertThat(before.terminalBatch()).isFalse();
            assertThat(service.initialBatch(replay).workerReplay().batches()).isEmpty();
        }
    }
    @Test void malformedWorkerResultFailsInsteadOfProducingJavaPlayback() {
        try (var client = client()) {
            assertThatThrownBy(() -> client.parseResponse(response().replace("CONTINUES", "ERROR")))
                    .isInstanceOf(IllegalArgumentException.class);
            var request = new SimulationRequest.DuelSimulationRequest(
                    UUID.randomUUID(), "duel-v3", 1,
                    new SimulationRequest.DuelArenaRequest(1200,1200,100), List.of());
            assertThatThrownBy(() -> client.simulate(request, null)).isInstanceOf(RuntimeException.class);
        }
    }
}
