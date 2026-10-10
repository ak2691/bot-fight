package com.example.botfight.simulation;

import com.example.botfight.support.WorkerReplayFixtures;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.service.match.MatchReplayService;
import com.example.botfight.service.match.state.PreparedReplayBatch;
import com.example.botfight.service.simulation.SimulationRequest.DuelArenaRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelBotRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.SegmentBotRequest;
import com.example.botfight.service.simulation.SimulationRequest.SegmentRequest;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The request and response schemas of the simulator (shared/schemas/simulation-*.schema.json) have to fit what
 * Spring sends to the worker: SimulationRequest records and native one-second worker replay batches.
 */
class SimulationSchemasTest {

    private static final Path SCHEMAS = Path.of("..", "shared", "schemas");
    private static final Path FIXTURES = Path.of("..", "shared", "brain-tests", "valid");

    private final JsonMapper mapper = new JsonMapper();
    private final SchemaRegistry registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
            builder -> builder.schemaIdResolvers(ids -> ids.mapPrefix("https://botfight.dev/schemas/", "classpath:schemas/")));
    private final Schema requestSchema = load("simulation-request.schema.json");
    private final Schema responseSchema = load("simulation-response.schema.json");

    private Schema load(String name) {
        try {
            return registry.getSchema(Files.readString(SCHEMAS.resolve(name)), InputFormat.JSON);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }

    private JsonNode brain(String fixture) throws IOException {
        return mapper.readTree(Files.readString(FIXTURES.resolve(fixture + ".json"))).get("brain");
    }

    private JsonNode json(Object value) {
        return mapper.valueToTree(value);
    }

    private List<String> errors(Schema schema, JsonNode document) {
        return schema.validate(document).stream()
                .map(error -> error.getInstanceLocation() + ": " + error.getMessage())
                .toList();
    }

    @Test
    void aTimedRoundsMatchRequestValidates() throws IOException {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        JsonNode walk = brain("walk-and-loadout");
        DuelSimulationRequest request = new DuelSimulationRequest(
                UUID.randomUUID(), "duel-v2", -4_611_686_018_427_387_904L,
                new DuelArenaRequest(1_200, 1_200, 120_000),
                List.of(new DuelBotRequest(a, "alice", 1, 300, 600, 90.0, 60, "melee", walk, null, 1),
                        new DuelBotRequest(b, "bob", 2, 900, 600, 270.0, 60, "custom", brain("empty"), null, 2)),
                List.of(new SegmentRequest(20_000, List.of()),
                        new SegmentRequest(40_000, List.of(
                                new SegmentBotRequest(1, "melee", walk, List.of()),
                                new SegmentBotRequest(2, "custom", brain("lead-aim"), List.of("custom.count"))))),
                20_000);
        assertThat(errors(requestSchema, json(request))).isEmpty();
    }

    @Test
    void aPuzzleRequestWithStartingHpAndNoSegmentsValidates() throws IOException {
        DuelSimulationRequest request = new DuelSimulationRequest(
                UUID.randomUUID(), "duel-v2", 7L, new DuelArenaRequest(1_200, 1_200, 30_000, 5_000),
                List.of(new DuelBotRequest(UUID.randomUUID(), "Puzzle Blue 1", 1, 100.5, 200.5, 0.0, 60, "melee",
                        brain("custom-variables-and-actions"), 150.0, 1)));
        assertThat(errors(requestSchema, json(request))).isEmpty();
    }

    @Test
    void aRequestWithAnInvalidBrainOrAnUnknownFieldIsRejected() throws IOException {
        DuelSimulationRequest request = new DuelSimulationRequest(UUID.randomUUID(), "duel-v2", 1L,
                new DuelArenaRequest(1_200, 1_200, 30_000),
                List.of(new DuelBotRequest(UUID.randomUUID(), "x", 1, 0, 0, null, 60, "melee", brain("empty"))));
        ObjectNode document = (ObjectNode) json(request);
        assertThat(errors(requestSchema, document)).isEmpty();

        ObjectNode unknown = document.deepCopy();
        unknown.put("script", "eval()");
        assertThat(errors(requestSchema, unknown)).isNotEmpty();

        ObjectNode badBrain = document.deepCopy();
        ((ObjectNode) badBrain.get("bots").get(0).get("brain")).put("extra", 1);
        assertThat(errors(requestSchema, badBrain)).isNotEmpty();

        ObjectNode badRuleset = document.deepCopy();
        badRuleset.put("rulesetVersion", "duel-v9");
        assertThat(errors(requestSchema, badRuleset)).isNotEmpty();

        ObjectNode noArena = document.deepCopy();
        noArena.remove("arena");
        assertThat(errors(requestSchema, noArena)).isNotEmpty();
    }

    @Test
    void theBatchesOfTheReplayServiceFitTheResponseSchema() {
        var playback = WorkerReplayFixtures.replay("CONTINUES",null,null,
                "SEGMENT_END",List.of(),IntStream.rangeClosed(0,25).map(i->i*100).boxed().toList());
        var prepared = new MatchReplayService().prepareBatches(playback);
        assertThat(prepared).hasSize(3);

        ObjectNode response = mapper.createObjectNode();
        ObjectNode result = response.putObject("result");
        result.put("engineVersion", "node-engine-1");
        result.put("outcome", "CONTINUES");
        result.put("endReason", "SEGMENT_END");
        result.putNull("winnerTeam");
        result.putArray("teamHp").addObject().put("teamNumber", 1).put("hp", 120.5);
        result.put("segmentEndMs", 2_500);
        ObjectNode replay = response.putObject("replay");
        replay.set("initialState", mapper.readTree(playback.workerReplay().initialState()));
        ArrayNode batches = replay.putArray("batches");
        for (PreparedReplayBatch batch : prepared) {
            ObjectNode node = batches.addObject();
            node.put("sequence", batch.playback().batchSequence());
            node.put("endMs", batch.playback().replayCursorElapsedMs());
            node.put("terminal", batch.terminalBatch());
            node.set("frames", mapper.readTree(batch.playback().workerReplay().frames()));
        }
        assertThat(errors(responseSchema, response)).isEmpty();
        assertThat(batches.get(2).get("terminal").asBoolean()).isTrue();

        ObjectNode ended = response.deepCopy();
        ((ObjectNode) ended.get("result")).put("outcome", "BOT_WIN").put("endReason", "KO").put("winnerTeam", 2);
        assertThat(errors(responseSchema, ended)).isEmpty();

        ObjectNode winnerWithoutOutcome = response.deepCopy();
        ((ObjectNode) winnerWithoutOutcome.get("result")).put("winnerTeam", 2);
        assertThat(errors(responseSchema, winnerWithoutOutcome)).isNotEmpty();

        ObjectNode extra = response.deepCopy();
        extra.put("debug", true);
        assertThat(errors(responseSchema, extra)).isNotEmpty();

        ObjectNode withoutTerminal = response.deepCopy();
        ((ObjectNode) withoutTerminal.get("replay").get("batches").get(0)).remove("terminal");
        assertThat(errors(responseSchema, withoutTerminal)).isNotEmpty();
    }
}
