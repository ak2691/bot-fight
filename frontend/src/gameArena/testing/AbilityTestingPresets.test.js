import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ABILITY_DEFINITIONS, BOT_ABILITIES, STANDARD_ABILITY_IDS, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { actionTypesForLoadout } from "../gameconfig/CombatLoadouts.js";
import { ACTION_TYPES } from "../botlogic/code/BotCode.js";
import { ABILITY_TEST_PRESETS, abilityTestingPreset, buildAbilityTestingArenaShapes, findAbilityTestingPreset, getAbilityTestingPreset } from "./AbilityTestingPresets.js";

test("Basic Heal uses its canonical ID and preserves compact code e", () => {
    const ability = BOT_ABILITIES.find(({ id }) => id === 10);
    assert.ok(ability);
    assert.equal(ability.label, "Basic Heal");
    assert.deepEqual(ability.actions, [10]);
    assert.equal(ability.stats.healing, 15);
    assert.equal(ability.stats.cooldownMs, 12000);
    assert.equal(ability.stats.windupMs, 800);
    assert.equal(encodeBotLoadout({ abilities: ["basic_heal"] }), "custom:e:0,0,0,0");
    assert.deepEqual(decodeBotLoadout("custom:e:0,0,0,0").abilities, [10]);
});

test("standard abilities are granted to every bot and excluded from configurable loadouts", () => {
    assert.deepEqual(STANDARD_ABILITY_IDS, [19, 20]);
    assert.equal(BOT_ABILITIES.some(({ id }) => id === 19 || id === 20), false);
    assert.deepEqual(normalizedBotLoadout({ abilities: [19, 19, 20, 1] }).abilities, [1]);
    assert.equal(encodeBotLoadout({ abilities: ["dash", "lock_on"] }), "custom::0,0,0,0");
});

test("sandbox loadouts keep equipped selectable actions alongside standard actions", () => {
    const actions = actionTypesForLoadout(ACTION_TYPES, "sandbox:swing,heavy_slash:0,0,0,0").map(({ id }) => id);
    assert.ok(actions.includes(1));
    assert.ok(actions.includes(7));
    assert.ok(actions.includes(19));
    assert.ok(actions.includes(20));
});

test("ability test lab has one prepared preset for every selectable and standard ability", () => {
    assert.equal(ABILITY_TEST_PRESETS.length, ALL_ABILITY_DEFINITIONS.length);
    assert.deepEqual(
        ABILITY_TEST_PRESETS.map((preset) => preset.id),
        ALL_ABILITY_DEFINITIONS.map((ability) => ability.id),
    );
    for (const preset of ABILITY_TEST_PRESETS) {
        const playerLoadout = decodeBotLoadout(preset.playerLoadout);
        if (STANDARD_ABILITY_IDS.includes(preset.id)) assert.deepEqual(playerLoadout.abilities, []);
        else assert.deepEqual(playerLoadout.abilities, [preset.id]);
        assert.equal(preset.playerCode.loadout, preset.playerLoadout);
        assert.equal(preset.opponentCode.loadout, preset.opponentLoadout);
        assert.ok(preset.playerCode.roots.some((root) => root.branches[0].actions.some((action) => action.action === preset.id)));
        const shapes = buildAbilityTestingArenaShapes(preset);
        assert.equal(shapes.length, 2);
        assert.deepEqual(shapes[0].abilities, [...STANDARD_ABILITY_IDS, ...playerLoadout.abilities]);
        assert.ok(shapes[0].abilities.includes(preset.id));
        assert.equal(shapes[0].combatLoadout, preset.playerLoadout);
    }
});

test("catalogue IDs resolve through the allowlisted preset registry", () => {
    const fireball = findAbilityTestingPreset("shoot_fireball");
    assert.equal(fireball?.id, 5);
    assert.equal(findAbilityTestingPreset("not-an-ability"), null);
    assert.equal(abilityTestingPreset("not-an-ability"), null);
    const fresh = abilityTestingPreset("shoot_fireball");
    assert.notEqual(fresh, fireball);
    assert.notEqual(fresh.playerCode, fireball.playerCode);
    assert.equal(fresh.playerLoadout, fireball.playerLoadout);
    assert.equal(getAbilityTestingPreset("not-an-ability").id, ABILITY_TEST_PRESETS[0].id);
});

