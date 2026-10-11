package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.bots.BrainNormalizer;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Linked actions: the same action saved once per parent, sharing a linkId and costing one action. */
class LinkedActionsTest {
    private final JsonMapper mapper = new JsonMapper();

    private JsonNode brain(String roots) {
        return mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"loadout\":{\"abilities\":[]},\"roots\":" + roots + "}");
    }

    private List<String> errors(String roots) {
        var payload = new BotSubmissionPayloadDTO();
        payload.setMatchId(UUID.randomUUID()); payload.setRoundNumber(1); payload.setPhase("BUILDING");
        payload.setSelectedLoadout("melee"); payload.setClientBuildVersion("test");
        payload.setBrain(brain(roots));
        return new BotSubmissionValidationService(mapper, new GameConfigCatalog()).validate(payload).getErrors();
    }

    /** One root with `count` conditionals; action(i) is the JSON of the single action under conditional i. */
    private String copies(int count, java.util.function.IntFunction<String> action) {
        String branches = IntStream.range(0, count)
                .mapToObj(i -> "{\"id\":\"b" + i + "\",\"conditions\":[{\"type\":\"always\"}],\"actions\":[" + action.apply(i) + "],\"children\":[]}")
                .collect(Collectors.joining(","));
        return "[{\"id\":\"r\",\"branches\":[" + branches + "]}]";
    }

    private static String linked(int i, String linkId) {
        return "{\"id\":\"a" + i + "\",\"linkId\":\"" + linkId + "\",\"action\":\"move_walk\"}";
    }

    @Test void acceptsAValidLinkId() {
        assertThat(errors(copies(2, i -> linked(i, "link-abc_123")))).isEmpty();
    }

    @Test void rejectsLinkIdsThatAreTooLongOrMalformed() {
        assertThat(errors(copies(1, i -> linked(i, "x".repeat(41))))).anyMatch(e -> e.contains("linkId"));
        assertThat(errors(copies(1, i -> linked(i, "bad id!")))).anyMatch(e -> e.contains("linkId"));
        assertThat(errors(copies(1, i -> "{\"id\":\"a\",\"linkId\":7,\"action\":\"move_walk\"}"))).anyMatch(e -> e.contains("linkId"));
        assertThat(errors(copies(1, i -> "{\"id\":\"a\",\"linkId\":\"\",\"action\":\"move_walk\"}"))).anyMatch(e -> e.contains("linkId"));
    }

    @Test void identicalLinkedCopiesCountAsOneAction() {
        assertThat(errors(copies(101, i -> linked(i, "L")))).isEmpty();
    }

    @Test void copiesWithTheSameLinkIdButDifferentContentCountSeparately() {
        // 100 identical copies cost one action; the one differing copy costs another.
        String roots = copies(101, i -> i == 100
                ? "{\"id\":\"a100\",\"linkId\":\"L\",\"action\":\"move_walk\",\"sprint\":true}" : linked(i, "L"));
        assertThat(errors(roots)).isEmpty();
        // Without links the same 101 actions overflow the limit.
        assertThat(errors(copies(101, i -> "{\"id\":\"a" + i + "\",\"action\":\"move_walk\"}")))
                .contains("brain tree actions exceed the action node limit");
        // Copies that share a linkId but each differ are not merged, so they overflow too.
        String mismatched = copies(101, i -> "{\"id\":\"a" + i + "\",\"linkId\":\"L\",\"action\":\"move_walk\",\"targetOffsetX\":" + i + "}");
        assertThat(errors(mismatched)).contains("brain tree actions exceed the action node limit");
    }

    @Test void theNormalizerRunsEveryLinkedCopyAndChargesThemOnce() {
        BrainNormalizer.Result result = BrainNormalizer.normalize(brain(copies(101, i -> linked(i, "L"))));
        long executable = result.roots().get(0).branches().stream()
                .filter(branch -> !"none".equals(branch.blocks().get(0).action())).count();
        assertThat(executable).isEqualTo(101);

        BrainNormalizer.Result unlinked = BrainNormalizer.normalize(brain(copies(101, i -> "{\"id\":\"a" + i + "\",\"action\":\"move_walk\"}")));
        long kept = unlinked.roots().get(0).branches().stream()
                .filter(branch -> !"none".equals(branch.blocks().get(0).action())).count();
        assertThat(kept).isEqualTo(100);
    }
}
