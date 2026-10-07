package com.example.botfight.simulation.core.logic;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Condition;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * Action chain engine, mirrored by the browser's chainRuntime.js and chainNormalizer.js. Keep the
 * step logic, the order of checks and the normalization rules identical in both.
 *
 * A bot's chain stack holds up to {@link BotLogicContracts#MAX_CALL_DEPTH} frames. A frame is
 * `{ chainId, path, stepElapsedMs, issued, loops }`; `path` is the step position, such as
 * `[1, "branch", 0]` (step 1, its conditional body, step 0). An empty stack means no chain is running.
 */
public final class ChainRuntime {
    private static final Pattern CHAIN_ID = Pattern.compile(BotLogicContracts.CHAIN_ID_PATTERN);
    private static final int TICK_MS = BotLogicContracts.TICK_MS;
    private static final int MAX_STEPS_PER_TICK = 256;
    private static final String BRANCH = "branch";
    private static final String BODY = "body";
    private static final String ABILITY = "ability";
    private static final String DASH = "dash";

    private ChainRuntime() {}

    public enum StepType {
        ACTION("action"), WAIT("wait"), IF("if"), ELSE_IF("elseIf"), REPEAT("repeat"), RUN_CHAIN("runChain"),
        EXIT_LOOP("exitLoop"), END("end");

        private final String json;

        StepType(String json) { this.json = json; }

        public String json() { return json; }

        static StepType of(String json) {
            for (StepType type : values()) if (type.json.equals(json)) return type;
            return null;
        }
    }

    public record Chain(String id, String name, List<Step> steps) {}

    /** One normalized step. Only the fields of its type are set. */
    public record Step(StepType type, StrategyBlock block, String continueMode, Integer forMs, Integer maxMs,
                       List<Condition> conditions, List<Step> thenSteps, List<Step> elseSteps, Integer count,
                       List<Step> body, String chainId) {
        Step(StepType type) {
            this(type, null, null, null, null, List.of(), List.of(), List.of(), null, List.of(), null);
        }
    }

    public static final class Loop {
        public int passes;
        public int elapsedMs;
    }

    public static final class Frame {
        public final String chainId;
        public List<Object> path = new ArrayList<>(List.of(0));
        public int stepElapsedMs;
        public boolean issued;
        public final List<Loop> loops = new ArrayList<>();

        public Frame(String chainId) { this.chainId = chainId; }

        /** Trace form of the position, e.g. "punish@1.branch.0". */
        public String describe() {
            StringBuilder text = new StringBuilder(chainId.replace("chain.", "")).append('@');
            for (int index = 0; index < path.size(); index += 1) {
                if (index > 0) text.append('.');
                text.append(path.get(index));
            }
            return text.toString();
        }
    }

    /** What a chain issues in one category this tick. */
    public record Claim(String head, StrategyBlock block) {}

    /** The bot-specific questions the chain engine asks the simulation. */
    public interface Host {
        boolean conditionsHold(List<Condition> conditions);

        boolean executableNow(StrategyBlock block);

        void applyVariable(StrategyBlock block);

        boolean canCancelWindup();

        Integer abilityFor(Object action);

        /** Winding up or active with this ability. */
        boolean abilityBusy(int abilityId);

        boolean stunnedOrDead();

        String head(Object action);
    }

    // ---------------------------------------------------------------- normalization

    /** Normalizes a block for a chain step's action fields. */
    public interface BlockNormalizer {
        StrategyBlock normalize(JsonNode node);

        /** The action's head name (movement, rotation, ability, ...) or null if it is not a known action. */
        String head(Object action);

        Object action(JsonNode node);

        int cost(StrategyBlock block);
    }

