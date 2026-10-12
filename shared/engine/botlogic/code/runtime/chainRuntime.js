import { activeRemainingMs, windupRemainingMs } from "../../../gameconfig/AbilityState.js";
import { canCancelWindup } from "../../../gameconfig/StaminaSystem.js";
import { hasActiveEffect, STATUS_EFFECT_APPLICATIONS } from "../../../ecs/contracts/StatusContracts.js";
import { ACTION_HEADS, BOT_CODE_ACTIONS } from "../contracts/BotLogicContracts.js";
import { CHAIN_STEP_TYPES, MAX_CALL_DEPTH, TICK_MS } from "../configuration/constants.js";

/**
 * Action chain engine. A bot's `chainStack` is a stack of up to MAX_CALL_DEPTH frames,
 * `{ chainId, path, stepElapsedMs, issued, loops: [{ passes, elapsedMs }] }`. `path` is the
 * step position, e.g. `[1, "branch", 0]`: step 1 of the chain, its conditional body, step 0. An empty
 * stack means no chain is running. The server mirrors this file in ChainRuntime.java; keep the
 * step logic and the order of checks identical.
 */

const CATEGORY_ABILITY = "ability";
// A tick runs at most this many steps, so a malformed chain can never spin forever.
const MAX_STEPS_PER_TICK = 256;
const BRANCH = "branch";
const BODY = "body";

export function newChainFrame(chainId) {
    return { chainId, path: [0], stepElapsedMs: 0, issued: false, loops: [] };
}

export function cloneChainStack(stack) {
    return (Array.isArray(stack) ? stack : []).map((frame) => ({
        chainId: String(frame.chainId),
        path: [...frame.path],
        stepElapsedMs: Number(frame.stepElapsedMs) || 0,
        issued: Boolean(frame.issued),
        loops: (frame.loops ?? []).map((loop) => ({ passes: Number(loop.passes) || 0, elapsedMs: Number(loop.elapsedMs) || 0 })),
    }));
}

/**
 * Applies chain control from the roots selected this tick: the highest-priority Run chain is
 * pushed only when no chain is running; a running chain is never replaced. `entries` are the
 * selected action entries in priority order. Returns true when a chain was just pushed; it has
 * not started yet, see the starting rules on `resumeChain`.
 */
export function applyChainControl(stack, entries, chains) {
    const run = entries.find((entry) => entry.action === BOT_CODE_ACTIONS.RUN_CHAIN);
    if (!run || !chains.has(run.chainId) || stack.length > 0) return false;
    stack.push(newChainFrame(run.chainId));
    return true;
}

/**
 * Runs the chain from its saved step until a step issues an action or waits. Returns the
 * actions the chain issues this tick as `{ head, block }`, one per category at most.
 * `stack` is mutated in place. `ctx`: `{ state, chains, definitions, runtime, start }`.
 *
 * Starting: `ctx.start` (`{ claimed, canAct }`) is set on the tick the chain was pushed. Instant
 * steps (variable ops, If / Else if) run as usual until the first step that issues an action. That
 * step competes like a root: it needs a category no higher-priority root (`claimed`) holds and
 * `canAct(step)` (executable now, target resolved). Otherwise the chain does not start: its
 * variable writes from this tick are discarded and the stack is left empty. A chain whose first
 * step is a Wait claims nothing and starts normally.
 *
 * Once started, a Use ability / Dash step that is not executable when reached ends the whole
 * chain (every frame). Walk / Rotate keep trying until their time or condition ends them.
 */
export function resumeChain(stack, ctx) {
    const claims = [];
    if (stack.length === 0) return claims;
    const { player } = ctx.state;
    // Stun or death ends the chain before it acts.
    if (Number(player?.hp) <= 0 || isStunned(player)) {
        stack.length = 0;
        return claims;
    }
    const used = new Set();
    const start = ctx.start ? { ...ctx.start, passed: false, variables: { ...player.customVariables } } : null;
    for (let guard = 0; stack.length > 0 && guard < MAX_STEPS_PER_TICK; guard += 1) {
        const frame = stack.at(-1);
        const chain = ctx.chains.get(frame.chainId);
        if (!chain) {
            stack.length = 0;
            break;
        }
        const step = stepAt(chain, frame.path);
        let outcome;
        if (!step) outcome = leaveList(frame, chain);
        else outcome = runStep(step, frame, stack, { ...ctx, used, claims, start });
        if (outcome === "abort") {
            // The chain never started: undo this tick's variable writes.
            for (const key of Object.keys(player.customVariables)) delete player.customVariables[key];
            Object.assign(player.customVariables, start.variables);
            stack.length = 0;
            claims.length = 0;
            return claims;
        }
        if (outcome === "pop") stack.pop();
        else if (outcome === "end") stack.length = 0;
        else if (outcome === "stop") break;
    }
    // Loops measure how long they have been running, in ticks.
    for (const frame of stack) for (const loop of frame.loops) loop.elapsedMs += TICK_MS;
    return claims;
}

