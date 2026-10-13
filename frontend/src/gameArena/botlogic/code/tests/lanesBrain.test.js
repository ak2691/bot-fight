import assert from "node:assert/strict";
import test from "node:test";
import {
    normalizeAbilityStrategyConfiguration,
    selectAbilityStrategyActionPlan,
} from "../../../../../../shared/engine/botlogic/code/BotCode.js";
import { brainRuleErrors } from "../../../../../../shared/engine/botlogic/code/configuration/brainRules.js";
import { countLaneEntries } from "../../../../../../shared/engine/botlogic/code/configuration/configurationMetrics.js";
import { buildStatePayload } from "../../../../../../shared/engine/modelPayloads/strategyStatePayload.js";
import { simulateFight } from "../../../../../../shared/engine/simulateFight.js";
import { ACTION_TO_ABILITY, encodeBotLoadout } from "../../../../../../shared/engine/loadout/BotLoadout.js";
import { isBotState } from "../../../../../../shared/engine/modelPayloads/botState.js";
import { trackComboState } from "../../../../../../shared/engine/fight.js";

// Lanes brains (bot-logic-lanes-v1, docs/LANES.md): normalization, sections, one action at a time, combos,
// attached movement, modes and switches, segment carry-over.

const LANES = "bot-logic-lanes-v1";
const always = [{ type: "always" }];
const walkToEnemy = { action: "move_walk", movementMode: "target", movementDirection: 0, selectable: "opponent_1" };
const faceEnemy = { action: "rotate_toward_enemy", selectable: "opponent_1" };
const slash = { action: 1, selectable: "opponent_1" };
const dashAway = { action: 19, movementMode: "target", movementDirection: 180, selectable: "opponent_1" };
const cancelWindup = { action: "cancel_windup" };
const SLASH_ABILITY = ACTION_TO_ABILITY[1];
const DASH_ABILITY = ACTION_TO_ABILITY[19];
const numberIs = (left, comparator, value, extra = {}) => ({ type: "expression", left, comparator, right: { type: "number", value }, ...extra });
const card = (id, action, conditions = always, extra = {}) => ({ id, conditions, action, ...extra });
const mode = (id, name, sections = {}, switches = []) => ({ id, name, switches, ...sections });
const brain = (modes, shared = {}, extra = {}) => ({ version: LANES, modes, shared, ...extra });

const BOT_REQUEST = (main, extra = {}) => ({
    matchId: "11111111-1111-4111-8111-111111111111",
    rulesetVersion: "duel-v3",
    seed: 1,
    arena: { width: 1200, height: 1200, durationMs: 1000 },
    bots: [
        { userId: "00000000-0000-4000-8000-000000000001", username: "a", slot: 1, x: 300, y: 600, rotation: 90, size: 60,
            selectedLoadout: "custom", teamNumber: 1, brain: { ...main, loadout: { abilities: [1] } } },
        { userId: "00000000-0000-4000-8000-000000000002", username: "b", slot: 2, x: 900, y: 600, rotation: 270, size: 60,
            selectedLoadout: "custom", teamNumber: 2, brain: { version: "bot-logic-tree-v2", roots: [], loadout: { abilities: [] } } },
    ],
    ...extra,
});

/** A two-bot fight: the lanes brain is the main bot's; the opponent idles. Returns each tick's main bot and the last frame. */
function runFight(lanesBrain, ticks) {
    const request = BOT_REQUEST(lanesBrain, { arena: { width: 1200, height: 1200, durationMs: ticks * 100 } });
    const bots = [];
    let lastFrame = null;
    simulateFight(request, { onTick: (fight) => {
        bots.push({ ...fight.bots.find((bot) => bot.slot === 1) });
        lastFrame = fight.frame();
    } });
    return { bots, lastFrame };
}

/** Plans one tick from a frame of the fight, with the main bot's fields patched. */
function planWithBot(configuration, patch) {
    const { lastFrame } = runFight(configuration, 1);
    const frame = lastFrame.map((shape) => (isBotState(shape) && shape.slot === 1 ? { ...shape, abilityState: {}, ...patch } : shape));
    return selectAbilityStrategyActionPlan(configuration, buildStatePayload(frame, encodeBotLoadout({ abilities: [] }), "main"));
}

const windingUp = (abilityId) => ({ [abilityId]: { stage: "windup", remainingMs: 200 } });
const activeFor = (abilityId) => ({ [abilityId]: { stage: "active", remainingMs: 300 } });

