import { LANE_SECTIONS } from "../configuration/constants.js";
import { ACTION_TO_ABILITY } from "../../../loadout/BotLoadout.js";
import { ABILITY_STAGES, abilityIdsInStage, activeRemainingMs, isWindingUp, windupRemainingMs } from "../../../gameconfig/AbilityState.js";
import { ACTION_BY_ID, ACTION_HEADS } from "../contracts/BotLogicContracts.js";
import { blockCanAct } from "./actionSelector.js";

/**
 * One tick of a lanes brain (docs/LANES.md), decided from the start-of-tick snapshot (`state` is read before any write).
 *
 * 1. Switches: the shared switches, then the current mode's, in order. The first whose conditions hold and whose
 *    target is another mode moves the bot (one switch per tick). Its time in mode starts at 0, and it ends the combo
 *    (not the running action).
 * 2. Movement: the first Move card (move category) that can act runs, and the first Face card (rotation category)
 *    that can act runs; the mode's cards first, then shared. Attached movement of the running action's card replaces
 *    the choice for its kind while that ability winds up or is active.
 * 3. Actions, at most one action starts per tick:
 *    a. An action is running (any ability winding up or active, a dash included): nothing new starts, except a
 *       Cancel card while an ability winds up. A cancel ends the action.
 *    b. Otherwise, if a combo is waiting (its step's action ended), the step's follow-ups are tried top to bottom and
 *       the first that can act starts. If none can, the combo ends and c. runs this tick.
 *    c. Otherwise the mode's Actions cards, then the shared ones, top to bottom: the first that can act starts.
 * 4. Variables: every card that applies runs, top to bottom, with the tree's write rules for variable actions.
 *
 * Two pieces of bot state come from the snapshot's player model, and the plan returns their next values:
 * - `comboStepId`: the combo's current step (a card with follow-ups whose action runs). A switch, a segment boundary,
 *   a missing or disabled card drops it.
 * - `runningActionCardId`: the card whose action runs, when it has attached movement or follow-ups. It survives a mode
 *   switch; it ends with the action, a dead bot, or a card that is gone or disabled.
 * A new start is planned here (`startedCardId`), but the caller keeps the state only if the executor really starts
 * that action (fight.js trackComboState). The plan fills `movement`, `rotation`, `ability`, `dash` and `cancel` (the
 * blocks the executor reads), `winners` ({ move, face, action, variables }: the ids that won), `modeId`,
 * `timeInModeMs` (0 right after a switch) and `customVariables`.
 */
