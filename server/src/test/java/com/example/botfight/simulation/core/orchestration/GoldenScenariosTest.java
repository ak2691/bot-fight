package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.GoldenScenarioRunner.Result;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * Server half of the golden scenarios. Compares each scenario's combat log and per-tick state hashes with
 * shared/gameplay-tests/golden.server.json. After an intended gameplay change regenerate it with
 * {@code .\mvnw.cmd test -Dtest=GoldenScenariosTest -Dgolden.update=true} and review the golden diff.
 * The browser half is frontend/src/gameArena/testing/goldenScenarios.test.js.
 */
class GoldenScenariosTest {
    private static final Set<String> KINDS = Set.of("trigger", "effect", "status", "spawn", "phase", "removal", "stamina");

    private final JsonNode scenarioFile = GoldenScenarioRunner.readJson(GoldenScenarioRunner.scenarioFile());
    private final Map<String, Result> results = GoldenScenarioRunner.runAll(scenarioFile);

    @Test
    void scenariosMatchTheCommittedServerGolden() throws IOException {
        writeStateDump();
        Path goldenFile = GoldenScenarioRunner.serverGoldenFile();
        if (Boolean.parseBoolean(System.getProperty("golden.update", "false"))) {
            Files.writeString(goldenFile, GoldenScenarioRunner.formatGolden(results), StandardCharsets.UTF_8);
            return;
        }
        assertThat(Files.exists(goldenFile)).as("golden.server.json; regenerate with -Dgolden.update=true").isTrue();
        JsonNode golden = GoldenScenarioRunner.readJson(goldenFile).path("scenarios");
        assertThat(new TreeSet<>(golden.propertyNames())).isEqualTo(new TreeSet<>(results.keySet()));

        // Compare the re-parsed actual file so numbers and field order go through the same reader.
        JsonNode actual = GoldenScenarioRunner.MAPPER.readTree(GoldenScenarioRunner.formatGolden(results)).path("scenarios");
        List<String> failures = new ArrayList<>();
        for (String id : results.keySet()) {
            JsonNode expectedLog = golden.path(id).path("log");
            JsonNode actualLog = actual.path(id).path("log");
            if (!expectedLog.equals(actualLog)) failures.add(id + " combat log: " + firstDifference(expectedLog, actualLog));
            if (!golden.path(id).path("hashes").equals(actual.path(id).path("hashes"))) {
                failures.add(id + " state hashes differ");
            }
        }
        assertThat(failures).as("scenarios that differ from golden.server.json").isEmpty();
    }

    /**
     * With {@code -Dgolden.debug=<scenario-id>} (or {@code all}) writes the unhashed per-tick state lines of that scenario to
     * artifacts/golden-debug/server.<id>.txt, the counterpart of the browser's {@code npm run golden:dump}.
     */
    private void writeStateDump() throws IOException {
        String id = System.getProperty("golden.debug", "");
        if (id.isBlank()) return;
        List<String> ids = "all".equals(id) ? new ArrayList<>(results.keySet()) : List.of(id);
        Path dir = GoldenScenarioRunner.sharedDir().resolve("../../artifacts/golden-debug").normalize();
        Files.createDirectories(dir);
        for (String scenario : ids) {
            assertThat(results).as("golden.debug scenario id").containsKey(scenario);
            Files.writeString(dir.resolve("server." + scenario + ".txt"),
                    GoldenScenarioRunner.formatStateDump(results.get(scenario)), StandardCharsets.UTF_8);
        }
    }

    private static String firstDifference(JsonNode expected, JsonNode actual) {
        int size = Math.max(expected.size(), actual.size());
        for (int index = 0; index < size; index += 1) {
            if (!expected.path(index).equals(actual.path(index))) {
                return "entry " + index + " expected " + expected.path(index) + " but was " + actual.path(index);
            }
        }
        return "no difference";
    }

    @Test
    void everyAbilityTriggersInAtLeastOneScenario() {
        Set<Integer> triggered = new TreeSet<>();
        results.values().forEach(result -> result.log().stream()
                .filter(entry -> "trigger".equals(entry.kind()))
                .forEach(entry -> triggered.add(entry.abilityId())));
        List<Integer> missing = new ArrayList<>();
        for (int id = 1; id <= 37; id += 1) {
            if (id != 2 && !triggered.contains(id)) missing.add(id);
        }
        assertThat(missing).isEmpty();
    }

    @Test
    void logEntriesUseTheSharedVocabulary() {
        results.forEach((id, result) -> result.log().forEach(entry -> {
            assertThat(KINDS).as(id).contains(entry.kind());
            assertThat(CombatLog.STAGES).as(id).contains(entry.stage());
        }));
    }

    @Test
    void theLogIsOffUnlessRequestedAndNeverChangesTheResult() {
        JsonNode scenario = scenarioFile.path("scenarios").get(0);
        DuelSimulationService service = GoldenScenarioRunner.newService();
        Result logged = GoldenScenarioRunner.run(service, scenario);
        assertThat(logged.log()).isNotEmpty();
        assertThat(CombatLog.active()).as("no log stays bound after a run").isFalse();

        // The same run through the ordinary entry point records nothing and ends in the same state.
        List<String> quietHashes = new ArrayList<>();
        service.simulateWithoutReplay(GoldenScenarioRunner.requestFor(scenario), (elapsedMs, bots, entities, arena) -> {
            quietHashes.add(GoldenScenarioRunner.stateHash(bots, entities));
            return false;
        });
        assertThat(quietHashes).isEqualTo(logged.hashes());
    }

    @Test
    void simultaneousRunsKeepTheirLogsApart() throws Exception {
        JsonNode scenario = scenarioFile.path("scenarios").get(0);
        Result expected = results.get(scenario.path("id").asText());
        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        try {
            List<java.util.concurrent.Future<Result>> futures = new ArrayList<>();
            for (int run = 0; run < 8; run += 1) {
                futures.add(pool.submit(() -> GoldenScenarioRunner.run(GoldenScenarioRunner.newService(), scenario)));
            }
            for (var future : futures) assertThat(future.get().log()).isEqualTo(expected.log());
        } finally {
            pool.shutdownNow();
        }
    }
}