test("normalization keeps sections and ids, omits empty ones, marks only disabled cards, and is stable", () => {
    const once = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        movement: [card("walk", walkToEnemy), card("off", walkToEnemy, always, { enabled: false })],
        actions: [card("slash", slash)],
    })]));
    const [neutral] = once.modes;
    assert.deepEqual(Object.keys(neutral).sort(), ["actions", "id", "movement", "name"]);
    assert.equal(neutral.movement[1].enabled, false);
    assert.equal("enabled" in neutral.movement[0], false);
    assert.equal("variables" in neutral, false, "an empty section is left out");
    assert.equal("switches" in neutral, false, "an empty switch list is left out");
    assert.deepEqual(normalizeAbilityStrategyConfiguration(once), once);
});

test("missing ids take a positional fallback that normalization then keeps", () => {
    const once = normalizeAbilityStrategyConfiguration(brain([mode("", "Neutral", {
        movement: [{ conditions: always, action: walkToEnemy }],
    })]));
    assert.equal(once.modes[0].id, "mode-1");
    assert.equal(once.modes[0].movement[0].id, "card-mode-1-movement-1");
    assert.deepEqual(normalizeAbilityStrategyConfiguration(once), once);
});

test("section membership is a brain rule: a move or rotation in Movement, an ability in Actions, a variable in Variables", () => {
    assert.deepEqual(brainRuleErrors(normalizeAbilityStrategyConfiguration(brain([mode("n", "N", {
        movement: [card("walk", walkToEnemy), card("face", faceEnemy)],
        actions: [card("slash", slash), card("dash", dashAway), card("cancel", cancelWindup)],
    })]))), []);
    const errors = brainRuleErrors(normalizeAbilityStrategyConfiguration(brain([mode("n", "N", {
        movement: [card("slash", slash)],
    })])));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /movement section/);
});

test("attached movement: only ability cards carry it, and it holds a move and a rotation respectively", () => {
    const rulesFor = (cards) => brainRuleErrors(normalizeAbilityStrategyConfiguration(brain([mode("n", "N", { actions: cards })])));
    assert.deepEqual(rulesFor([card("slash", slash, always, { move: walkToEnemy, face: faceEnemy })]), []);
    assert.match(rulesFor([card("dash", dashAway, always, { move: walkToEnemy })])[0], /only ability cards/);
    assert.match(rulesFor([card("slash", slash, always, { move: faceEnemy })])[0], /must be a move action/);
    assert.match(rulesFor([card("slash", slash, always, { face: walkToEnemy })])[0], /must be a rotation action/);
});

test("follow-ups are a brain rule: ability and dash cards only, ability, dash or cancel children, at most three levels down, unique ids", () => {
    const rulesFor = (section, cards) => brainRuleErrors(normalizeAbilityStrategyConfiguration(brain([mode("n", "N", { [section]: cards })])));
    assert.match(rulesFor("movement", [card("walk", walkToEnemy, always, { followUps: [card("dash", dashAway)] })])[0], /only ability and dash cards/);
    assert.match(rulesFor("actions", [card("cancel", cancelWindup, always, { followUps: [card("dash", dashAway)] })])[0], /only ability and dash cards/);
    assert.match(rulesFor("actions", [card("slash", slash, always, { followUps: [card("walk", walkToEnemy)] })])[0], /follow-up is an ability, dash or cancel/);
    const deep = card("c0", slash, always, { followUps: [card("c1", dashAway, always, { followUps: [card("c2", slash, always, { followUps: [card("c3", dashAway, always, { followUps: [card("c4", slash)] })] })] })] });
    assert.match(rulesFor("actions", [deep])[0], /nests deeper than 3/);
    const three = card("c0", slash, always, { followUps: [card("c1", dashAway, always, { followUps: [card("c2", slash, always, { followUps: [card("c3", dashAway)] })] })] });
    assert.deepEqual(rulesFor("actions", [three]), []);
    assert.match(rulesFor("actions", [card("top", slash, always, { followUps: [card("same", dashAway), card("same", dashAway)] })])[0], /repeats the ID same/);
});

test("bounds count disabled cards and switches, follow-ups included, and conditions across the whole brain", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([
        mode("neutral", "Neutral", {
            movement: [card("walk", walkToEnemy), card("off", walkToEnemy, always, { enabled: false })],
            actions: [card("slash", slash, [numberIs("bot.timeInModeMs", "gte", 0)], { followUps: [card("dash", dashAway)] })],
        }, [{ id: "to-punish", to: "punish", conditions: always }]),
        mode("punish", "Punish", {}),
    ], { movement: [card("face", faceEnemy)] }));
    assert.deepEqual(countLaneEntries(configuration), { modes: 2, cards: 5, switches: 1, conditions: 6 });
});

