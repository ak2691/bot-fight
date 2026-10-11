package com.example.botfight.simulation.core.orchestration;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.GameplayData;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import com.example.botfight.simulation.core.state.LegacyAbility;

/**
 * Runs the shared golden scenarios (shared/gameplay-tests/goldenScenarios.json) through the authoritative
 * simulation and returns, per scenario, the combat log and a per-tick hash of the bot and entity state.
 * The browser does the same in goldenScenarioRunner.js; the two runtimes keep separate golden files.
 */
final class GoldenScenarioRunner {
    static final JsonMapper MAPPER = new JsonMapper();

    record Result(List<CombatLog.Entry> log, List<String> hashes, List<List<String>> states) {
    }

    private GoldenScenarioRunner() {
    }

    static Path sharedDir() {
        for (Path candidate : List.of(Path.of("..", "shared", "gameplay-tests"), Path.of("shared", "gameplay-tests"))) {
            if (Files.isDirectory(candidate)) return candidate;
        }
        throw new IllegalStateException("shared/gameplay-tests not found from " + Path.of("").toAbsolutePath());
    }

    static Path scenarioFile() {
        return sharedDir().resolve("goldenScenarios.json");
    }

    static Path serverGoldenFile() {
        return sharedDir().resolve("golden.server.json");
    }

    static JsonNode readJson(Path file) {
        try {
            return MAPPER.readTree(Files.readString(file, StandardCharsets.UTF_8));
        } catch (IOException ex) {
            throw new IllegalStateException("cannot read " + file, ex);
        }
    }

