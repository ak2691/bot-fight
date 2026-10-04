package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** Server mirror of the browser's ChainRuntime.test.js validation cases: same brains, same rejections. */
class ChainValidationTest {
    private static final String ALWAYS = "[{\"type\":\"always\"}]";
    private final JsonMapper jsonMapper = new JsonMapper();
    private final BotSubmissionValidationService service = new BotSubmissionValidationService(
            jsonMapper, new GameConfigCatalog());

    private static String chain(String slug, String steps) {
        return "{\"id\":\"chain." + slug + "\",\"name\":\"" + slug + "\",\"steps\":[" + steps + "]}";
    }

    private static String walk(String extra) {
        return "{\"type\":\"action\",\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90,\"forMs\":100" + extra + "}";
    }

    private static String call(String slug) {
        return "{\"type\":\"runChain\",\"chainId\":\"chain." + slug + "\"}";
    }

    private List<String> errors(String chains, String roots) throws Exception {
        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setMatchId(java.util.UUID.fromString("11111111-1111-1111-1111-111111111111"));
        payload.setRoundNumber(1);
        payload.setPhase("BUILDING");
        payload.setSelectedLoadout("melee");
        payload.setClientBuildVersion("test");
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"loadout\":{\"abilities\":[]},\"roots\":"
                + roots + ",\"chains\":" + chains + "}"));
        return service.validate(payload).getErrors();
    }

    private List<String> errors(String chains) throws Exception {
        return errors(chains, "[]");
    }

    private void assertRejected(String label, List<String> errors, String fragment) {
        assertThat(errors).as(label).anyMatch(error -> error.contains(fragment));
    }

    @Test
    void acceptsAWellFormedChainBrain() throws Exception {
        String chains = "[" + chain("a", call("b") + ",{\"type\":\"repeat\",\"count\":2,\"steps\":[{\"type\":\"repeat\","
                + "\"whileConditions\":" + ALWAYS + ",\"maxMs\":500,\"steps\":[{\"type\":\"wait\",\"forMs\":100}]}]}")
                + "," + chain("b", walk("")) + "]";
        String roots = "[{\"priority\":1,\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":" + ALWAYS
                + ",\"actions\":[{\"action\":\"run_chain\",\"chainId\":\"chain.a\"}],\"children\":[]}]}]";
        assertThat(errors(chains, roots)).isEmpty();
    }

    @Test
    void rejectsTheChainBounds() throws Exception {
        String endSteps = IntStream.range(0, 33).mapToObj(index -> "{\"type\":\"end\"}").collect(Collectors.joining(","));
        String nestedSteps = IntStream.range(0, 32).mapToObj(index -> "{\"type\":\"end\"}").collect(Collectors.joining(","));
        List<String> manyChains = new ArrayList<>();
        for (int index = 0; index < 17; index += 1) manyChains.add(chain("c" + index, ""));
        assertRejected("chain count", errors("[" + String.join(",", manyChains) + "]"), "exceeds the limit of 16 chains");
        assertRejected("step count", errors("[" + chain("a", endSteps) + "]"), "has 33 steps");
        assertRejected("nested step count",
                errors("[" + chain("a", "{\"type\":\"repeat\",\"count\":1,\"steps\":[" + nestedSteps + "]}") + "]"), "has 33 steps");
        assertRejected("repeat count", errors("[" + chain("a", "{\"type\":\"repeat\",\"count\":21,\"steps\":[]}") + "]"),
                "count must be a whole number from 1 to 20");
        assertRejected("repeat count of zero", errors("[" + chain("a", "{\"type\":\"repeat\",\"count\":0,\"steps\":[]}") + "]"),
                "count must be a whole number");
        assertRejected("wait not a multiple of 100", errors("[" + chain("a", "{\"type\":\"wait\",\"forMs\":150}") + "]"), "multiple of 100");
        assertRejected("wait too long", errors("[" + chain("a", "{\"type\":\"wait\",\"forMs\":10100}") + "]"), "multiple of 100 from 100 to 10000");
        assertRejected("wait of zero", errors("[" + chain("a", "{\"type\":\"wait\",\"forMs\":0}") + "]"), "multiple of 100");
        assertRejected("until without a max",
                errors("[" + chain("a", "{\"type\":\"wait\",\"untilConditions\":" + ALWAYS + "}") + "]"), "maxMs");
        assertRejected("walk without a duration", errors("[" + chain("a",
                "{\"type\":\"action\",\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90}") + "]"), "forMs");
        assertRejected("loop nesting", errors("[" + chain("a", "{\"type\":\"repeat\",\"count\":1,\"steps\":[{\"type\":\"repeat\",\"count\":1,"
                + "\"steps\":[{\"type\":\"repeat\",\"count\":1,\"steps\":[]}]}]}") + "]"), "nests loops deeper than 2");
        assertRejected("unknown step type", errors("[" + chain("a", "{\"type\":\"teleport\"}") + "]"), "unknown step type");
        assertRejected("missing chain reference", errors("[" + chain("a", call("nope")) + "]"), "does not exist");
        assertRejected("chain control inside a chain step",
                errors("[" + chain("a", "{\"type\":\"action\",\"action\":\"run_chain\",\"chainId\":\"chain.a\"}") + "]"), "cannot be run by a chain");
        assertRejected("root run_chain to a missing chain", errors("[]", "[{\"priority\":1,\"branches\":[{\"priority\":1,\"branchType\":\"if\","
                + "\"conditions\":" + ALWAYS + ",\"actions\":[{\"action\":\"run_chain\",\"chainId\":\"chain.nope\"}],\"children\":[]}]}]"),
                "runs a chain that does not exist");
        assertRejected("invalid chain id", errors("[{\"id\":\"Bad Id\",\"name\":\"x\",\"steps\":[]}]"), ".id is invalid");
        assertRejected("duplicate chain id", errors("[" + chain("a", "") + "," + chain("a", "") + "]"), "repeats chain.a");
    }

    @Test
    void rejectsCallCyclesAndCallsNestedDeeperThanThreeLevels() throws Exception {
        assertRejected("self call", errors("[" + chain("a", call("a")) + "]"), "cycle");
        assertRejected("two chain cycle", errors("[" + chain("a", call("b")) + "," + chain("b", call("a")) + "]"), "cycle");
        assertThat(errors("[" + chain("a", call("b")) + "," + chain("b", call("c")) + "," + chain("c", "") + "]")).isEmpty();
        assertRejected("four levels", errors("[" + chain("a", call("b")) + "," + chain("b", call("c")) + ","
                + chain("c", call("d")) + "," + chain("d", "") + "]"), "3 levels deep");
    }

    @Test
    void conditionalBodiesRequireAdjacentAlternativesAndCancellationIsRemoved() throws Exception {
        String first = "{\"type\":\"if\",\"conditions\":[],\"steps\":[]}";
        String alternate = "{\"type\":\"elseIf\",\"conditions\":[],\"steps\":[]}";
        assertThat(errors("[" + chain("a", first + "," + alternate + "," + alternate) + "]")).isEmpty();
        assertRejected("orphan alternative", errors("[" + chain("a", alternate) + "]"), "directly follow");
        assertRejected("separated alternative", errors("[" + chain("a", first + "," + walk("") + "," + alternate) + "]"), "directly follow");
        assertRejected("missing body", errors("[" + chain("a", "{\"type\":\"if\",\"conditions\":[]}") + "]"), ".steps");
        assertRejected("removed cancellation", errors("[" + chain("a", "{\"type\":\"cancelChain\"}") + "]"), "unknown step type");
    }

    @Test
    void chainStepsCountTowardTheBrainBudgets() throws Exception {
        // 4 chains x 25 steps = 100 action slots by themselves, so a single walk root pushes the brain over the limit.
        String steps = IntStream.range(0, 25).mapToObj(index -> "{\"type\":\"end\"}").collect(Collectors.joining(","));
        String chains = "[" + chain("a", steps) + "," + chain("b", steps) + "," + chain("c", steps) + "," + chain("d", steps) + "]";
        String root = "[{\"priority\":1,\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":[],"
                + "\"actions\":[{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90}],\"children\":[]}]}]";
        assertThat(errors(chains, "[]")).isEmpty();
        assertRejected("action budget", errors(chains, root), "actions exceed the action node limit");
    }

    private static String chainWithLoose(String slug, String steps, String loose) {
        return "{\"id\":\"chain." + slug + "\",\"name\":\"" + slug + "\",\"steps\":[" + steps + "],\"loose\":" + loose + "}";
    }

    private static String looseEntry(String step) {
        return "{\"x\":120.5,\"y\":300,\"step\":" + step + "}";
    }

    @Test
    void looseBlocksAreValidatedLikeStepsAndCountTowardTheLimit() throws Exception {
        String alternate = "{\"type\":\"elseIf\",\"conditions\":[],\"steps\":[]}";
        assertThat(errors("[" + chainWithLoose("a", walk(""), "[" + looseEntry(walk("")) + "," + looseEntry(alternate) + "]") + "]")).isEmpty();
        assertThat(errors("[" + chain("a", walk("")) + "]")).as("chains without loose are unchanged").isEmpty();
        assertRejected("not an array", errors("[" + chainWithLoose("a", "", "{}") + "]"), "loose must be an array");
        assertRejected("bad step", errors("[" + chainWithLoose("a", "", "[" + looseEntry("{\"type\":\"bogus\"}") + "]") + "]"), "unknown step type");
        assertRejected("bad duration", errors("[" + chainWithLoose("a", "", "[" + looseEntry("{\"type\":\"wait\",\"forMs\":150}") + "]") + "]"), "multiple of 100");
        assertRejected("missing coordinates", errors("[" + chainWithLoose("a", "", "[{\"step\":{\"type\":\"end\"}}]") + "]"), ".x must be a number");
        assertRejected("huge coordinate", errors("[" + chainWithLoose("a", "", "[{\"x\":2000000,\"y\":1,\"step\":{\"type\":\"end\"}}]") + "]"), ".x must be a number");
        assertRejected("dangling call", errors("[" + chainWithLoose("a", "", "[" + looseEntry(call("missing")) + "]") + "]"), "does not exist");
        String endSteps = IntStream.range(0, 30).mapToObj(index -> "{\"type\":\"end\"}").collect(Collectors.joining(","));
        String looseEnds = IntStream.range(0, 3).mapToObj(index -> looseEntry("{\"type\":\"end\"}")).collect(Collectors.joining(","));
        assertRejected("shared step limit", errors("[" + chainWithLoose("a", endSteps, "[" + looseEnds + "]") + "]"), "has 33 steps");
        String manyLoose = IntStream.range(0, 33).mapToObj(index -> looseEntry("{\"type\":\"end\"}")).collect(Collectors.joining(","));
        assertRejected("loose limit", errors("[" + chainWithLoose("a", "", "[" + manyLoose + "]") + "]"), "loose blocks");
    }

    @Test
    void looseBlocksCountTowardTheBrainBudgets() throws Exception {
        String steps = IntStream.range(0, 13).mapToObj(index -> "{\"type\":\"end\"}").collect(Collectors.joining(","));
        String loose = "[" + IntStream.range(0, 12).mapToObj(index -> looseEntry("{\"type\":\"end\"}")).collect(Collectors.joining(",")) + "]";
        String chains = "[" + chainWithLoose("a", steps, loose) + "," + chainWithLoose("b", steps, loose) + ","
                + chainWithLoose("c", steps, loose) + "," + chainWithLoose("d", steps, loose) + "]";
        String root = "[{\"priority\":1,\"branches\":[{\"priority\":1,\"branchType\":\"if\",\"conditions\":[],"
                + "\"actions\":[{\"action\":\"move_walk\",\"movementMode\":\"absolute\",\"movementDirection\":90}],\"children\":[]}]}]";
        assertThat(errors(chains, "[]")).isEmpty();
        assertRejected("action budget", errors(chains, root), "actions exceed the action node limit");
    }
}