test("a switch goes to another mode, and the first card whose conditions hold and can act wins its section", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([
        mode("neutral", "Neutral", {
            movement: [card("never", walkToEnemy, [numberIs("match.elapsedSeconds", "lt", 0)]), card("walk", walkToEnemy)],
        }, [{ id: "to-punish", to: "punish", conditions: always }]),
        mode("punish", "Punish", {}),
    ]));
    const [first] = runFight(configuration, 1).bots;
    assert.equal(first.modeId, "punish", "the switch takes effect in the tick it fires");
    assert.equal(first.timeInModeMs, 100, "time in mode counts whole ticks from the switch");
});

test("time in mode drives a switch back and restarts the count", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([
        mode("neutral", "Neutral", { movement: [card("walk", walkToEnemy)] }, [{ id: "to-punish", to: "punish", conditions: always }]),
        mode("punish", "Punish", {}, [{ id: "to-neutral", to: "neutral", conditions: [numberIs("bot.timeInModeMs", "gte", 300)] }]),
    ]));
    const modes = runFight(configuration, 5).bots.map((bot) => bot.modeId);
    assert.deepEqual(modes, ["punish", "punish", "punish", "neutral", "punish"]);
});

test("the variables section runs every card that applies, top to bottom", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        movement: [card("walk", walkToEnemy)],
        variables: [
            card("set", { action: "variable", variableId: "custom.count", value: 1 }),
            card("add", { action: "variable", variableId: "custom.count", terms: [{ operator: "add", operand: { type: "number", value: 2 } }] }),
        ],
    })], undefined, { customVariables: [{ id: "custom.count", name: "COUNT", valueType: "number", initialValue: 0 }] }));
    const plan = planWithBot(configuration, {});
    assert.equal(plan.customVariables["custom.count"], 3, "set to 1, then add 2, in card order");
    assert.deepEqual(plan.winners.variables, ["set", "add"]);
});

test("the plan names the mode, time in mode, and the card that won each section", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        movement: [card("walk", walkToEnemy)],
        actions: [card("slash", slash)],
    })], { movement: [card("face", faceEnemy)] }));
    const plan = planWithBot(configuration, {});
    assert.deepEqual(plan.winners, { move: "walk", face: "face", action: "slash" });
    assert.equal(plan.modeId, "neutral");
    assert.equal(plan.timeInModeMs, 100, "the bot has been in the mode for the one tick the frame ran");
    assert.equal("comboStepId" in plan, false, "a card with no follow-ups or attached movement is no combo step");
});

test("one action at a time: a running ability blocks the next Actions card, and a cancel card may act while it winds up", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [card("dash", dashAway), card("slash", slash), card("cancel", cancelWindup)],
    })]));
    const idle = planWithBot(configuration, {});
    assert.equal(idle.winners.action, "dash", "the top card that can act wins");
    const windup = planWithBot(configuration, { abilityState: windingUp(SLASH_ABILITY) });
    assert.equal(windup.winners.action, "cancel", "nothing new starts while a wind-up runs, except a cancel");
    assert.equal(windup.ability, undefined);
    assert.equal(windup.dash, undefined);
    const active = planWithBot(configuration, { abilityState: activeFor(SLASH_ABILITY) });
    assert.equal(active.winners.action, undefined, "an active ability blocks every Actions card, cancel included");
});

test("a dash in progress blocks the next action (the dash channel's own state)", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [card("slash", slash)],
    })]));
    assert.equal(planWithBot(configuration, {}).winners.action, "slash");
    assert.equal(planWithBot(configuration, { abilityState: activeFor(DASH_ABILITY) }).winners.action, undefined);
});

test("a combo: after its step's action ends, the step's follow-ups go first; the first that can act starts", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [
            card("plain-dash", dashAway),
            card("slash", slash, always, { followUps: [card("dash-away", dashAway)] }),
        ],
    })]));
    const ended = planWithBot(configuration, { comboStepId: "slash" });
    assert.equal(ended.winners.action, "dash-away", "the follow-up beats the mode's own dash card");
    assert.equal("comboStepId" in ended, false, "dash-away has no follow-ups, so no step is kept");
});