    static DuelSimulationService newService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actions = new ActionExecutionService(botStateService);
        return new DuelSimulationService(
                new ConditionResolutionService(new ConditionEvaluationService(), actions),
                new ReplayMappingService(), botStateService, actions);
    }

    static Map<String, Result> runAll(JsonNode file) {
        DuelSimulationService service = newService();
        Map<String, Result> results = new LinkedHashMap<>();
        for (JsonNode scenario : file.path("scenarios")) {
            results.put(scenario.path("id").asText(), run(service, scenario));
        }
        return results;
    }

    static DuelSimulationRequest requestFor(JsonNode scenario) {
        int ticks = scenario.path("ticks").asInt();
        List<DuelBotRequest> bots = new ArrayList<>();
        for (JsonNode spec : scenario.path("bots")) {
            int slot = spec.path("slot").asInt();
            ObjectNode brain = MAPPER.createObjectNode();
            brain.put("version", "bot-logic-tree-v1");
            brain.putObject("loadout").set("abilities", spec.path("abilities").deepCopy());
            brain.set("roots", spec.path("roots").deepCopy());
            bots.add(new DuelBotRequest(
                    UUID.nameUUIDFromBytes(("golden-" + slot).getBytes(StandardCharsets.UTF_8)), "bot" + slot, slot,
                    spec.path("x").asDouble(), spec.path("y").asDouble(), spec.path("rotation").asDouble(), 60,
                    "custom", brain, spec.hasNonNull("hp") ? spec.path("hp").asDouble() : null, slot));
        }
        return new DuelSimulationRequest(
                UUID.nameUUIDFromBytes(scenario.path("id").asText().getBytes(StandardCharsets.UTF_8)),
                DuelSimulationService.DUEL_RULESET_VERSION, 1L, new DuelArenaRequest(1200, 1200, ticks * 100),
                bots);
    }

    /**
     * Runs one scenario. A scenario may carry {@code testAbilities}: abilities written in the abilities.json schema
     * that replace the shipped ones of the same id for this run (the browser swaps them in the same way).
     */
    static Result run(DuelSimulationService service, JsonNode scenario) {
        List<GameplayData.AbilityData> testAbilities = new ArrayList<>();
        for (JsonNode ability : scenario.path("testAbilities")) {
            testAbilities.add(GameplayData.parseAbility(ability.toString()));
        }
        return AbilityContracts.withTestAbilities(testAbilities, () -> runFight(service, scenario));
    }

    private static Result runFight(DuelSimulationService service, JsonNode scenario) {
        DuelSimulationRequest request = requestFor(scenario);
        CombatLog log = new CombatLog();
        List<String> hashes = new ArrayList<>();
        List<List<String>> states = new ArrayList<>();
        service.simulateLogged(request, log, (elapsedMs, tickBots, entities, arena) -> {
            List<String> lines = stateLines(tickBots, entities);
            states.add(lines);
            hashes.add(fnv1a(String.join("\n", lines)));
            return false;
        });
        return new Result(List.copyOf(log.entries()), List.copyOf(hashes), List.copyOf(states));
    }

    /** Three decimals, never "-0.000". Same rule as the browser's fixed() in goldenScenarioRunner.js. */
    private static String fixed(double value) {
        double number = Double.isFinite(value) ? value : 0.0;
        String text = String.format(Locale.ROOT, "%.3f", Math.round(number * 1000.0) / 1000.0);
        return "-0.000".equals(text) ? "0.000" : text;
    }

    /** FNV-1a over the string's characters (the state strings are ASCII). */
    static String fnv1a(String text) {
        int hash = 0x811c9dc5;
        for (int index = 0; index < text.length(); index += 1) {
            hash = (hash ^ text.charAt(index)) * 0x01000193;
        }
        return String.format(Locale.ROOT, "%08x", hash);
    }

    /** Runtime-neutral entity id: the browser builds "<type>-<botId>-<n>", the server "ability-<botUuid>-<n>". */
    private static String canonicalEntityId(ArenaEntity entity) {
        String id = entity.id();
        int dash = id.lastIndexOf('-');
        String tail = dash >= 0 && dash + 1 < id.length() && id.substring(dash + 1).chars().allMatch(Character::isDigit)
                ? id.substring(dash + 1) : id;
        return entity.type() + "-s" + entity.ownerSlot() + "-" + tail;
    }

    /**
     * The text that gets hashed, one line per bot (by slot) then per ability entity (by id):
     * {@code b<slot>|x|y|rotation|hp|stamina|preparingAbilityId-or--|preparingMs|<type>:<roundedRemainingMs>,...}
     * and {@code e|<type>-s<ownerSlot>-<serial>|<type>|x|y|hp}. Must match stateLines in the browser's goldenScenarioRunner.js.
     */
    static List<String> stateLines(List<Bot> bots, List<ArenaEntity> entities) {
        List<String> lines = new ArrayList<>();
        bots.stream().sorted(Comparator.comparingInt(bot -> bot.slot)).forEach(bot -> lines.add(String.join("|",
                "b" + bot.slot, fixed(bot.x), fixed(bot.y), fixed(bot.rotation), fixed(bot.hp), fixed(bot.stamina),
                LegacyAbility.preparingAbility(bot) == null ? "-" : String.valueOf(LegacyAbility.preparingAbility(bot)), fixed(LegacyAbility.preparingMs(bot)),
                bot.statusEffects.values().stream()
                        .map(status -> status.type + ":" + Math.round((double) status.remainingMs))
                        .sorted().collect(Collectors.joining(",")))));
        entities.stream().sorted(Comparator.comparing(GoldenScenarioRunner::canonicalEntityId)).forEach(entity -> lines.add(String.join("|",
                "e", canonicalEntityId(entity), entity.type(), fixed(entity.x()), fixed(entity.y()), fixed(entity.hp()))));
        return lines;
    }

    static String stateHash(List<Bot> bots, List<ArenaEntity> entities) {
        return fnv1a(String.join("\n", stateLines(bots, entities)));
    }

    /** Debug text for one scenario: a "# tick N hash" header then the unhashed state lines, per tick. */
    static String formatStateDump(Result result) {
        StringBuilder out = new StringBuilder();
        for (int tick = 0; tick < result.states().size(); tick += 1) {
            out.append("# tick ").append(tick + 1).append(' ').append(result.hashes().get(tick)).append("\n");
            result.states().get(tick).forEach(line -> out.append(line).append("\n"));
        }
        return out.toString();
    }

    /** Same layout as the browser's goldenFormat.js: one combat-log entry per line. */
    static String formatGolden(Map<String, Result> results) {
        StringBuilder out = new StringBuilder("{\n  \"version\": 1,\n  \"runtime\": \"server\",\n  \"scenarios\": {\n");
        int index = 0;
        for (Map.Entry<String, Result> scenario : results.entrySet()) {
            out.append("    ").append(MAPPER.writeValueAsString(scenario.getKey())).append(": {\n");
            out.append("      \"hashes\": ").append(MAPPER.writeValueAsString(scenario.getValue().hashes())).append(",\n");
            out.append("      \"log\": [");
            List<CombatLog.Entry> log = scenario.getValue().log();
            for (int line = 0; line < log.size(); line += 1) {
                out.append(line == 0 ? "\n" : ",\n").append("        ").append(MAPPER.writeValueAsString(log.get(line)));
            }
            out.append(log.isEmpty() ? "]\n" : "\n      ]\n").append("    }");
            out.append(++index < results.size() ? ",\n" : "\n");
        }
        return out.append("  }\n}\n").toString();
    }
}
