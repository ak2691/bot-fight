import assert from "node:assert/strict";
import test from "node:test";
import { BASE_BOT_HP } from "../modelPayloads/arenaConstants.js";
import { toSimulationBotShape } from "../modelPayloads/arenaShapes.js";
import {
    buildAbilityTestingArenaShapes,
    buildAbilityTestingPracticeConfig,
    findAbilityTestingPreset,
} from "./AbilityTestingPresets.js";

test("ability testing presets preserve their starting transforms in practice reset config", () => {
    const preset = findAbilityTestingPreset(24);
    const config = buildAbilityTestingPracticeConfig(preset);
    const expected = [
        ["PLAYER", preset.playerPosition.x, preset.playerPosition.y, preset.playerRotation],
        ["OPPONENT", preset.opponentPosition.x, preset.opponentPosition.y, preset.opponentRotation],
    ];

    assert.deepEqual(config.bots.map((bot) => [bot.role, bot.startX, bot.startY, bot.rotation]), expected);
    assert.deepEqual(config.bots.map((bot) => bot.startHp), [BASE_BOT_HP, BASE_BOT_HP]);
    assert.equal(config.initialElapsedMs, 0);

    const shapes = buildAbilityTestingArenaShapes(preset).map(toSimulationBotShape);
    assert.deepEqual(shapes.map((shape) => [shape.x, shape.y, shape.rotation, shape.startX, shape.startY, shape.startRotation]), [
        [preset.playerPosition.x, preset.playerPosition.y, preset.playerRotation, preset.playerPosition.x, preset.playerPosition.y, preset.playerRotation],
        [preset.opponentPosition.x, preset.opponentPosition.y, preset.opponentRotation, preset.opponentPosition.x, preset.opponentPosition.y, preset.opponentRotation],
    ]);
});