function isStunned(bot) {
    return hasActiveEffect(bot, STATUS_EFFECT_APPLICATIONS.STUN);
}

/** True while the bot is winding up or running the ability. Anything else means it has ended. */
function abilityBusy(bot, abilityId) {
    return windupRemainingMs(bot, abilityId) > 0 || activeRemainingMs(bot, abilityId) > 0;
}

function listAt(chain, path) {
    let list = chain.steps;
    for (let index = 0; index < path.length - 1; index += 2) {
        const parent = list[path[index]];
        list = parent?.steps ?? [];
    }
    return list;
}

function stepAt(chain, path) {
    return listAt(chain, path)[path.at(-1)];
}

function bodyDepth(path) {
    let depth = 0;
    for (let index = 1; index < path.length; index += 2) if (path[index] === BODY) depth += 1;
    return depth;
}

function moveTo(frame, path) {
    frame.path = path;
    frame.stepElapsedMs = 0;
    frame.issued = false;
}

function advance(frame) {
    moveTo(frame, [...frame.path.slice(0, -1), frame.path.at(-1) + 1]);
}

/** The position ran past the end of its list: return to the caller, rejoin after an If, or loop back. */
function leaveList(frame, chain) {
    if (frame.path.length === 1) return "pop";
    const parentPath = frame.path.slice(0, -2);
    if (frame.path.at(-2) === BODY) {
        // Going back to the top of a loop always waits for the next tick.
        const loop = frame.loops[bodyDepth(parentPath)];
        if (loop) loop.passes += 1;
        moveTo(frame, parentPath);
        return "stop";
    }
    moveTo(frame, afterConditionalGroup(chain, parentPath));
    return "continue";
}

function categoryOf(action) {
    if (action.head === ACTION_HEADS.MOVEMENT) return ACTION_HEADS.MOVEMENT;
    if (action.head === ACTION_HEADS.ROTATION) return ACTION_HEADS.ROTATION;
    if (action.head === ACTION_HEADS.CANCEL) return ACTION_HEADS.CANCEL;
    if (action.head === ACTION_HEADS.DASH) return ACTION_HEADS.DASH;
    return CATEGORY_ABILITY;
}

function conditionsHold(conditions, ctx) {
    return ctx.runtime.evaluateConditions(conditions ?? [], ctx.state);
}

function afterConditionalGroup(chain, path) {
    const list = listAt(chain, path);
    let next = path.at(-1) + 1;
    while (list[next]?.type === CHAIN_STEP_TYPES.ELSE_IF) next += 1;
    return [...path.slice(0, -1), next];
}

function runConditionalGroup(frame, ctx) {
    const chain = ctx.chains.get(frame.chainId);
    const list = listAt(chain, frame.path);
    let index = frame.path.at(-1);
    do {
        const step = list[index];
        if (conditionsHold(step.conditions, ctx)) {
            moveTo(frame, [...frame.path.slice(0, -1), index, BRANCH, 0]);
            return "continue";
        }
        index += 1;
    } while (list[index]?.type === CHAIN_STEP_TYPES.ELSE_IF);
    moveTo(frame, [...frame.path.slice(0, -1), index]);
    return "continue";
}

function runStep(step, frame, stack, ctx) {
    switch (step.type) {
        case CHAIN_STEP_TYPES.ACTION: return runActionStep(step, frame, ctx);
        case CHAIN_STEP_TYPES.WAIT: return runWait(step, frame, ctx);
        case CHAIN_STEP_TYPES.IF:
            return runConditionalGroup(frame, ctx);
        case CHAIN_STEP_TYPES.ELSE_IF:
            moveTo(frame, afterConditionalGroup(ctx.chains.get(frame.chainId), frame.path));
            return "continue";
        case CHAIN_STEP_TYPES.REPEAT: return runRepeat(step, frame, ctx);
        case CHAIN_STEP_TYPES.RUN_CHAIN: return runCall(step, frame, stack, ctx);
        case CHAIN_STEP_TYPES.EXIT_LOOP: return exitLoop(frame);
        case CHAIN_STEP_TYPES.END: return "pop";
        default: return "end";
    }
}

