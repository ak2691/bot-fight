import { angleDelta, clamp } from "../../gameconfig/geometry.js";
import { ROTATION_STEP_DEG } from "../../modelPayloads/arenaConstants.js";
import { BOT_CODE_SELECTABLES, resolveAbilityStrategySelectable, selectAbilityStrategyActionPlan } from "../code/BotCode.js";
import { stateFromPayload } from "../code/runtime/runtimeState.js";
import { compassDirection, relativeMovementVector, vectorToCompassDegrees } from "./arenaAngles.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";

/** Builds the action-component payload consumed by ActionExecutionSystem. */
export function buildDeterministicLogicAction(configuration, stateSnapshot) {
    const plan = selectAbilityStrategyActionPlan(configuration, stateSnapshot);
    const state = stateFromPayload(stateSnapshot);
    const movementBlock = plan.movement ?? null;
    const abilityBlock = plan.ability ?? null;
    const resolvedAbilityPayload = abilityExecutionPayload(abilityBlock?.action);
    const abilityBlockWithTarget = resolvedAbilityPayload ? abilityBlock : null;
    const facingBlock = plan.rotation ?? null;
    const movementTarget = movementBlock?.movementMode === "coordinates"
        ? { x: Number(movementBlock.targetX ?? 500), y: Number(movementBlock.targetY ?? 400) }
        : resolveSelectable(state, movementBlock?.selectable);
    const facingTarget = facingBlock?.targetMode === "coordinates"
        ? { x: Number(facingBlock.targetX ?? 500), y: Number(facingBlock.targetY ?? 400) }
        : facingBlock?.targetMode === "angle"
            ? null
            : facingBlock
                ? offsetTarget(resolveSelectable(state, facingBlock.selectable ?? movementBlock?.selectable), facingBlock)
                : resolveSelectable(state, movementBlock?.selectable);
    const specialTarget = abilityBlockWithTarget?.targetMode === "target"
        || resolvedAbilityPayload?.execution?.targetMode === "target"
        ? offsetTarget(resolveSelectable(state, abilityBlockWithTarget.selectable), abilityBlockWithTarget)
        : null;
    const movement = movementVector(movementBlock, state.player, movementTarget);
    return {
        dx: movement.dx,
        dy: movement.dy,
        dRot: facingBlock?.action === "rotate_toward_enemy"
            ? facingBlock.targetMode === "angle" ? turnTowardAngle(state.player, facingBlock.targetAngle) : turnToward(state.player, facingTarget)
            : 0,
        abilityAction: abilityBlock ? {
            action: abilityBlock.action,
            abilityPayload: resolvedAbilityPayload,
            targetX: specialTarget?.x ?? abilityBlock.targetX,
            targetY: specialTarget?.y ?? abilityBlock.targetY,
            ...(abilityBlock.movementMode ? { movementMode: abilityBlock.movementMode } : {}),
            ...(abilityBlock.movementDirection != null ? { movementDirection: abilityBlock.movementDirection } : {}),
            ...(abilityBlock.phaseFacingMode != null ? { phaseFacingMode: abilityBlock.phaseFacingMode } : {}),
        } : null,
        customVariables: { ...(plan.customVariables ?? state.player.customVariables ?? {}) },
    };
}

export function idleAction() {
    return { dx: 0, dy: 0, dRot: 0, abilityAction: null, customVariables: {} };
}

function offsetTarget(target, block) {
    if (block?.movementMode) return target;
    return target ? { ...target, x: Number(target.x) + Number(block?.targetOffsetX ?? 0), y: Number(target.y) + Number(block?.targetOffsetY ?? 0) } : null;
}

function resolveSelectable(state, selectable = BOT_CODE_SELECTABLES.OPPONENT) {
    const objects = Array.isArray(state?.objects) ? state.objects : [];
    const opponent = state?.opponent
        ?? objects.find((object) => object.type === "opponentModel")
        ?? objects.find((object) => object.id === "opponent-model" || object.id === "main")
        ?? null;
    return resolveAbilityStrategySelectable({
        player: state?.player,
        opponent,
        teammates: state?.teammates ?? [],
        opponents: state?.opponents ?? [],
        bots: state?.bots ?? [],
        objects,
    }, selectable ?? BOT_CODE_SELECTABLES.OPPONENT);
}

function movementVector(block, player, target) {
    if (!player || block?.action !== "move_walk") return { dx: 0, dy: 0 };
    const direction = block.movementDirection ?? 0;
    if (block.movementMode === "absolute") {
        const numericDirection = Number(direction);
        if (!Number.isFinite(numericDirection)) return { dx: 0, dy: 0 };
        const absolute = compassDirection(Math.max(-360, Math.min(360, numericDirection)));
        return { dx: absolute.x, dy: absolute.y };
    }
    if (!target) return { dx: 0, dy: 0 };
    let inward = { dx: target.x - player.x, dy: target.y - player.y };
    if (Math.hypot(inward.dx, inward.dy) <= 0.001) {
        const facing = compassDirection(player.rotation);
        inward = { dx: facing.x, dy: facing.y };
    }
    const relative = relativeMovementVector(inward.dx, inward.dy, direction);
    return { dx: relative.x, dy: relative.y };
}

function turnToward(player, target) {
    if (!player || !target) return 0;
    const bearing = vectorToCompassDegrees(target.x - player.x, target.y - player.y);
    return clamp(angleDelta(player.rotation ?? 0, bearing) / ROTATION_STEP_DEG, -1, 1);
}

function turnTowardAngle(player, targetAngle) {
    if (!player || !Number.isFinite(Number(targetAngle))) return 0;
    return clamp(angleDelta(player.rotation ?? 0, Number(targetAngle)) / ROTATION_STEP_DEG, -1, 1);
}