test("while the step still winds up or is active, its follow-ups wait and the step is kept", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [
            card("plain-dash", dashAway),
            card("slash", slash, always, { followUps: [card("dash-away", dashAway)] }),
        ],
    })]));
    const wind = planWithBot(configuration, { comboStepId: "slash", abilityState: windingUp(SLASH_ABILITY) });
    assert.equal(wind.winners.action, undefined, "no new action starts while the step winds up");
    assert.equal(wind.comboStepId, "slash");
    const active = planWithBot(configuration, { comboStepId: "slash", abilityState: activeFor(SLASH_ABILITY) });
    assert.equal(active.comboStepId, "slash");
    assert.equal(active.winners.action, undefined);
});

test("when no follow-up can act, the combo ends and the Actions cards decide in the same tick", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [
            card("plain-dash", dashAway),
            card("slash", slash, always, { followUps: [card("dash-away", dashAway, [numberIs("match.elapsedSeconds", "lt", 0)])] }),
        ],
    })]));
    const plan = planWithBot(configuration, { comboStepId: "slash" });
    assert.equal(plan.winners.action, "plain-dash");
    assert.equal("comboStepId" in plan, false);
});

test("a switch ends a combo but not a running action; a missing or disabled step is dropped too", () => {
    const switching = normalizeAbilityStrategyConfiguration(brain([
        mode("neutral", "Neutral", {}, [{ id: "to-punish", to: "punish", conditions: always }]),
        mode("punish", "Punish", { actions: [card("plain-dash", dashAway)] }),
    ], { actions: [card("slash", slash, always, { followUps: [card("dash-away", dashAway)] })] }));
    const afterSwitch = planWithBot(switching, { comboStepId: "slash", modeId: "neutral", timeInModeMs: 0 });
    assert.equal(afterSwitch.modeId, "punish");
    assert.equal(afterSwitch.winners.action, "plain-dash");
    assert.equal("comboStepId" in afterSwitch, false);

    const disabled = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [
            card("plain-dash", dashAway),
            card("slash", slash, always, { enabled: false, followUps: [card("dash-away", dashAway)] }),
        ],
    })]));
    assert.equal(planWithBot(disabled, { comboStepId: "slash" }).winners.action, "plain-dash");
    assert.equal(planWithBot(disabled, { comboStepId: "removed" }).winners.action, "plain-dash");
});

test("attached movement replaces the Movement choice while its ability winds up or is active, and not after", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        movement: [card("walk", walkToEnemy), card("face", faceEnemy)],
        actions: [card("slash", slash, always, {
            move: { ...walkToEnemy, movementDirection: 180 },
            face: { action: "rotate_toward_enemy", selectable: "my_bot" },
        })],
    })]));
    const idle = planWithBot(configuration, {});
    assert.equal(idle.movement.movementDirection, 0, "no action running: the Movement card walks in");
    const attached = planWithBot(configuration, { runningActionCardId: "slash", abilityState: windingUp(SLASH_ABILITY) });
    assert.equal(attached.movement.movementDirection, 180, "the attached move walks away while the slash winds up");
    assert.equal(attached.rotation.selectable, "my_bot", "the attached face replaces the Movement face");
    assert.equal(attached.winners.move, "slash");
    const ended = planWithBot(configuration, { runningActionCardId: "slash" });
    assert.equal(ended.movement.movementDirection, 0, "once the slash ends, Movement decides again");
});

test("a combo carries its step through a simulated fight: the dash follow-up waits for the slash to end", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [card("slash", slash, always, { followUps: [card("dash-away", dashAway, always, { followUps: [card("again", slash)] })] })],
    })]));
    const { bots } = runFight(configuration, 40);
    const dashTick = bots.findIndex((bot) => bot.triggeredAbility === 19);
    assert.ok(dashTick > 0, "the Dash follow-up fires");
    assert.equal(bots[dashTick].comboStepId, "dash-away", "the dash that started is the new combo step");
    assert.ok(bots.slice(0, dashTick).every((bot) => bot.triggeredAbility !== 19), "the dash waits for the slash to end");
});