function runActionStep(step, frame, ctx) {
    const action = ctx.runtime.actionById.get(step.action);
    if (!action || action.id === BOT_CODE_ACTIONS.NONE) return "end";
    if (action.id === BOT_CODE_ACTIONS.VARIABLE) {
        // Instant: later steps this tick see the write.
        ctx.runtime.applyVariableAction(step, ctx.state, ctx.definitions);
        advance(frame);
        return "continue";
    }
    const category = categoryOf(action);
    if (action.id === BOT_CODE_ACTIONS.CANCEL_WINDUP) return runCancelWindup(step, frame, ctx, category);
    // Dash is issued like an ability (it can wait for its end), but claims its own category.
    if (category === CATEGORY_ABILITY || category === ACTION_HEADS.DASH) return runUseAbility(step, frame, ctx, category);
    return runTimedAction(step, frame, ctx, category);
}

/**
 * The first step that issues an action decides whether a chain that is starting this tick starts at
 * all. False means abort: a higher-priority root holds the category or the action cannot act now.
 */
function mayStart(step, ctx, category) {
    const { start } = ctx;
    if (!start || start.passed) return true;
    if (start.claimed.has(category) || !start.canAct(step)) return false;
    start.passed = true;
    return true;
}

/** Cancel Wind-up uses the cancel category and stops the chain for this tick, so no ability starts on a cancel tick. */
function runCancelWindup(step, frame, ctx, category) {
    if (!mayStart(step, ctx, category)) return "abort";
    if (!ctx.used.has(category) && canCancelWindup(ctx.state.player)) {
        ctx.used.add(category);
        ctx.claims.push({ head: category, block: step });
    }
    advance(frame);
    return "stop";
}

function runUseAbility(step, frame, ctx, category) {
    const abilityId = ctx.runtime.abilityForAction(step.action);
    if (frame.issued) {
        // "When it ends": no longer winding up or active, for any reason.
        if (abilityBusy(ctx.state.player, abilityId)) return "stop";
        advance(frame);
        return "continue";
    }
    if (!mayStart(step, ctx, category)) return "abort";
    if (ctx.used.has(category)) return "stop";
    // A step that cannot act ends the whole chain; wait for the ability first to hold the chain instead.
    if (!ctx.runtime.actionExecutableNow(step, ctx.state)) return "end";
    ctx.used.add(category);
    ctx.claims.push({ head: category, block: step });
    if (step.continue === "now") {
        advance(frame);
        return "continue";
    }
    frame.issued = true;
    return "stop";
}

/** Walk and Rotate issue every tick for `forMs`, or until a condition holds (capped by `maxMs`). */
function runTimedAction(step, frame, ctx, category) {
    if (step.untilConditions && conditionsHold(step.untilConditions, ctx)) {
        advance(frame);
        return "continue";
    }
    if (!mayStart(step, ctx, category)) return "abort";
    if (ctx.used.has(category)) return "stop";
    if (ctx.runtime.actionExecutableNow(step, ctx.state)) {
        ctx.used.add(category);
        ctx.claims.push({ head: category, block: step });
    }
    frame.stepElapsedMs += TICK_MS;
    if (frame.stepElapsedMs >= (step.forMs ?? step.maxMs)) {
        advance(frame);
        return "continue";
    }
    return "stop";
}

function runWait(step, frame, ctx) {
    const limit = step.forMs ?? step.maxMs;
    // Once the time is reached, the next step runs at the start of that tick.
    if ((step.untilConditions && conditionsHold(step.untilConditions, ctx)) || frame.stepElapsedMs >= limit) {
        advance(frame);
        return "continue";
    }
    frame.stepElapsedMs += TICK_MS;
    return "stop";
}

function runRepeat(step, frame, ctx) {
    const depth = bodyDepth(frame.path);
    if (frame.loops.length === depth) frame.loops.push({ passes: 0, elapsedMs: 0 });
    const loop = frame.loops[depth];
    const again = step.count != null
        ? loop.passes < step.count
        : loop.elapsedMs < step.maxMs && conditionsHold(step.whileConditions, ctx);
    if (again) {
        moveTo(frame, [...frame.path, BODY, 0]);
    } else {
        frame.loops.length = depth;
        advance(frame);
    }
    return "continue";
}

function runCall(step, frame, stack, ctx) {
    // A frame that is waiting on its callee has `issued` set; the callee has returned.
    if (frame.issued) {
        advance(frame);
        return "continue";
    }
    if (!ctx.chains.has(step.chainId) || stack.length >= MAX_CALL_DEPTH) return "end";
    frame.issued = true;
    stack.push(newChainFrame(step.chainId));
    return "continue";
}

function exitLoop(frame) {
    const bodyIndex = frame.path.lastIndexOf(BODY);
    if (bodyIndex < 0) {
        advance(frame);
        return "continue";
    }
    const repeatPath = frame.path.slice(0, bodyIndex);
    frame.loops.length = bodyDepth(repeatPath);
    moveTo(frame, [...repeatPath.slice(0, -1), repeatPath.at(-1) + 1]);
    return "continue";
}