    /**
     * Sanitizes a brain's `chains`, sharing the roots' action and condition budget. Unknown steps and steps
     * that cannot run are dropped, durations snap to whole ticks and calls that point nowhere are removed.
     */
    public static Map<String, Chain> normalize(JsonNode source, String coordinateVersion, BlockNormalizer blocks,
                                               int[] remainingActions, int[] remainingConditions) {
        Map<String, Chain> chains = new LinkedHashMap<>();
        if (source == null || !source.isArray()) return chains;
        int limit = Math.min(source.size(), BotLogicContracts.MAX_CHAINS);
        for (int index = 0; index < limit; index += 1) {
            JsonNode raw = source.get(index);
            String id = text(raw, "id", "").trim();
            if (!CHAIN_ID.matcher(id).matches() || chains.containsKey(id)) id = "chain.chain_" + (chains.size() + 1);
            while (chains.containsKey(id)) id = id + "_x";
            String name = text(raw, "name", "").trim().replaceAll("\\s+", " ");
            if (name.length() > BotLogicContracts.MAX_CHAIN_NAME_LENGTH) name = name.substring(0, BotLogicContracts.MAX_CHAIN_NAME_LENGTH);
            Context context = new Context(coordinateVersion, blocks, remainingActions, remainingConditions);
            chains.put(id, new Chain(id, name.isEmpty() ? "Chain" : name, normalizeSteps(raw == null ? null : raw.get("steps"), context, 0)));
        }
        return removeDanglingCalls(chains);
    }

    private static final class Context {
        final String coordinateVersion;
        final BlockNormalizer blocks;
        final int[] remainingActions;
        final int[] remainingConditions;
        int steps;

        Context(String coordinateVersion, BlockNormalizer blocks, int[] remainingActions, int[] remainingConditions) {
            this.coordinateVersion = coordinateVersion;
            this.blocks = blocks;
            this.remainingActions = remainingActions;
            this.remainingConditions = remainingConditions;
        }
    }

    private static List<Step> normalizeSteps(JsonNode raw, Context context, int loopDepth) {
        List<Step> steps = new ArrayList<>();
        if (raw == null || !raw.isArray()) return steps;
        for (JsonNode node : raw) {
            if (context.steps >= BotLogicContracts.MAX_CHAIN_STEPS) break;
            if ("elseIf".equals(text(node, "type", "")) && (steps.isEmpty()
                    || (steps.getLast().type() != StepType.IF && steps.getLast().type() != StepType.ELSE_IF))) continue;
            Step step = normalizeStep(node, context, loopDepth);
            if (step != null) {
                steps.add(step);
                // Convert saved Yes/No branches to adjacent condition bodies.
                JsonNode fallback = node.get("else");
                if (step.type() == StepType.IF && !node.has("steps") && fallback != null && fallback.isArray()
                        && !fallback.isEmpty() && context.steps < BotLogicContracts.MAX_CHAIN_STEPS && charge(context, 1)) {
                    context.steps++;
                    steps.add(new Step(StepType.ELSE_IF, null, null, null, null, List.of(), List.of(), List.of(),
                            null, normalizeSteps(fallback, context, loopDepth), null));
                }
            }
        }
        return steps;
    }

    private static boolean charge(Context context, int cost) {
        if (context.remainingActions[0] < cost) return false;
        context.remainingActions[0] -= cost;
        return true;
    }

    private static List<Condition> conditionsFor(JsonNode raw, Context context) {
        if (raw == null || !raw.isArray() || raw.isEmpty()) return List.of();
        List<Condition> all = ConditionResolutionService.normalizeConditions(raw, context.coordinateVersion);
        List<Condition> kept = all.subList(0, Math.min(all.size(), Math.max(0, context.remainingConditions[0])));
        context.remainingConditions[0] -= kept.size();
        return List.copyOf(kept);
    }