test("a segment keeps the mode when the next brain still has it, and starts the first mode otherwise", () => {
    const first = brain([
        mode("neutral", "Neutral", { movement: [card("walk", walkToEnemy)] }, [{ id: "to-punish", to: "punish", conditions: [numberIs("bot.timeInModeMs", "gte", 100000)] }]),
        mode("punish", "Punish", {}),
    ]);
    const kept = brain([mode("neutral", "Neutral", { movement: [card("walk", walkToEnemy)] }), mode("punish", "Punish", {})]);
    const replaced = brain([mode("other", "Other", {}), mode("alt", "Alt", {})]);
    const bothEnded = (nextBrain) => {
        const request = BOT_REQUEST(first, {
            segments: [
                { endsAtMs: 1000, bots: [] },
                { endsAtMs: 2000, bots: [{ slot: 1, selectedLoadout: "custom", brain: { ...nextBrain, loadout: { abilities: [1] } }, variableResets: [] }] },
            ],
        });
        const seen = [];
        simulateFight(request, { onTick: (fight, elapsedMs) => seen.push([elapsedMs, { ...fight.bots.find((bot) => bot.slot === 1) }]) });
        return seen.find(([elapsedMs]) => elapsedMs === 1100)[1];
    };
    const keptBot = bothEnded(kept);
    assert.equal(keptBot.modeId, "neutral");
    assert.ok(keptBot.timeInModeMs > 0, "time in mode keeps counting when the mode is kept");
    const replacedBot = bothEnded(replaced);
    assert.equal(replacedBot.modeId, "other");
    assert.equal(replacedBot.timeInModeMs, 100, "a replaced mode starts at 0 and counts the tick it ran");
});

test("a lanes brain carries no mode or combo step in a replay", () => {
    const configuration = brain([mode("neutral", "Neutral", {
        actions: [card("slash", slash, always, { followUps: [card("dash-away", dashAway)] })],
    })]);
    const { replay } = simulateFight(BOT_REQUEST(configuration));
    for (const batch of replay.batches) {
        for (const frame of batch.frames) {
            for (const shape of frame.shapes) {
                if (shape.kind !== "bot") continue;
                assert.equal("comboStepId" in shape, false);
            }
        }
    }
});

test("a card with attached movement but no follow-ups sets only the running action, not a combo step", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([mode("neutral", "Neutral", {
        actions: [card("slash", slash, always, { move: walkToEnemy })],
    })]));
    const plan = planWithBot(configuration, {});
    assert.equal(plan.winners.action, "slash");
    assert.equal(plan.startedCardId, "slash");
    assert.equal(plan.runningActionCardId, "slash");
    assert.equal("comboStepId" in plan, false);
});

test("a running action keeps its attached movement through a mode switch; a combo step does not", () => {
    const configuration = normalizeAbilityStrategyConfiguration(brain([
        mode("neutral", "Neutral", {
            movement: [card("walk", walkToEnemy)],
            actions: [card("slash", slash, always, { move: { ...walkToEnemy, movementDirection: 180 } })],
        }, [{ id: "to-punish", to: "punish", conditions: always }]),
        mode("punish", "Punish", {}),
    ]));
    const plan = planWithBot(configuration, { modeId: "neutral", runningActionCardId: "slash", comboStepId: "slash", abilityState: windingUp(SLASH_ABILITY) });
    assert.equal(plan.modeId, "punish", "the switch fires");
    assert.equal(plan.movement.movementDirection, 180, "the running slash keeps its attached move");
    assert.equal(plan.winners.move, "slash");
    assert.equal("comboStepId" in plan, false, "the combo ends with the switch");
});

test("a card that wins its section but does not start leaves no combo step and no running action", () => {
    const won = {
        mode: {
            modeId: "neutral", timeInModeMs: 0, winners: { action: "slash" },
            startedCardId: "slash", comboStepId: "slash", runningActionCardId: "slash",
        },
        abilityAction: { action: 1, selectable: "opponent_1" },
    };
    const notTriggered = {};
    trackComboState(notTriggered, won);
    assert.equal("comboStepId" in notTriggered, false, "not triggered: no combo step");
    assert.equal("runningActionCardId" in notTriggered, false, "not triggered: no running action");

    const started = { triggeredAbility: 1, hp: 100 };
    trackComboState(started, won);
    assert.equal(started.comboStepId, "slash", "triggered: the step is kept");
    assert.equal(started.runningActionCardId, "slash");

    const dead = { triggeredAbility: 1, hp: 0 };
    trackComboState(dead, won);
    assert.equal("comboStepId" in dead, false, "a dead bot has no combo");

    const kept = { hp: 100, comboStepId: "slash" };
    trackComboState(kept, { mode: { modeId: "neutral", timeInModeMs: 100, comboStepId: "slash" }, abilityAction: null });
    assert.equal(kept.comboStepId, "slash", "a kept step (no new start this tick) is taken as planned");
});
