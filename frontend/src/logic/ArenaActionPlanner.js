import { PROTOTYPE_ACTION_TO_ABILITY } from "../beta/loadout/BotLoadout.js";
import { angleDelta, clamp } from "../beta/combat/geometry.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, ROTATION_STEP_DEG } from "../beta/modelPayloads/arenaConstants.js";
import { resolveMeleeStrategyTarget, selectMeleeStrategyActionPlan } from "./BotBrain.js";
import { compassDirection, vectorToCompassDegrees } from "./arenaAngles.js";

/** Builds the action-component payload consumed by ActionExecutionSystem. */
export function buildDeterministicLogicAction(configuration, stateSnapshot) {
    const plan = selectMeleeStrategyActionPlan(configuration, stateSnapshot);
    const movementBlock = plan.dashMovement ?? plan.movement ?? null;
    const abilityBlock = plan.ability ?? null;
    const prototypeBlock = PROTOTYPE_ACTION_TO_ABILITY[abilityBlock?.action] ? abilityBlock : null;
    const facingBlock = plan.rotation ?? null;
    const movementTarget = movementBlock?.movementMode === "coordinates"
        ? { x: Number(movementBlock.targetX ?? 500), y: Number(movementBlock.targetY ?? 400) }
        : offsetTarget(resolveActionTarget(stateSnapshot, movementBlock?.actionTarget), movementBlock);
    const facingTarget = offsetTarget(resolveActionTarget(stateSnapshot, facingBlock?.actionTarget ?? movementBlock?.actionTarget), facingBlock ?? movementBlock);
    const specialTarget = prototypeBlock?.targetMode === "target"
        ? offsetTarget(resolveActionTarget(stateSnapshot, prototypeBlock.actionTarget), prototypeBlock)
        : null;
    const movement = movementVector(configuredMovementAction(movementBlock), stateSnapshot.playerModel, movementTarget);
    return {
        dx: movement.dx,
        dy: movement.dy,
        dRot: facingBlock?.action === "rotate_toward_enemy" ? turnToward(stateSnapshot.playerModel, facingTarget) : 0,
        dashAction: plan.dash?.action?.startsWith("dash") ? configuredMovementAction(plan.dash) : null,
        abilityAction: abilityBlock ? {
            action: prototypeBlock?.action === "micro_dash" ? configuredMicroDashAction(prototypeBlock) : configuredPhaseStrikeAction(abilityBlock),
            targetX: specialTarget?.x ?? abilityBlock.targetX,
            targetY: specialTarget?.y ?? abilityBlock.targetY,
        } : null,
        customVariables: { ...(plan.customVariables ?? stateSnapshot.playerModel.customVariables ?? {}) },
    };
}

export function idleAction() {
    return { dx: 0, dy: 0, dRot: 0, dashAction: null, abilityAction: null, customVariables: {} };
}

function configuredMovementAction(block) {
    if (!block) return "move_stop";
    if (!block.movementMode) return block.action;
    const prefix = block.action === "dash" ? "dash" : "move";
    const direction = block.movementDirection ?? "toward";
    if (block.movementMode === "absolute") return `${prefix}_${direction}`;
    const relative = { toward: prefix === "dash" ? "dash" : "move_inward", away: `${prefix}_outward`, left: `${prefix}_tangent_left`, right: `${prefix}_tangent_right`, toward_left: `${prefix}_diagonal_in_left`, toward_right: `${prefix}_diagonal_in_right`, away_left: `${prefix}_diagonal_out_left`, away_right: `${prefix}_diagonal_out_right` };
    return relative[direction] ?? relative.toward;
}

function configuredMicroDashAction(block) {
    const direction = block?.movementDirection ?? "toward";
    if (block?.movementMode === "absolute") return `micro_dash_${direction}`;
    return ({ toward: "micro_dash", away: "micro_dash_outward", left: "micro_dash_left", right: "micro_dash_right", toward_left: "micro_dash_toward_left", toward_right: "micro_dash_toward_right", away_left: "micro_dash_away_left", away_right: "micro_dash_away_right" })[direction] ?? "micro_dash";
}

function configuredPhaseStrikeAction(block) {
    if (!block) return null;
    if (block.action !== "phase_strike") return block.action;
    return ({ keep: "phase_strike_keep_facing", face_origin: "phase_strike_face_origin", mirror: "phase_strike_mirror_facing" })[block.phaseFacingMode] ?? "phase_strike";
}

function offsetTarget(target, block) {
    return target ? { ...target, x: Number(target.x) + Number(block?.targetOffsetX ?? 0), y: Number(target.y) + Number(block?.targetOffsetY ?? 0) } : null;
}

function resolveActionTarget(state, actionTarget = "opponent") {
    const objects = Array.isArray(state?.objects) ? state.objects : [];
    const opponent = objects.find((object) => object.type === "opponentModel")
        ?? objects.find((object) => object.id === "opponent-model" || object.id === "main")
        ?? null;
    return resolveMeleeStrategyTarget({ player: state?.playerModel, opponent, objects }, actionTarget ?? "opponent");
}

function movementVector(action, player, target) {
    if (!player || ["none", "move_stop", "rotate_toward_enemy", "swing", "block", "fire_gun", "throw_grenade", "shoot_fireball", "stun"].includes(action)) return { dx: 0, dy: 0 };
    const absolute = {
        move_north: [0, -1], move_south: [0, 1], move_east: [1, 0], move_west: [-1, 0],
        move_northeast: [Math.SQRT1_2, -Math.SQRT1_2], move_northwest: [-Math.SQRT1_2, -Math.SQRT1_2], move_southeast: [Math.SQRT1_2, Math.SQRT1_2], move_southwest: [-Math.SQRT1_2, Math.SQRT1_2],
        dash_north: [0, -1], dash_south: [0, 1], dash_east: [1, 0], dash_west: [-1, 0],
        dash_northeast: [Math.SQRT1_2, -Math.SQRT1_2], dash_northwest: [-Math.SQRT1_2, -Math.SQRT1_2], dash_southeast: [Math.SQRT1_2, Math.SQRT1_2], dash_southwest: [-Math.SQRT1_2, Math.SQRT1_2],
    };
    if (absolute[action]) return { dx: absolute[action][0], dy: absolute[action][1] };
    if (action === "move_center") return { dx: ARENA_WIDTH_UNITS / 2 - player.x, dy: ARENA_HEIGHT_UNITS / 2 - player.y };
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
        move_inward: inward, dash: inward, move_outward: outward, dash_outward: outward,
        move_tangent_left: left, dash_tangent_left: left, move_tangent_right: right, dash_tangent_right: right,
        move_diagonal_in_left: add(inward, left), dash_diagonal_in_left: add(inward, left),
        move_diagonal_in_right: add(inward, right), dash_diagonal_in_right: add(inward, right),
        move_diagonal_out_left: add(outward, left), dash_diagonal_out_left: add(outward, left),
        move_diagonal_out_right: add(outward, right), dash_diagonal_out_right: add(outward, right),
    };
    return vectors[action] ?? { dx: 0, dy: 0 };
}

function turnToward(player, target) {
    if (!player || !target) return 0;
    const bearing = vectorToCompassDegrees(target.x - player.x, target.y - player.y);
    return clamp(angleDelta(player.rotation ?? 0, bearing) / ROTATION_STEP_DEG, -1, 1);
}

function add(first, second) {
    return { dx: first.dx + second.dx, dy: first.dy + second.dy };
}