test("presets expose stat values and no longer depend on lab levels or categories", () => {
    for (const preset of ABILITY_TEST_PRESETS) {
        assert.ok(preset.stats && typeof preset.stats === "object", preset.id);
        assert.equal(Object.hasOwn(preset, "level"), false, preset.id);
        assert.equal(Object.hasOwn(preset, "category"), false, preset.id);
    }
    assert.equal(getAbilityTestingPreset(25).delivery.type, "melee");
    assert.equal(getAbilityTestingPreset(25).stats.range, 100);
});

test("distance-based damage settings expose compact damage and range breakpoints", () => {
    assert.deepEqual(getAbilityTestingPreset(4).stats.damageByRange, [50, 45, 40, 35, 30, 25]);
    assert.deepEqual(getAbilityTestingPreset(4).stats.damageRanges, [0, 8, 22, 36, 50, 64]);
    assert.equal(getAbilityTestingPreset(4).stats.damageMinRadius, 0);
    assert.equal(getAbilityTestingPreset(4).stats.damageMaxRadius, 70);

    assert.deepEqual(getAbilityTestingPreset("gravity_grenade").stats.damageByRange, [35, 30, 25, 20]);
    assert.deepEqual(getAbilityTestingPreset("gravity_grenade").stats.damageRanges, [0, 30, 60, 90]);
    assert.deepEqual(getAbilityTestingPreset("proximity_mine").stats.damageByRange, [18]);
    assert.deepEqual(getAbilityTestingPreset("proximity_mine").stats.damageRanges, [0]);

    assert.deepEqual(getAbilityTestingPreset("fire_gun").stats.damageByRange, [15, 10, 5, 2]);
    assert.deepEqual(getAbilityTestingPreset("fire_gun").stats.damageRanges, [100, 300, 500, 700]);
    assert.deepEqual(getAbilityTestingPreset("pistol_shot").stats.damageByRange, [8, 6, 4]);
    assert.deepEqual(getAbilityTestingPreset("pistol_shot").stats.damageRanges, [0, 166.67, 333.33]);
    assert.deepEqual(getAbilityTestingPreset("orbital_strike").stats.damageByRange, [50, 13]);
    assert.deepEqual(getAbilityTestingPreset("orbital_strike").stats.damageRanges, [0, 130]);
    assert.equal(getAbilityTestingPreset("orbital_strike").stats.damageRangeMode, "continuous");
});

test("close-range attack presets put the target inside their hitbox", () => {
    const closeRangeIds = new Set([1, 7, 8, 17, 18]);
    for (const preset of ABILITY_TEST_PRESETS.filter((candidate) => closeRangeIds.has(candidate.id))) {
        const distance = Math.hypot(
            preset.playerPosition.x - preset.opponentPosition.x,
            preset.playerPosition.y - preset.opponentPosition.y,
        );
        assert.ok(distance <= 100, `${preset.id} should start close enough to hit`);
    }
});

test("silence pulse preset starts the practice charge inside the interruption window", () => {
    const preset = ABILITY_TEST_PRESETS.find((candidate) => candidate.id === 15);
    const castRoot = preset.opponentCode.roots.at(-1);
    assert.deepEqual(castRoot.branches[0].conditions, [{
        type: "expression",
        left: "match.elapsedSeconds",
        comparator: "gte",
        right: { type: "number", value: 0.8 },
    }]);
});

test("preset codes use the same opponent loadouts as their replay scenarios", () => {
    assert.deepEqual(decodeBotLoadout(getAbilityTestingPreset(6).opponentLoadout).abilities, [13]);
    assert.deepEqual(decodeBotLoadout(getAbilityTestingPreset(10).opponentLoadout).abilities, [1]);
    assert.deepEqual(decodeBotLoadout(getAbilityTestingPreset(25).opponentLoadout).abilities, [2]);
    assert.deepEqual(decodeBotLoadout(getAbilityTestingPreset(23).opponentLoadout).abilities, [22]);
});

test("movement ability presets include an approach node while mine still uses target movement", () => {
    for (const id of [21]) {
        const preset = getAbilityTestingPreset(id);
    const actions = preset.playerCode.roots.flatMap((root) => root.branches.flatMap((branch) => branch.actions));
        assert.deepEqual(actions.find((action) => action.action === "move_walk"), {
            action: "move_walk",
            movementMode: "target",
            movementDirection: "toward",
            actionTarget: "opponent",
        });
    }
    const mineActions = getAbilityTestingPreset(11).opponentCode.roots
        .flatMap((root) => root.branches.flatMap((branch) => branch.actions));
    assert.deepEqual(mineActions[0], {
        action: "move_walk",
        movementMode: "target",
        movementDirection: "toward",
        actionTarget: "opponent",
    });
});