    private static Step normalizeStep(JsonNode raw, Context context, int loopDepth) {
        StepType type = StepType.of(text(raw, "type", ""));
        if (type == null) return null;
        if (type == StepType.ACTION) return normalizeActionStep(raw, context);
        // Reserve the step before its children so nested steps count toward the chain's limit.
        if (!charge(context, 1)) return null;
        context.steps += 1;
        switch (type) {
            case WAIT -> {
                List<Condition> until = conditionsFor(raw.get("untilConditions"), context);
                return until.isEmpty()
                        ? new Step(type, null, null, chainMs(raw.get("forMs")), null, List.of(), List.of(), List.of(), null, List.of(), null)
                        : new Step(type, null, null, null, chainMs(raw.get("maxMs")), until, List.of(), List.of(), null, List.of(), null);
            }
            case IF, ELSE_IF -> {
                List<Condition> conditions = conditionsFor(raw.get("conditions"), context);
                List<Step> body = normalizeSteps(raw.has("steps") ? raw.get("steps") : raw.get("then"), context, loopDepth);
                return new Step(type, null, null, null, null, conditions, List.of(), List.of(), null, body, null);
            }
            case REPEAT -> {
                List<Condition> whileConditions = conditionsFor(raw.get("whileConditions"), context);
                // A loop nested deeper than allowed keeps no body.
                List<Step> body = loopDepth >= BotLogicContracts.MAX_LOOP_NESTING
                        ? List.of() : normalizeSteps(raw.get("steps"), context, loopDepth + 1);
                if (!whileConditions.isEmpty()) {
                    return new Step(type, null, null, null, chainMs(raw.get("maxMs")), whileConditions, List.of(), List.of(), null, body, null);
                }
                long count = Math.round(number(raw.get("count"), 0));
                int clamped = (int) Math.max(1, Math.min(BotLogicContracts.MAX_REPEAT_COUNT, count == 0 ? 1 : count));
                return new Step(type, null, null, null, null, List.of(), List.of(), List.of(), clamped, body, null);
            }
            case RUN_CHAIN -> {
                return new Step(type, null, null, null, null, List.of(), List.of(), List.of(), null, List.of(), text(raw, "chainId", ""));
            }
            default -> {
                return new Step(type);
            }
        }
    }

    private static Step normalizeActionStep(JsonNode raw, Context context) {
        Object action = context.blocks.action(raw);
        String head = context.blocks.head(action);
        if (head == null || "none".equals(head) || "chain".equals(head)) return null;
        StrategyBlock block = context.blocks.normalize(raw);
        if (!charge(context, context.blocks.cost(block))) return null;
        context.steps += 1;
        String continueMode = null;
        Integer forMs = null;
        Integer maxMs = null;
        List<Condition> until = List.of();
        if (ABILITY.equals(head) || DASH.equals(head)) continueMode = "now".equals(text(raw, "continue", "")) ? "now" : "end";
        if ("movement".equals(head) || "rotation".equals(head)) {
            until = conditionsFor(raw.get("untilConditions"), context);
            if (until.isEmpty()) forMs = chainMs(raw.get("forMs"));
            else maxMs = chainMs(raw.get("maxMs"));
        }
        return new Step(StepType.ACTION, block, continueMode, forMs, maxMs, until, List.of(), List.of(), null, List.of(), null);
    }

    private static Map<String, Chain> removeDanglingCalls(Map<String, Chain> chains) {
        Map<String, Chain> pruned = new LinkedHashMap<>();
        for (Chain chain : chains.values()) {
            pruned.put(chain.id(), new Chain(chain.id(), chain.name(), prune(chain.steps(), chains.keySet())));
        }
        return pruned;
    }

    private static List<Step> prune(List<Step> steps, Set<String> ids) {
        List<Step> kept = new ArrayList<>();
        for (Step step : steps) {
            if (step.type() == StepType.RUN_CHAIN && !ids.contains(step.chainId())) continue;
            kept.add(new Step(step.type(), step.block(), step.continueMode(), step.forMs(), step.maxMs(),
                    step.conditions(), prune(step.thenSteps(), ids), prune(step.elseSteps(), ids), step.count(),
                    prune(step.body(), ids), step.chainId()));
        }
        return kept;
    }

    /** Rounds a duration to a whole tick and keeps it within the chain bounds. */
    static int chainMs(JsonNode value) {
        double numeric = number(value, Double.NaN);
        if (!Double.isFinite(numeric)) return BotLogicContracts.CHAIN_MS_STEP;
        long snapped = Math.round(numeric / BotLogicContracts.CHAIN_MS_STEP) * BotLogicContracts.CHAIN_MS_STEP;
        return (int) Math.max(BotLogicContracts.CHAIN_MS_STEP, Math.min(BotLogicContracts.CHAIN_MS_MAX, snapped));
    }

