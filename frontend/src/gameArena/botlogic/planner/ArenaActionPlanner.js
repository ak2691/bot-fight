import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { angleDelta, clamp } from "../../gameconfig/geometry.js";
import { ROTATION_STEP_DEG } from "../../modelPayloads/arenaConstants.js";
import { resolveAbilityStrategyTarget, selectAbilityStrategyActionPlan } from "../code/BotCode.js";
import { compassDirection, vectorToCompassDegrees } from "./arenaAngles.js";

/** Builds the action-component payload consumed by ActionExecutionSystem. */
export function buildDeterministicLogicAction(configuration, stateSnapshot) {
    const plan = selectAbilityStrategyActionPlan(configuration, stateSnapshot);
    const movementBlock = plan.movement ?? null;
    const abilityBlock = plan.ability ?? null;
    const abilityBlockWithTarget = ACTION_TO_ABILITY[abilityBlock?.action] ? abilityBlock : null;
    const facingBlock = plan.rotation ?? null;
    const movementTarget = movementBlock?.movementMode === "coordinates"
        ? { x: Number(movementBlock.targetX ?? 500), y: Number(movementBlock.targetY ?? 400) }
        : offsetTarget(resolveActionTarget(stateSnapshot, movementBlock?.actionTarget), movementBlock);
    const facingTarget = offsetTarget(resolveActionTarget(stateSnapshot, facingBlock?.actionTarget ?? movementBlock?.actionTarget), facingBlock ?? movementBlock);
    const specialTarget = abilityBlockWithTarget?.targetMode === "target" || abilityBlockWithTarget?.action === 20
        ? offsetTarget(resolveActionTarget(stateSnapshot, abilityBlockWithTarget.actionTarget), abilityBlockWithTarget)
        : null;
    const movement = movementVector(movementBlock, stateSnapshot.playerModel, movementTarget);
    return {
        dx: movement.dx,
        dy: movement.dy,
        dRot: facingBlock?.action === "rotate_toward_enemy" ? turnToward(stateSnapshot.playerModel, facingTarget) : 0,
        abilityAction: abilityBlock ? {
            action: abilityBlock.action,
            targetX: specialTarget?.x ?? abilityBlock.targetX,
            targetY: specialTarget?.y ?? abilityBlock.targetY,
            ...(abilityBlock.movementMode ? { movementMode: abilityBlock.movementMode } : {}),
            ...(abilityBlock.movementDirection ? { movementDirection: abilityBlock.movementDirection } : {}),
            ...(abilityBlock.phaseFacingMode ? { phaseFacingMode: abilityBlock.phaseFacingMode } : {}),
        } : null,
        customVariables: { ...(plan.customVariables ?? stateSnapshot.playerModel.customVariables ?? {}) },
    };
}

export function idleAction() {
    return { dx: 0, dy: 0, dRot: 0, abilityAction: null, customVariables: {} };
}

function offsetTarget(target, block) {
    return target ? { ...target, x: Number(target.x) + Number(block?.targetOffsetX ?? 0), y: Number(target.y) + Number(block?.targetOffsetY ?? 0) } : null;
}

function resolveActionTarget(state, actionTarget = "opponent") {
    const objects = Array.isArray(state?.objects) ? state.objects : [];
    const opponent = objects.find((object) => object.type === "opponentModel")
        ?? objects.find((object) => object.id === "opponent-model" || object.id === "main")
        ?? null;
    return resolveAbilityStrategyTarget({ player: state?.playerModel, opponent, objects }, actionTarget ?? "opponent");
}

function movementVector(block, player, target) {
    if (!player || block?.action !== "move_walk") return { dx: 0, dy: 0 };
    const direction = block.movementDirection ?? "toward";
    const absolute = {
        north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
        northeast: [Math.SQRT1_2, -Math.SQRT1_2], northwest: [-Math.SQRT1_2, -Math.SQRT1_2], southeast: [Math.SQRT1_2, Math.SQRT1_2], southwest: [-Math.SQRT1_2, Math.SQRT1_2],
        stop: [0, 0],
    };
    if (block.movementMode === "absolute") return { dx: absolute[direction]?.[0] ?? 0, dy: absolute[direction]?.[1] ?? 0 };
    if (!target) return { dx: 0, dy: 0 };
    let inward = { dx: target.x - player.x, dy: target.y - player.y };
    if (Math.hypot(inward.dx, inward.dy) <= 0.001) {
        const facing = compassDirection(player.rotation);
        inward = { dx: facing.x, dy: facing.y };
    }
    const outward = { dx: -inward.dx, dy: -inward.dy };
    const left = { dx: inward.dy, dy: -inward.dx };
    const right = { dx: -inward.dy, dy: inward.dx };
    const vectors = {
        toward: inward, away: outward,
        left, right,
        toward_left: add(inward, left), toward_right: add(inward, right),
        away_left: add(outward, left), away_right: add(outward, right),
    };
    return vectors[direction] ?? { dx: 0, dy: 0 };
}

function turnToward(player, target) {
    if (!player || !target) return 0;
    const bearing = vectorToCompassDegrees(target.x - player.x, target.y - player.y);
    return clamp(angleDelta(player.rotation ?? 0, bearing) / ROTATION_STEP_DEG, -1, 1);
}

function add(first, second) {
    return { dx: first.dx + second.dx, dy: first.dy + second.dy };
}
