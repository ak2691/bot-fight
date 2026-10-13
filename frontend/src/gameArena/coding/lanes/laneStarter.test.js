import assert from "node:assert/strict";
import test from "node:test";
import { abilityBaseRange } from "../../../../../shared/engine/loadout/abilityBaseRange.js";
import { validateAbilityStrategyConfiguration } from "../../botlogic/code/validateBrain.js";
import { createLanesStarter, STARTER_MODE_ID } from "./laneStarter.js";

test("the starter is one mode named Main with Walk and Face in Movement, and one Actions card per ranged equipped ability", () => {
    const starter = createLanesStarter([19, 1, 3, 8]);
    assert.equal(starter.version, "bot-logic-lanes-v1");
    assert.equal(starter.modes.length, 1);
    assert.equal(starter.modes[0].id, STARTER_MODE_ID);
    assert.equal(starter.modes[0].name, "Main");
    assert.deepEqual(starter.shared, {});

    const mode = starter.modes[0];
    assert.deepEqual(mode.movement.map((card) => card.action.action), ["move_walk", "rotate_toward_enemy"]);
    // Ability 19 is movement-only and 8 is a circle: neither has a base range, so neither gets a card.
    assert.equal(abilityBaseRange(8), null);
    assert.equal(abilityBaseRange(19), null);
    assert.deepEqual(mode.actions.map((card) => card.id), ["card-ability-1", "card-ability-3"]);
});

test("each Ability card reads: when the enemy is within this ability's base range, use it on the nearest enemy", () => {
    const [card] = createLanesStarter([1]).modes[0].actions;
    assert.equal(card.action.action, 1);
    assert.equal(card.action.selectable, "opponent_1");
    assert.equal(card.conditions.length, 1);
    const [condition] = card.conditions;
    assert.equal(condition.left, "selectable.distance");
    assert.equal(condition.comparator, "lte");
    assert.deepEqual(condition.right, { type: "variable", value: "bot.selectedAbilityBaseRange" });
    assert.equal(condition.ability, 1);
});

test("the starter for an empty loadout still has Walk and Face and no Actions card", () => {
    const starter = createLanesStarter([]);
    assert.equal(starter.modes[0].actions, undefined);
    assert.equal(starter.modes[0].movement.length, 2);
});

test("the starter validates with the editor's full checks", () => {
    for (const abilities of [[], [1, 3, 4, 5, 19, 28, 35, 45], [1, 3, 4, 5, 6, 8, 15, 18, 19, 25, 28, 30, 32, 35, 36, 37, 39, 40, 45, 46, 47]]) {
        const { errors } = validateAbilityStrategyConfiguration(createLanesStarter(abilities));
        assert.deepEqual(errors, [], `loadout ${abilities.join(",")}`);
    }
});

test("the starter's ability cards name equipped abilities for the loadout code the editor passes", async () => {
    // CodingPanel passes the encoded loadout (a "custom:" code) as selectedLoadout, and the starter gets the same
    // equipped ids; every card's action must be one the editor offers for that loadout, or it reads "Ability not equipped".
    const { actionTypesForLoadout } = await import("../../gameconfig/CombatLoadouts.js");
    const { ACTION_TYPES } = await import("../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js");
    const { encodeBotLoadout, decodeBotLoadout, STANDARD_ABILITY_IDS, SELECTABLE_BOT_ABILITIES } = await import("../../../../../shared/engine/loadout/BotLoadout.js");
    const loadout = encodeBotLoadout({ abilities: SELECTABLE_BOT_ABILITIES.slice(0, 3).map((ability) => ability.id) });
    const equipped = [...STANDARD_ABILITY_IDS, ...decodeBotLoadout(loadout).abilities];
    const offered = new Set(actionTypesForLoadout(ACTION_TYPES, loadout).map((action) => action.id));
    const starter = createLanesStarter(equipped);
    const cards = [...(starter.modes[0].movement ?? []), ...(starter.modes[0].actions ?? [])];
    assert.ok(cards.length >= 3);
    for (const card of cards) assert.ok(offered.has(card.action.action), `${card.id} is not offered by ${loadout}`);
});