    private static String text(JsonNode node, String field, String fallback) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.isTextual() ? value.asText() : fallback;
    }

    private static double number(JsonNode value, double fallback) {
        return value != null && value.isNumber() && Double.isFinite(value.asDouble()) ? value.asDouble() : fallback;
    }

    // ---------------------------------------------------------------- runtime

    /**
     * Applies chain control from the roots selected this tick: the highest-priority
     * Run chain starts only when no chain is running; a running chain is never replaced. `entries` are in priority order.
     */
    public static void applyControl(List<Frame> stack, List<StrategyBlock> entries, Map<String, Chain> chains) {
        for (StrategyBlock entry : entries) {
            if (!BotLogicContracts.ACTION_RUN_CHAIN.equals(entry.action())) continue;
            String chainId = chainIdOf(entry);
            if (!chains.containsKey(chainId)) return;
            if (stack.isEmpty()) stack.add(new Frame(chainId));
            return;
        }
    }

    public static String chainIdOf(StrategyBlock block) {
        JsonNode payload = block.variableTerms();
        return payload != null && payload.isObject() ? text(payload, "chainId", "") : "";
    }


    /**
     * Runs the chain from its saved step until a step issues an action or waits. Returns the actions the chain
     * issues this tick, one per category at most. `stack` is mutated in place.
     */
    public static List<Claim> resume(List<Frame> stack, Map<String, Chain> chains, Host host) {
        List<Claim> claims = new ArrayList<>();
        if (stack.isEmpty()) return claims;
        // Stun or death ends the chain before it acts.
        if (host.stunnedOrDead()) {
            stack.clear();
            return claims;
        }
        Set<String> used = new java.util.HashSet<>();
        for (int guard = 0; !stack.isEmpty() && guard < MAX_STEPS_PER_TICK; guard += 1) {
            Frame frame = stack.get(stack.size() - 1);
            Chain chain = chains.get(frame.chainId);
            if (chain == null) {
                stack.clear();
                break;
            }
            Step step = stepAt(chain, frame.path);
            Outcome outcome = step == null ? leaveList(frame, chain) : runStep(step, frame, stack, chains, host, used, claims);
            if (outcome == Outcome.POP) stack.remove(stack.size() - 1);
            else if (outcome == Outcome.END) stack.clear();
            else if (outcome == Outcome.STOP) break;
        }
        // Loops measure how long they have been running, in ticks.
        for (Frame frame : stack) for (Loop loop : frame.loops) loop.elapsedMs += TICK_MS;
        return claims;
    }

    private enum Outcome { CONTINUE, STOP, END, POP }

    private static List<Step> listAt(Chain chain, List<Object> path) {
        List<Step> list = chain.steps();
        for (int index = 0; index < path.size() - 1; index += 2) {
            int at = (Integer) path.get(index);
            Step parent = at < list.size() ? list.get(at) : null;
            if (parent == null) return List.of();
            list = parent.body();
        }
        return list;
    }

    private static Step stepAt(Chain chain, List<Object> path) {
        List<Step> list = listAt(chain, path);
        int at = (Integer) path.get(path.size() - 1);
        return at < list.size() ? list.get(at) : null;
    }

    private static int bodyDepth(List<Object> path) {
        int depth = 0;
        for (int index = 1; index < path.size(); index += 2) if (BODY.equals(path.get(index))) depth += 1;
        return depth;
    }

    private static void moveTo(Frame frame, List<Object> path) {
        frame.path = path;
        frame.stepElapsedMs = 0;
        frame.issued = false;
    }

    private static List<Object> nextSibling(List<Object> path) {
        List<Object> next = new ArrayList<>(path.subList(0, path.size() - 1));
        next.add((Integer) path.get(path.size() - 1) + 1);
        return next;
    }

    private static void advance(Frame frame) {
        moveTo(frame, nextSibling(frame.path));
    }

    /** The position ran past the end of its list: return to the caller, rejoin after an If, or loop back. */
    private static Outcome leaveList(Frame frame, Chain chain) {
        if (frame.path.size() == 1) return Outcome.POP;
        List<Object> parentPath = new ArrayList<>(frame.path.subList(0, frame.path.size() - 2));
        if (BODY.equals(frame.path.get(frame.path.size() - 2))) {
            // Going back to the top of a loop always waits for the next tick.
            int depth = bodyDepth(parentPath);
            if (depth < frame.loops.size()) frame.loops.get(depth).passes += 1;
            moveTo(frame, parentPath);
            return Outcome.STOP;
        }
        moveTo(frame, afterConditionalGroup(chain, parentPath));
        return Outcome.CONTINUE;
    }

    private static List<Object> afterConditionalGroup(Chain chain, List<Object> path) {
        List<Step> list = listAt(chain, path);
        int next = (Integer) path.getLast() + 1;
        while (next < list.size() && list.get(next).type() == StepType.ELSE_IF) next++;
        List<Object> result = new ArrayList<>(path.subList(0, path.size() - 1));
        result.add(next);
        return result;
    }

    private static Outcome runConditionalGroup(Frame frame, Chain chain, Host host) {
        List<Step> list = listAt(chain, frame.path);
        int index = (Integer) frame.path.getLast();
        do {
            if (host.conditionsHold(list.get(index).conditions())) {
                List<Object> next = new ArrayList<>(frame.path.subList(0, frame.path.size() - 1));
                next.add(index); next.add(BRANCH); next.add(0);
                moveTo(frame, next);
                return Outcome.CONTINUE;
            }
            index++;
        } while (index < list.size() && list.get(index).type() == StepType.ELSE_IF);
        List<Object> next = new ArrayList<>(frame.path.subList(0, frame.path.size() - 1));
        next.add(index);
        moveTo(frame, next);
        return Outcome.CONTINUE;
    }

    private static Outcome runStep(Step step, Frame frame, List<Frame> stack, Map<String, Chain> chains, Host host,
                                   Set<String> used, List<Claim> claims) {
        switch (step.type()) {
            case ACTION: return runActionStep(step, frame, host, used, claims);
            case WAIT: return runWait(step, frame, host);
            case IF: return runConditionalGroup(frame, chains.get(frame.chainId), host);
            case ELSE_IF: {
                moveTo(frame, afterConditionalGroup(chains.get(frame.chainId), frame.path));
                return Outcome.CONTINUE;
            }
            case REPEAT: return runRepeat(step, frame, host);
            case RUN_CHAIN: return runCall(step, frame, stack, chains);
            case EXIT_LOOP: return exitLoop(frame);
            case END: return Outcome.POP;
            default: return Outcome.END;
        }
    }

    private static Outcome runActionStep(Step step, Frame frame, Host host, Set<String> used, List<Claim> claims) {
        StrategyBlock block = step.block();
        String head = host.head(block.action());
        if (head == null || "none".equals(head)) return Outcome.END;
        if ("variable".equals(head)) {
            // Instant: later steps this tick see the write.
            host.applyVariable(block);
            advance(frame);
            return Outcome.CONTINUE;
        }
        if ("cancel".equals(head)) return runCancelWindup(step, frame, host, used, claims);
        // Dash is issued like an ability (it can wait for its end), but claims its own category.
        if (ABILITY.equals(head) || DASH.equals(head)) return runUseAbility(step, frame, host, head, used, claims);
        return runTimedAction(step, frame, host, head, used, claims);
    }

    /** Cancel Wind-up uses the cancel category and stops the chain for this tick, so no ability starts on a cancel tick. */
    private static Outcome runCancelWindup(Step step, Frame frame, Host host, Set<String> used, List<Claim> claims) {
        if (!used.contains("cancel") && host.canCancelWindup()) {
            used.add("cancel");
            claims.add(new Claim("cancel", step.block()));
        }
        advance(frame);
        return Outcome.STOP;
    }

    private static Outcome runUseAbility(Step step, Frame frame, Host host, String category, Set<String> used, List<Claim> claims) {
        Integer abilityId = host.abilityFor(step.block().action());
        if (frame.issued) {
            // "When it ends": no longer winding up or active, for any reason.
            if (abilityId != null && host.abilityBusy(abilityId)) return Outcome.STOP;
            advance(frame);
            return Outcome.CONTINUE;
        }
        if (used.contains(category)) return Outcome.STOP;
        // An unavailable ability is skipped; the next step is attempted next tick.
        if (!host.executableNow(step.block())) { advance(frame); return Outcome.STOP; }
        used.add(category);
        claims.add(new Claim(category, step.block()));
        if ("now".equals(step.continueMode())) {
            advance(frame);
            return Outcome.CONTINUE;
        }
        frame.issued = true;
        return Outcome.STOP;
    }

    /** Walk and Rotate issue every tick for `forMs`, or until a condition holds (capped by `maxMs`). */
    private static Outcome runTimedAction(Step step, Frame frame, Host host, String category, Set<String> used, List<Claim> claims) {
        if (!step.conditions().isEmpty() && host.conditionsHold(step.conditions())) {
            advance(frame);
            return Outcome.CONTINUE;
        }
        if (used.contains(category)) return Outcome.STOP;
        if (host.executableNow(step.block())) {
            used.add(category);
            claims.add(new Claim(category, step.block()));
        }
        frame.stepElapsedMs += TICK_MS;
        if (frame.stepElapsedMs >= (step.forMs() != null ? step.forMs() : step.maxMs())) {
            advance(frame);
            return Outcome.CONTINUE;
        }
        return Outcome.STOP;
    }

    private static Outcome runWait(Step step, Frame frame, Host host) {
        int limit = step.forMs() != null ? step.forMs() : step.maxMs();
        // Once the time is reached, the next step runs at the start of that tick.
        if ((!step.conditions().isEmpty() && host.conditionsHold(step.conditions())) || frame.stepElapsedMs >= limit) {
            advance(frame);
            return Outcome.CONTINUE;
        }
        frame.stepElapsedMs += TICK_MS;
        return Outcome.STOP;
    }

    private static Outcome runRepeat(Step step, Frame frame, Host host) {
        int depth = bodyDepth(frame.path);
        if (frame.loops.size() == depth) frame.loops.add(new Loop());
        Loop loop = frame.loops.get(depth);
        boolean again = step.count() != null
                ? loop.passes < step.count()
                : loop.elapsedMs < step.maxMs() && host.conditionsHold(step.conditions());
        if (again) {
            List<Object> body = new ArrayList<>(frame.path);
            body.add(BODY);
            body.add(0);
            moveTo(frame, body);
        } else {
            while (frame.loops.size() > depth) frame.loops.remove(frame.loops.size() - 1);
            advance(frame);
        }
        return Outcome.CONTINUE;
    }

    private static Outcome runCall(Step step, Frame frame, List<Frame> stack, Map<String, Chain> chains) {
        // A frame that is waiting on its callee has `issued` set; the callee has returned.
        if (frame.issued) {
            advance(frame);
            return Outcome.CONTINUE;
        }
        if (!chains.containsKey(step.chainId()) || stack.size() >= BotLogicContracts.MAX_CALL_DEPTH) return Outcome.END;
        frame.issued = true;
        stack.add(new Frame(step.chainId()));
        return Outcome.CONTINUE;
    }

    private static Outcome exitLoop(Frame frame) {
        int bodyIndex = frame.path.lastIndexOf(BODY);
        if (bodyIndex < 0) {
            advance(frame);
            return Outcome.CONTINUE;
        }
        List<Object> repeatPath = new ArrayList<>(frame.path.subList(0, bodyIndex));
        int depth = bodyDepth(repeatPath);
        while (frame.loops.size() > depth) frame.loops.remove(frame.loops.size() - 1);
        moveTo(frame, nextSibling(repeatPath));
        return Outcome.CONTINUE;
    }
}
