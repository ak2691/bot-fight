import test from "node:test";
import assert from "node:assert/strict";
import { STANDARD_ABILITY_IDS, decodeBotLoadout, encodeBotLoadout } from "../loadout/BotLoadout.js";
import { buildAbilityTestingArenaShapes, getAbilityTestingPreset } from "./AbilityTestingPresets.js";
import { buildAbilityTestingPlayback, stepAbilityTestingSimulation } from "./AbilityTestingSimulation.js";

test("local ability replay carries the same encoded loadouts as its bots", () => {
    const preset = getAbilityTestingPreset(6);
    const playback = buildAbilityTestingPlayback({ preset });
    const initialById = new Map(playback.initialState.bots.map((bot) => [bot.id, bot]));

    assert.equal(initialById.get("main").combatLoadout, preset.playerLoadout);
    assert.equal(initialById.get("opponent-model").combatLoadout, preset.opponentLoadout);
    assert.deepEqual(initialById.get("main").abilities, [...STANDARD_ABILITY_IDS, ...decodeBotLoadout(preset.playerLoadout).abilities]);
    assert.deepEqual(initialById.get("opponent-model").abilities, [...STANDARD_ABILITY_IDS, ...decodeBotLoadout(preset.opponentLoadout).abilities]);
    assert.ok(playback.frames.length > 0);
    assert.ok(playback.frames.every((frame) => frame.bots.every((bot) => bot.combatLoadout.startsWith("custom:"))));
    const stunFrame = playback.frames.find((frame) => {
        const bot = frame.bots.find((candidate) => candidate.id === "main");
        return Number(bot?.abilityActiveMs?.[6] ?? 0) > 0 && bot?.triggeredAbility === 6;
    });
    assert.ok(stunFrame, "the test replay must retain the Bot Room Stun animation timer");
    assert.equal(stunFrame.bots.find((bot) => bot.id === "main").triggeredAbility, 6);
});

test("local ability replay accepts the current client payload instead of a preset code plan", () => {
    const preset = getAbilityTestingPreset(1);
    const playerLoadout = encodeBotLoadout({ abilities: [3] });
    const playback = buildAbilityTestingPlayback({
        preset,
        playerLoadout,
        playerCode: {
            ...preset.playerCode,
            roots: [],
        },
    });

    assert.equal(playback.player.selectedLoadout, playerLoadout);
    assert.deepEqual(playback.initialState.bots.find((bot) => bot.id === "main").abilities, [...STANDARD_ABILITY_IDS, 3]);
    assert.equal(playback.initialState.bots.find((bot) => bot.id === "main").combatLoadout, playerLoadout);
});

test("ability testing steps the edited room state instead of restoring preset positions", () => {
    const preset = getAbilityTestingPreset(5);
    const playerLoadout = encodeBotLoadout({ abilities: [3] });
    const opponentLoadout = encodeBotLoadout({ abilities: [1] });
    const emptyCode = { version: "bot-logic-tree-v1", roots: [], customVariables: [] };
    const editedShapes = buildAbilityTestingArenaShapes({
        ...preset,
        playerLoadout,
        opponentLoadout,
        playerPosition: { x: 240, y: 280 },
        opponentPosition: { x: 760, y: 720 },
    });

    const nextShapes = stepAbilityTestingSimulation(editedShapes, {
        playerCode: emptyCode,
        opponentCode: emptyCode,
        playerLoadout,
        opponentLoadout,
    });
    const player = nextShapes.find((shape) => shape.id === "main");
    const opponent = nextShapes.find((shape) => shape.id === "opponent-model");

    assert.equal(player.x, 240);
    assert.equal(player.y, 280);
    assert.equal(opponent.x, 760);
    assert.equal(opponent.y, 720);
    assert.deepEqual(player.abilities, [...STANDARD_ABILITY_IDS, 3]);
    assert.deepEqual(opponent.abilities, [...STANDARD_ABILITY_IDS, 1]);
});

test("test replays retain Bot Room animation state for every bot animation family", () => {
    const cases = [
        [1, (bot) => Number(bot.abilityActiveMs?.[1] ?? 0) > 0 && bot.triggeredAbility === 1],
        [2, (bot) => Number(bot.abilityActiveMs?.[2] ?? 0) > 0],
        [3, (bot) => Number(bot.abilityActiveMs?.[3] ?? 0) > 0 && bot.triggeredAbility === 3],
        [6, (bot) => Number(bot.abilityActiveMs?.[6] ?? 0) > 0 && bot.triggeredAbility === 6],
        [19, (bot) => Number(bot.microDashActiveMs ?? 0) > 0],
        [7, (bot) => Number(bot.abilityActiveMs?.[7] ?? 0) > 0],
    ];
    for (const [abilityId, hasAnimationState] of cases) {
        const playback = buildAbilityTestingPlayback({ preset: getAbilityTestingPreset(abilityId) });
        assert.ok(playback.frames.some((frame) => hasAnimationState(frame.bots.find((bot) => bot.id === "main") ?? {})), abilityId);
    }
});
