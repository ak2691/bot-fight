import { normalizeAbilityStrategyConfiguration } from "../../../../../../shared/engine/botlogic/code/BotCode.js";
import { advanceShapes as advanceArenaPreviewTick } from "../../../testing/fightTick.js";
import { buildInitialArenaShapes } from "../../../modelPayloads/arenaShapes.js";
import { STATUS_EFFECT_APPLICATIONS } from "../../../../../../shared/engine/ecs/contracts/StatusContracts.js";
import { applyStatus } from "../../../../../../shared/engine/ecs/abilities/effects.js";

const MAIN_X = 300;
const MAIN_Y = 600;

function formatStack(stack) {
    return stack?.length
        ? stack.map((frame) => `${frame.chainId.replace("chain.", "")}@${frame.path.join(".")}`).join(">")
        : "idle";
}

function formatAction(action) {
    const sign = (value) => Math.abs(value) < 1e-6 ? 0 : Math.sign(value);
    const moves = `${["W", "", "E"][sign(action.dx) + 1]}${["N", "", "S"][sign(action.dy) + 1]}`;
    return [
        // Ability and dash are separate channels; both show when they start on the same tick ("3+19").
        [action.abilityAction?.action, action.dashAction?.action].filter((value) => value != null).join("+") || "-",
        moves || "-",
        action.dRot !== 0 ? "rot" : "-",
        action.cancelWindup ? "cancel" : "-",
    ].join(" ");
}

/** Runs a chain scenario in the browser preview and returns one trace line per tick. */
export function traceScenario(scenario, onTick = null) {
    const loadout = "custom:0";
    let shapes = buildInitialArenaShapes(null).map((shape) => {
        const placed = shape.id === "main"
            ? { ...shape, x: MAIN_X, y: MAIN_Y, rotation: scenario.mainRotation ?? 90, teamNumber: 1 }
            : { ...shape, x: scenario.defenderX, y: MAIN_Y, rotation: 270 };
        return { ...placed, abilities: shape.id === "main" ? scenario.abilities : [], combatLoadout: loadout };
    });
    const configuration = normalizeAbilityStrategyConfiguration({ version: "bot-logic-tree-v1", roots: scenario.roots, chains: scenario.chains });
    const lines = [];
    for (let tick = 0; tick < scenario.ticks; tick += 1) {
        shapes = advanceArenaPreviewTick(shapes, {
            selectedLoadout: loadout,
            opponentLoadout: loadout,
            testingConfiguration: configuration,
            opponentTestingConfiguration: null,
        });
        if (tick === scenario.stunAtTick) {
            shapes = shapes.map((shape) => shape.id !== "main" ? shape : applyStatus({ ...shape }, {
                type: "stun",
                remainingMs: 500,
                effects: [{ type: STATUS_EFFECT_APPLICATIONS.STUN, mode: "constant" }],
            }));
        }
        const main = shapes.find((shape) => shape.id === "main");
        onTick?.(main, tick);
        lines.push(`${formatStack(main.chainStack)} | ${formatAction(main.lastPredictedAction)}`);
    }
    return lines;
}
