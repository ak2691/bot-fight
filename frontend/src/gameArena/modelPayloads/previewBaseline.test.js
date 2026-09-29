import assert from "node:assert/strict";
import test from "node:test";
import { buildTutorialArenaShapes } from "../../tutorial/TutorialPresets.js";
import { mergeBotShapeUpdates, toSimulationBotShape } from "./arenaShapes.js";
import { createPreviewBaseline, restorePreviewBaseline } from "./previewBaseline.js";

test("preview baseline restores configured bots and excludes every transient entity", () => {
    const initialBots = buildTutorialArenaShapes("dont-miss");
    const baseline = createPreviewBaseline([
        ...initialBots,
        { id: "unknown-rendered-effect", type: "newAbilityEffect", x: 30, y: 40 },
        { id: "projectile", type: "fireball", abilityId: 5, x: 50, y: 60 },
    ]);
    const changedLiveBots = initialBots.map((shape, index) => mergeBotShapeUpdates(shape, {
        x: shape.transform.position.x + 90,
        y: shape.transform.position.y - 35,
        rotation: shape.transform.rotation + 60,
        hp: 44 - index,
        statusEffects: [{ type: "stun", remainingMs: 200 }],
    }));

    const restored = restorePreviewBaseline({
        ...baseline,
        bots: baseline.bots.map((shape, index) => ({
            ...shape,
            x: changedLiveBots[index].transform.position.x,
            y: changedLiveBots[index].transform.position.y,
            rotation: changedLiveBots[index].transform.rotation,
            hp: changedLiveBots[index].health.current,
        })),
    });

    assert.deepEqual(restored.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.deepEqual(restored.map((shape) => {
        const bot = toSimulationBotShape(shape);
        return [bot.x, bot.y, bot.rotation, bot.hp, bot.statusEffects.length, bot.matchElapsedMs];
    }), initialBots.map((shape) => {
        const bot = toSimulationBotShape(shape);
        return [bot.x, bot.y, bot.rotation, bot.hp, 0, 0];
    }));
    assert.deepEqual(restored.map((shape) => [shape.startX, shape.startY, shape.startRotation]), [
        [initialBots[0].transform.position.x, initialBots[0].transform.position.y, initialBots[0].transform.rotation],
        [initialBots[1].transform.position.x, initialBots[1].transform.position.y, initialBots[1].transform.rotation],
    ]);
});

test("preview baseline preserves its configured starting elapsed time", () => {
    const baseline = createPreviewBaseline(buildTutorialArenaShapes("dont-miss"), { initialElapsedMs: 12_300 });

    assert.equal(baseline.initialElapsedMs, 12_300);
    assert.deepEqual(restorePreviewBaseline(baseline).map((shape) => toSimulationBotShape(shape).matchElapsedMs), [12_300, 12_300]);
});

test("capturing live preview state saves each bot position, rotation, and current HP", () => {
    const configured = buildTutorialArenaShapes("dont-miss");
    const captured = configured.map((shape, index) => mergeBotShapeUpdates(shape, {
        x: shape.transform.position.x + 17.36,
        y: shape.transform.position.y - 23.48,
        rotation: shape.transform.rotation + 7.5,
        hp: 112 - index,
    }));
    const restored = restorePreviewBaseline(createPreviewBaseline(captured));

    assert.deepEqual(restored.map((shape) => {
        const bot = toSimulationBotShape(shape);
        return [bot.x, bot.y, bot.rotation, bot.hp];
    }), captured.map((shape) => {
        const bot = toSimulationBotShape(shape);
        return [bot.x, bot.y, bot.rotation, bot.hp];
    }));
});
