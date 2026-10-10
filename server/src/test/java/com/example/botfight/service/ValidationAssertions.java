package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

/**
 * Brain validation errors come from the shared JSON Schema, whose wording belongs to the validator library.
 * The contract is the JSON path: a rejected field is reported at its path ("path: message"), at something below
 * it (an item of a rejected list), or at its parent when the field is unknown or missing
 * ("parent: property 'name' ..."), the way JSON Schema reports those.
 */
final class ValidationAssertions {
    private ValidationAssertions() {}

    static void assertErrorAt(List<String> errors, String... paths) {
        for (String path : paths) {
            assertThat(errors)
                    .as("an error reported at %s", path)
                    .anyMatch(error -> at(error, path));
        }
    }

    /** True when the error is reported at {@code path}, which may be relative (for example {@code conditions[0].right.value}). */
    static boolean at(String error, String path) {
        if (path.startsWith(".")) path = path.substring(1);
        if (error.startsWith(path + " ")) return true;
        int colon = error.indexOf(": ");
        String errorPath = colon < 0 ? error : error.substring(0, colon);
        String message = colon < 0 ? "" : error.substring(colon + 2);
        if (errorPath.endsWith(path) || errorPath.contains(path + ".") || errorPath.contains(path + "[")) return true;
        int split = Math.max(path.lastIndexOf('.'), path.lastIndexOf('['));
        if (split <= 0) return message.contains("'" + path + "'");
        String parent = path.substring(0, split);
        String property = path.substring(split + 1).replace("]", "");
        return errorPath.endsWith(parent) && message.contains("'" + property + "'");
    }
}
