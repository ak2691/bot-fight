package com.example.botfight.simulation.bots;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.ToIntFunction;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * Linked actions: one action wired under several parents is saved as one copy per parent, all sharing a
 * {@code linkId}. The simulation runs the copies as it always has; the link only matters to the action
 * budget, where identical copies (everything but their own {@code id}) cost once. Mirrors
 * {@code linkedActions.js} in the browser so both sides count alike.
 */
public final class LinkedActions {
    public static final int MAX_LINK_ID_LENGTH = 40;
    private static final Pattern LINK_ID = Pattern.compile("[A-Za-z0-9_-]{1," + MAX_LINK_ID_LENGTH + "}");

    private LinkedActions() {
    }

    public static boolean isLinkId(JsonNode value) {
        return value != null && value.isTextual() && LINK_ID.matcher(value.asText()).matches();
    }

    /** The budget key of a linked copy (its content without {@code id}), or null for an unlinked action. */
    public static String budgetKey(JsonNode entry) {
        if (entry == null || !entry.isObject() || !isLinkId(entry.get("linkId"))) return null;
        StringBuilder out = new StringBuilder("{");
        for (String key : new TreeSet<>(entry.propertyNames())) {
            if ("id".equals(key)) continue;
            out.append(key).append(':');
            canonical(entry.get(key), out);
            out.append(',');
        }
        return out.append('}').toString();
    }

    private static void canonical(JsonNode node, StringBuilder out) {
        if (node == null || node.isNull() || node.isMissingNode()) out.append("null");
        else if (node.isObject()) {
            out.append('{');
            for (String key : new TreeSet<>(node.propertyNames())) {
                out.append(key).append(':');
                canonical(node.get(key), out);
                out.append(',');
            }
            out.append('}');
        } else if (node.isArray()) {
            out.append('[');
            for (JsonNode item : node) {
                canonical(item, out);
                out.append(',');
            }
            out.append(']');
        } else if (node.isNumber()) {
            double value = node.asDouble();
            out.append(value == Math.rint(value) && Math.abs(value) < 1e15 ? Long.toString((long) value) : Double.toString(value));
        } else out.append(node.toString());
    }

    /** Every action entry of a brain's tree (roots, conditionals, orphans), in the same order as the browser. */
    public static List<JsonNode> treeActionEntries(JsonNode roots, JsonNode orphans) {
        List<JsonNode> entries = new ArrayList<>();
        if (roots != null && roots.isArray()) {
            for (JsonNode root : roots) {
                JsonNode actions = root.get("actions");
                if (actions != null && actions.isArray()) actions.forEach(entries::add);
                visitBranches(root.get("branches"), entries);
            }
        }
        if (orphans != null && orphans.isArray()) {
            for (JsonNode node : orphans) {
                if ("action".equals(node.path("kind").asText())) entries.add(node);
                else visitBranch(node, entries);
            }
        }
        return entries;
    }

    private static void visitBranches(JsonNode branches, List<JsonNode> entries) {
        if (branches == null || !branches.isArray()) return;
        for (JsonNode branch : branches) visitBranch(branch, entries);
    }

    private static void visitBranch(JsonNode branch, List<JsonNode> entries) {
        if (branch == null || !branch.isObject()) return;
        JsonNode actions = branch.get("actions");
        if (actions != null && actions.isArray() && !actions.isEmpty()) actions.forEach(entries::add);
        else if (branch.has("action")) entries.add(branch);
        visitBranches(branch.get("children"), entries);
    }

    /** The cost saved by linked copies: every identical copy after the first is free. */
    public static int discount(JsonNode roots, JsonNode orphans, ToIntFunction<JsonNode> costOf) {
        Set<String> seen = new HashSet<>();
        int discount = 0;
        for (JsonNode entry : treeActionEntries(roots, orphans)) {
            String key = budgetKey(entry);
            if (key == null) continue;
            if (!seen.add(key)) discount += costOf.applyAsInt(entry);
        }
        return discount;
    }
}