export function selectLanesActionPlan(normalized, payload, runtime) {
    const state = runtime.stateFromPayload(payload, normalized.version);
    runtime.prepareCustomVariables(state, normalized.customVariables);

    const modes = normalized.modes;
    const storedModeId = state.player.modeId ?? null;
    const keptIndex = storedModeId == null ? -1 : modes.findIndex((mode) => mode.id === storedModeId);
    const current = keptIndex >= 0 ? modes[keptIndex] : modes[0];
    const storedMs = keptIndex >= 0 ? Math.max(0, Math.round(Number(state.player.timeInModeMs) || 0)) : 0;
    // Switch conditions read the start-of-tick value.
    state.player.timeInModeMs = storedMs;

    const switchOrder = [...(normalized.shared.switches ?? []), ...(current.switches ?? [])];
    const modeById = new Map(modes.map((mode) => [mode.id, mode]));
    const winningSwitch = switchOrder.find((entry) => entry.to !== current.id
        && modeById.has(entry.to) && runtime.evaluateConditions(entry.conditions, state));
    const next = winningSwitch ? modeById.get(winningSwitch.to) : current;
    const timeInModeMs = winningSwitch ? 0 : storedMs;
    state.player.timeInModeMs = timeInModeMs;

    // A switch ends the combo; the combo's step is looked up among the enabled cards of the mode after the switch.
    const step = winningSwitch ? null : findEnabledCard(normalized, next, state.player.comboStepId ?? null);
    const stepRunning = step != null && cardRunning(step, state.player);
    // The running action's card, found in any mode (it survives a switch).
    const running = findEnabledCardAnywhere(normalized, state.player.runningActionCardId ?? null);
    const runningActive = running != null && cardRunning(running, state.player);
    // Read from the start-of-tick snapshot: is any action running (an ability winding up or active, dash included)?
    const actionRunning = abilityIdsInStage(state.player, ABILITY_STAGES.WINDUP).length > 0
        || abilityIdsInStage(state.player, ABILITY_STAGES.ACTIVE).length > 0;

    const plan = {};
    const winners = {};

    // 2. Movement. Attached movement comes from the running action's card and replaces the section's choice.
    const movementCards = sectionCards(next, normalized, "movement");
    const attachedMove = runningActive && running.move ? running.move : null;
    const attachedFace = runningActive && running.face ? running.face : null;
    const sectionMove = firstActing(movementCards.filter((card) => headOf(card) === ACTION_HEADS.MOVEMENT), state, runtime);
    const sectionFace = firstActing(movementCards.filter((card) => headOf(card) === ACTION_HEADS.ROTATION), state, runtime);
    if (attachedMove && blockCanAct({ ...attachedMove }, state, runtime)) {
        plan.movement = { ...attachedMove };
        winners.move = running.id;
    } else if (sectionMove) {
        plan.movement = cardBlock(sectionMove);
        winners.move = sectionMove.id;
    }
    if (attachedFace && blockCanAct({ ...attachedFace }, state, runtime)) {
        plan.rotation = { ...attachedFace };
        winners.face = running.id;
    } else if (sectionFace) {
        plan.rotation = cardBlock(sectionFace);
        winners.face = sectionFace.id;
    }

    // 3. Actions: at most one action starts this tick.
    let action = null;
    let comboStepId = null;
    let runningActionCardId = null;
    let startedCardId = null;
    if (actionRunning) {
        // Only a cancel acts while an ability winds up; the running action (if any) stays until the cancel ends it.
        if (isWindingUp(state.player)) {
            action = firstActing(sectionCards(next, normalized, "actions").filter((card) => headOf(card) === ACTION_HEADS.CANCEL), state, runtime);
        }
        comboStepId = stepRunning ? step.id : null;
        runningActionCardId = runningActive ? running.id : null;
    } else {
        const followUps = step ? enabledFollowUps(step) : [];
        action = firstActing(followUps, state, runtime)
            ?? firstActing(sectionCards(next, normalized, "actions"), state, runtime);
        // Cancel starts nothing; a cancel holds no state.
        if (action && headOf(action) !== ACTION_HEADS.CANCEL) {
            startedCardId = action.id;
            if ((action.followUps?.length ?? 0) > 0) comboStepId = action.id;
            if ((action.followUps?.length ?? 0) > 0 || action.move != null || action.face != null) runningActionCardId = action.id;
        }
    }
    if (action) {
        plan[SLOT_BY_HEAD[headOf(action)]] = cardBlock(action);
        winners.action = action.id;
    }

    // 4. Variables. Conditions of every variable card are read before the first write, as the tree reads its root conditions.
    const variableCards = sectionCards(next, normalized, "variables")
        .filter((card) => runtime.evaluateConditions(card.conditions, state));
    const ran = [];
    for (const card of variableCards) {
        const block = cardBlock(card);
        if (!runtime.actionExecutableNow(block, state)) continue;
        runtime.applyVariableAction(block, state, normalized.customVariables);
        ran.push(card.id);
    }
    if (ran.length) winners.variables = ran;

    plan.customVariables = { ...state.player.customVariables };
    plan.modeId = next.id;
    plan.timeInModeMs = timeInModeMs;
    plan.winners = winners;
    if (comboStepId != null) plan.comboStepId = comboStepId;
    if (runningActionCardId != null) plan.runningActionCardId = runningActionCardId;
    if (startedCardId != null) plan.startedCardId = startedCardId;
    return plan;
}

const SLOT_BY_HEAD = Object.freeze({
    [ACTION_HEADS.ABILITY]: "ability",
    [ACTION_HEADS.DASH]: "dash",
    [ACTION_HEADS.CANCEL]: "cancel",
});

/** The mode's own enabled cards for a section, then the shared ones (a disabled card never applies). */
function sectionCards(mode, normalized, section) {
    return [...(mode[section] ?? []), ...(normalized.shared[section] ?? [])]
        .filter((card) => card.enabled !== false);
}

/** The first card (in order) whose conditions hold and whose action can act now. */
function firstActing(cards, state, runtime) {
    return cards.find((card) => runtime.evaluateConditions(card.conditions, state) && blockCanAct(cardBlock(card), state, runtime)) ?? null;
}

/** The card's action as the block the executor reads: the tree's block fields, flattened. */
function cardBlock(card) {
    return { ...card, ...card.action, conditions: card.conditions };
}

const headOf = (card) => ACTION_BY_ID.get(card?.action?.action)?.head ?? null;
const enabledFollowUps = (card) => (card.followUps ?? []).filter((follow) => follow.enabled !== false);

/**
 * The enabled card with this id in the mode or the shared set, looking into the follow-ups of enabled cards (a
 * disabled card hides its follow-ups). Null when there is no such card, which drops the tracked combo step.
 */
function findEnabledCard(normalized, mode, id) {
    return findInSets(normalized, [mode, normalized.shared], id);
}

/** As findEnabledCard, but in any mode or the shared set (the running action's card survives a mode switch). */
function findEnabledCardAnywhere(normalized, id) {
    return findInSets(normalized, [...normalized.modes, normalized.shared], id);
}

function findInSets(normalized, sets, id) {
    if (id == null) return null;
    const search = (cards) => {
        for (const card of cards) {
            if (card.enabled === false) continue;
            if (card.id === id) return card;
            const found = search(card.followUps ?? []);
            if (found) return found;
        }
        return null;
    };
    for (const set of sets) {
        for (const section of LANE_SECTIONS) {
            const found = search(set[section] ?? []);
            if (found) return found;
        }
    }
    return null;
}

/** True while the card's ability is winding up or active in the snapshot (a dash is active while it moves). */
function cardRunning(card, player) {
    const ability = ACTION_TO_ABILITY[card.action?.action];
    return ability != null && (windupRemainingMs(player, ability) > 0 || activeRemainingMs(player, ability) > 0);
}
