package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import java.util.UUID;

class RootOrphanValidationTest {
    private final JsonMapper mapper = new JsonMapper();
    private List<String> errors(String roots, String orphans) {
        var payload = new BotSubmissionPayloadDTO();
        payload.setMatchId(UUID.randomUUID()); payload.setRoundNumber(1); payload.setPhase("BUILDING");
        payload.setSelectedLoadout("melee"); payload.setClientBuildVersion("test");
        payload.setBrain(mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"loadout\":{\"abilities\":[]},\"roots\":" + roots + ",\"orphans\":" + orphans + "}"));
        return new BotSubmissionValidationService(mapper, new GameConfigCatalog()).validate(payload).getErrors();
    }
    @Test void acceptsRootActionsAndOrphanSubtrees() {
        assertThat(errors("[{\"priority\":1,\"branches\":[],\"actions\":[{\"action\":\"move_walk\"}]}]",
            "[{\"id\":\"loose\",\"kind\":\"conditional\",\"conditions\":[{\"type\":\"always\"}],\"actions\":[{\"action\":\"move_walk\"}],\"children\":[]}]" )).isEmpty();
    }
    @Test void rejectsInvalidOrphansAndMissingChainReferences() {
        assertThat(errors("[]", "[{\"id\":\"a\",\"kind\":\"action\",\"action\":\"eval\"}]")).isNotEmpty();
        assertThat(errors("[]", "[{\"id\":\"a\",\"kind\":\"action\",\"action\":\"run_chain\",\"chainId\":\"chain.missing\"}]")).anyMatch(e -> e.contains("does not exist"));
        assertThat(errors("[]", "[{\"id\":\"a\",\"kind\":\"other\"}]")).isNotEmpty();
    }
    @Test void rootAndOrphanActionsShareTheBudget() {
        var nodes = java.util.stream.IntStream.range(0, 101).mapToObj(i -> "{\"id\":\"a"+i+"\",\"kind\":\"action\",\"action\":\"move_walk\"}").collect(java.util.stream.Collectors.joining(","));
        assertThat(errors("[]", "["+nodes+"]")).anyMatch(e -> e.contains("action node limit"));
    }
    @Test void orphanConditionsShareTheConditionBudgetAndUseTheAllowlist() {
        var nodes = java.util.stream.IntStream.range(0, 301).mapToObj(i -> "{\"id\":\"c"+i+"\",\"kind\":\"conditional\",\"conditions\":[{\"type\":\"always\"}],\"actions\":[{\"action\":\"none\"}],\"children\":[]}").collect(java.util.stream.Collectors.joining(","));
        assertThat(errors("[]", "["+nodes+"]")).anyMatch(e -> e.contains("condition limit") || e.contains("condition slots"));
        assertThat(errors("[]", "[{\"id\":\"c\",\"kind\":\"conditional\",\"conditions\":[{\"type\":\"eval\"}],\"actions\":[{\"action\":\"none\"}],\"children\":[]}]")).isNotEmpty();
        assertThat(errors("[]", "[{\"id\":\"a\",\"kind\":\"action\",\"action\":\"move_walk\",\"children\":[]}]")).anyMatch(e -> e.contains("subtree"));
    }

}
