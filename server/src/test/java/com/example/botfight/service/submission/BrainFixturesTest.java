package com.example.botfight.service.submission;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Classifies the shared brain fixtures ({@code shared/brain-tests/}) with Spring's schema check, the same way
 * the browser does: valid and "rules" brains pass the schema, "schema" brains fail it. The "rules" brains are
 * rejected by the shared brainRules.js, which the browser tests and the sim-worker's /validate test cover.
 */
class BrainFixturesTest {

    private static final Path FIXTURES = Path.of("..", "shared", "brain-tests");
    private static final List<String> LAYERS = List.of("schema", "rules");

    private final JsonMapper mapper = new JsonMapper();
    private final BrainSchemaValidator schema = new BrainSchemaValidator();

    private List<Path> files(String kind) throws IOException {
        try (Stream<Path> stream = Files.list(FIXTURES.resolve(kind))) {
            return stream.filter(path -> path.toString().endsWith(".json")).sorted().toList();
        }
    }

    @Test
    void validBrainsPassTheSchema() throws IOException {
        List<Path> files = files("valid");
        assertThat(files).isNotEmpty();
        List<String> failures = new ArrayList<>();
        for (Path file : files) {
            List<String> errors = schema.validate(brainForSchema(mapper.readTree(Files.readString(file))));
            if (!errors.isEmpty()) failures.add(file.getFileName() + " -> " + errors);
        }
        assertThat(failures).isEmpty();
    }

    @Test
    void invalidBrainsFailTheSchemaExactlyWhenTheirLayerIsSchema() throws IOException {
        List<Path> files = files("invalid");
        assertThat(files).hasSizeGreaterThan(20);
        List<String> failures = new ArrayList<>();
        for (Path file : files) {
            JsonNode fixture = mapper.readTree(Files.readString(file));
            String layer = fixture.path("layer").asString("");
            if (fixture.path("rule").asString("").isBlank()) failures.add(file.getFileName() + " names no rule");
            if (!LAYERS.contains(layer)) failures.add(file.getFileName() + " has layer " + layer);
            boolean schemaRejects = !schema.validate(brainForSchema(fixture)).isEmpty();
            if (schemaRejects != "schema".equals(layer)) failures.add(file.getFileName() + " schemaRejects=" + schemaRejects + " but layer=" + layer);
        }
        assertThat(failures).isEmpty();
    }
    /** The worker's puzzle adapter removes only root kind and supplies N/A for an actionless branch. */
    private JsonNode brainForSchema(JsonNode fixture) {
        JsonNode brain = fixture.get("brain").deepCopy();
        if (!fixture.path("options").path("puzzleRules").asBoolean(false)) return brain;
        for (JsonNode root : brain.path("roots")) {
            if (!(root instanceof tools.jackson.databind.node.ObjectNode object)) continue;
            object.remove("kind");
            for (JsonNode branch : root.path("branches")) {
                if (branch instanceof tools.jackson.databind.node.ObjectNode fields
                        && !fields.has("action") && !fields.has("actions")) fields.put("action", "none");
            }
        }
        return brain;
    }
}
