import { angleDelta, clamp } from "../../gameconfig/geometry.js";
import { ROTATION_STEP_DEG } from "../../modelPayloads/arenaConstants.js";
import { BOT_CODE_SELECTABLES, resolveAbilityStrategySelectable, selectAbilityStrategyActionPlan } from "../code/BotCode.js";
import { stateFromPayload } from "../code/runtime/runtimeState.js";
import { compassDirection, relativeMovementVector, vectorToCompassDegrees } from "./arenaAngles.js";
import { abilityExecutionPayload } from "../../gameconfig/AbilityExecutionPayload.js";
import { publicOffsetToInternal, publicPointToInternal } from "../../modelPayloads/arenaCoordinates.js";
import { BOT_LOGIC_TREE_V1, BOT_LOGIC_TREE_VERSION } from "../code/configuration/constants.js";

/** Builds the action-component payload consumed by ActionExecutionSystem. */
export function buildDeterministicLogicAction(configuration, stateSnapshot) {
    const plan = selectAbilityStrategyActionPlan(configuration, stateSnapshot);
    const coordinateVersion = plan.coordinateVersion ?? configuration?.version ?? BOT_LOGIC_TREE_VERSION;
    const state = stateFromPayload(stateSnapshot, coordinateVersion);
    const movementBlock = plan.movement ?? null;
    const abilityBlock = plan.ability ?? null;
    const resolvedAbilityPayload = abilityExecutionPayload(abilityBlock?.action);
    const abilityBlockWithTarget = resolvedAbilityPayload ? abilityBlock : null;
    const facingBlock = plan.rotation ?? null;
    const movementTarget = movementBlock?.movementMode === "coordinates"
        ? internalCoordinateTarget(movementBlock, coordinateVersion)
        : resolveSelectable(state, movementBlock?.selectable);
    const facingTarget = facingBlock?.targetMode === "coordinates"
        ? internalCoordinateTarget(facingBlock, coordinateVersion)
        : facingBlock?.targetMode === "angle"
            ? null
            : facingBlock
                ? offsetTarget(resolveSelectable(state, facingBlock.selectable ?? movementBlock?.selectable), facingBlock, coordinateVersion)
                : resolveSelectable(state, movementBlock?.selectable);
    const specialTarget = abilityBlockWithTarget?.targetMode === "target"
        || resolvedAbilityPayload?.activation?.targetMode === "target"
        ? offsetTarget(resolveSelectable(state, abilityBlockWithTarget.selectable), abilityBlockWithTarget, coordinateVersion)
        : null;
    const configuredAbilityCoordinate = abilityBlockWithTarget?.targetMode === "coordinates"
        || abilityBlockWithTarget?.movementMode === "coordinates"
        ? internalCoordinateTarget(abilityBlockWithTarget, coordinateVersion)
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
            targetX: specialTarget?.x ?? configuredAbilityCoordinate?.x ?? abilityBlock.targetX,
            targetY: specialTarget?.y ?? configuredAbilityCoordinate?.y ?? abilityBlock.targetY,
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

function offsetTarget(target, block, coordinateVersion) {
    if (block?.movementMode) return target;
    if (!target) return null;
    const offset = coordinateVersion === BOT_LOGIC_TREE_V1
        ? { x: Number(block?.targetOffsetX ?? 0), y: Number(block?.targetOffsetY ?? 0) }
        : publicOffsetToInternal({ x: block?.targetOffsetX ?? 0, y: block?.targetOffsetY ?? 0 });
    return { ...target, x: Number(target.x) + offset.x, y: Number(target.y) + offset.y };
}

function internalCoordinateTarget(block, coordinateVersion) {
    const point = { x: Number(block?.targetX ?? (coordinateVersion === BOT_LOGIC_TREE_V1 ? 600 : 0)), y: Number(block?.targetY ?? (coordinateVersion === BOT_LOGIC_TREE_V1 ? 600 : 0)) };
    return coordinateVersion === BOT_LOGIC_TREE_V1 ? point : publicPointToInternal(point);
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
