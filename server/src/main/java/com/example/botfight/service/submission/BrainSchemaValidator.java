package com.example.botfight.service.submission;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * Checks a submitted brain against the shared JSON Schema ({@code shared/schemas/brain.schema.json}, copied to
 * the classpath as {@code schemas/}). The schema is the only definition of a structurally valid brain: types,
 * closed lists, bounds, and which fields each condition and action may carry. Rules a schema cannot express
 * (depth, totals, cross-references) stay in {@link BotSubmissionValidationService}.
 * The schema is loaded and compiled once, at startup.
 */
@Component
public class BrainSchemaValidator {

    public static final String BRAIN_SCHEMA_PATH = "schemas/brain.schema.json";

    private final Schema schema;

    public BrainSchemaValidator() {
        this.schema = load(BRAIN_SCHEMA_PATH);
    }

    static Schema load(String classpathLocation) {
        try (InputStream stream = new ClassPathResource(classpathLocation).getInputStream()) {
            return SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12).getSchema(stream);
        } catch (IOException ex) {
            throw new UncheckedIOException("Cannot load " + classpathLocation, ex);
        }
    }

    /** Returns one message per violation, each starting with its JSON path (for example {@code brain.roots[0].name}). */
    public List<String> validate(JsonNode brain) {
        return validate(schema, brain, "brain");
    }

    static List<String> validate(Schema schema, JsonNode document, String rootName) {
        record Violation(String path, String keyword, String message) {}
        List<Violation> violations = new ArrayList<>();
        // NaN and Infinity are not JSON; the validator library cannot compare them, so reject them up front.
        List<String> nonFinite = new ArrayList<>();
        collectNonFinite(document, rootName, nonFinite);
        if (!nonFinite.isEmpty()) return nonFinite;
        for (Error error : schema.validate(document)) {
            String path = rootName + dotted(error.getInstanceLocation().toString());
            String message = error.getMessage();
            String prefix = error.getInstanceLocation() + ": ";
            if (message.startsWith(prefix)) message = message.substring(prefix.length());
            violations.add(new Violation(path, error.getKeyword(), message));
        }
        // A subschema that fails leaves its properties "unevaluated"; that echo is noise next to the real error,
        // so it is only reported when nothing else is wrong at or below the same place.
        List<String> messages = new ArrayList<>();
        for (Violation violation : violations) {
            boolean echo = "unevaluatedProperties".equals(violation.keyword());
            if (echo && violations.stream().anyMatch(other -> !"unevaluatedProperties".equals(other.keyword())
                    && isAtOrBelow(other.path(), violation.path()))) {
                continue;
            }
            messages.add(violation.path() + ": " + violation.message());
        }
        return messages;
    }

    private static void collectNonFinite(JsonNode node, String path, List<String> out) {
        if (node.isNumber()) {
            if (!Double.isFinite(node.doubleValue())) out.add(path + ": must be a finite number");
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) collectNonFinite(node.get(i), path + "[" + i + "]", out);
        } else if (node.isObject()) {
            node.properties().forEach(entry -> collectNonFinite(entry.getValue(), path + "." + entry.getKey(), out));
        }
    }

    private static boolean isAtOrBelow(String path, String ancestor) {
        return path.equals(ancestor) || path.startsWith(ancestor + ".") || path.startsWith(ancestor + "[");
    }

    /** Turns a JSON pointer ({@code /roots/0/name}) into {@code .roots[0].name}. */
    static String dotted(String pointer) {
        StringBuilder out = new StringBuilder();
        for (String segment : pointer.split("/")) {
            if (segment.isEmpty()) continue;
            out.append(segment.chars().allMatch(Character::isDigit) ? "[" + segment + "]" : "." + segment);
        }
        return out.toString();
    }
}
