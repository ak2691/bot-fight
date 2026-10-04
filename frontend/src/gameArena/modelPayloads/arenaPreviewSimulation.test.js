import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_STEP_MS } from "./arenaConstants.js";
import { buildInitialArenaShapes, toSimulationBotShape } from "./arenaShapes.js";
import { advanceArenaPreviewTick } from "./arenaPreviewSimulation.js";
import { sanitizeStrategyConfigurationForLoadout } from "../persistence/arenaStrategyStorage.js";

test("a Run chain action survives the editor loadout filter and runs in both practice slots", () => {
    const loadout = "custom:0";
    const configuration = sanitizeStrategyConfigurationForLoadout({
        version: "bot-logic-tree-v2",
        roots: [{ branches: [{ conditions: [{ type: "always" }], actions: [
            { action: "run_chain", chainId: "chain.walk" },
        ] }] }],
        chains: [{ id: "chain.walk", name: "Walk", steps: [
            { type: "action", action: "move_walk", movementMode: "absolute", movementDirection: 90, forMs: 500 },
        ] }],
    }, loadout);
    const initial = buildInitialArenaShapes(null);
    const next = advanceArenaPreviewTick(initial, {
        selectedLoadout: loadout, opponentLoadout: loadout,
        testingConfiguration: configuration, opponentTestingConfiguration: configuration,
    });
    for (const id of ["main", "opponent-model"]) {
        const before = toSimulationBotShape(initial.find((bot) => bot.id === id));
        const after = toSimulationBotShape(next.find((bot) => bot.id === id));
        assert.equal(after.chainStack[0].chainId, "chain.walk");
        assert.equal(after.runningChain.name, "Walk");
        assert.ok(after.x > before.x, "the chain's Walk step executes");
    }
});

for (const actorId of ["main", "opponent-model"]) {
    test(`preview cancels Sniper below 0.4 seconds of preparation for ${actorId}`, () => {
        let shapes = buildInitialArenaShapes(null).map((shape) => shape.id === actorId
            ? { ...shape, abilities: [3], combatLoadout: "custom:3" } : shape);
        const configuration = { roots: [{ branches: [
            {
                priority: 1,
                conditions: [
                    { type: "expression", left: "bot.selectedAbilityPreparing", ability: 3, selectable: "my", comparator: "eq", right: { type: "boolean", value: true } },
                    { type: "expression", left: "bot.selectedAbilityPreparationMs", ability: 3, selectable: "my", comparator: "lt", right: { type: "number", value: 0.4 } },
                ],
                actions: [{ action: "cancel_windup" }],
            },
            { priority: 2, conditions: [{ type: "always" }], actions: [{ action: 3 }] },
        ] }] };
        const options = {
            selectedLoadout: "custom:3",
            opponentLoadout: "custom:3",
            testingConfiguration: actorId === "main" ? configuration : null,
            opponentTestingConfiguration: actorId === "opponent-model" ? configuration : null,
        };
        const actor = () => toSimulationBotShape(shapes.find((shape) => shape.id === actorId));
        for (const remainingMs of [800, 700, 600, 500, 400, 300]) {
            shapes = advanceArenaPreviewTick(shapes, options);
            assert.equal(actor().preparingMs, remainingMs);
            assert.equal(actor().triggeredAbility, null);
        }
        shapes = advanceArenaPreviewTick(shapes, options);
        const cancelled = actor();
        assert.equal(cancelled.lastPredictedAction.cancelWindup, true);
        assert.equal(cancelled.preparingAbility, null);
        assert.equal(cancelled.preparingMs, 0);
        assert.equal(cancelled.triggeredAbility, null);
        assert.equal(cancelled.stamina, 75);
        assert.equal(cancelled.abilityCooldowns?.[3] ?? 0, 0);
        assert.equal(cancelled.abilityActiveMs?.[3] ?? 0, 0);
    });
}

test("preview tick decides from the previous state and returns a new state snapshot", () => {
    const initialShapes = buildInitialArenaShapes(null);
    const initialMain = toSimulationBotShape(initialShapes.find((shape) => shape.id === "main"));
    const walkEast = {
        roots: [{ priority: 1, branches: [{
            id: "walk-east",
            branchType: "if",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: "east" }],
            children: [],
        }] }],
    };

    const nextShapes = advanceArenaPreviewTick(initialShapes, {
        selectedLoadout: "melee",
        opponentLoadout: "melee",
        testingConfiguration: walkEast,
        opponentTestingConfiguration: null,
    });
    const nextMain = toSimulationBotShape(nextShapes.find((shape) => shape.id === "main"));

    assert.ok(nextMain.x > initialMain.x);
    assert.equal(nextMain.matchElapsedMs, Number(initialMain.matchElapsedMs ?? 0) + AUTO_STEP_MS);
    assert.deepEqual(initialShapes.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.deepEqual(nextShapes.map((shape) => shape.id), ["main", "opponent-model"]);
    assert.equal(toSimulationBotShape(initialShapes.find((shape) => shape.id === "main")).x, initialMain.x);
});
