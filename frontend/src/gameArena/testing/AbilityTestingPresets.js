import { ALL_ABILITY_DEFINITIONS, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { MAIN_SHAPE, buildOpponentShape, resetBotShape } from "../modelPayloads/arenaShapes.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";

const ZERO_STATS = Object.freeze({ maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 });
const MOVEMENT_TEST_ABILITIES = new Set([21]);

function loadout(...abilities) {
    return encodeBotLoadout({ abilities, statPoints: { ...ZERO_STATS } });
}

function always() {
    return { type: "always" };
}

function beginChargingAfter(seconds) {
    return {
        type: "expression",
        left: "match.elapsedSeconds",
        comparator: "gte",
        right: { type: "number", value: seconds },
    };
}

function branch(id, actions, conditions = [always()]) {
    return {
        id,
        branchType: "if",
        createdOrder: 0,
        priority: 1,
        conditions,
        actions,
        children: [],
    };
}

function root(branchId, actions, conditions = [always()]) {
    return {
        id: `ability-root-${branchId}`,
        name: "Root",
        createdOrder: null,
        branches: [branch(branchId, actions, conditions)],
    };
}

function code(roots) {
    return {
        version: "bot-logic-tree-v1",
        roots: roots.map((entry, index) => ({
            ...entry,
            id: String(entry?.id || `ability-root-${index + 1}`),
            name: String(entry?.name || "Root"),
            createdOrder: Number.isFinite(Number(entry?.createdOrder)) ? Number(entry.createdOrder) : index,
        })),
        customVariables: [],
    };
}

function faceTarget() {
    return { action: "rotate_toward_enemy", actionTarget: "opponent" };
}

function moveTowardTarget() {
    return {
        action: "move_walk",
        movementMode: "target",
        movementDirection: "toward",
        actionTarget: "opponent",
    };
}

function actionForAbility(abilityId) {
    const action = { action: abilityId, actionTarget: "opponent" };
    if (abilityId === 19) Object.assign(action, { movementMode: "target", movementDirection: "toward" });
    if ([22, 24].includes(abilityId)) action.targetMode = "target";
    if (abilityId === 25) action.phaseFacingMode = "face_origin";
    return action;
}

function castCode(abilityId, { move = MOVEMENT_TEST_ABILITIES.has(abilityId), castConditions = [always()] } = {}) {
    return code([
        root(`${abilityId}-aim-if`, [faceTarget()]),
        ...(move ? [root(`${abilityId}-approach-if`, [moveTowardTarget()])] : []),
        root(`${abilityId}-cast-if`, [actionForAbility(abilityId)], castConditions),
    ]);
}

function passiveCode() {
    return code([]);
}

function opponentCode(abilityId) {
    switch (abilityId) {
        case 2:
            return { loadout: loadout(1), code: castCode(1) };
        case 16:
            return { loadout: loadout(3), code: castCode(3) };
        case 23:
            return { loadout: loadout(22), code: castCode(22) };
        case 10:
            return { loadout: loadout(1), code: castCode(1) };
        case 25:
            return { loadout: loadout(2), code: castCode(2) };
        case 6:
            return { loadout: loadout(13), code: castCode(13) };
        case 15:
            return {
                loadout: loadout(13),
                code: castCode(13, { castConditions: [beginChargingAfter(0.8)] }),
            };
        case 24:
            return { loadout: loadout(12), code: castCode(12) };
        case 11:
            return { loadout: loadout(), code: code([root("mine-approach-if", [moveTowardTarget()])]) };
        default:
            return { loadout: loadout(), code: passiveCode() };
    }
}

function positioningFor(abilityId) {
    const defaults = {
        player: { x: 500, y: 350 },
        opponent: { x: 500, y: 650 },
        playerRotation: 180,
        opponentRotation: 0,
    };
    if ([1, 2, 16, 23, 10, 7, 8, 17, 18].includes(abilityId)) {
        return { player: { x: 500, y: 500 }, opponent: { x: 500, y: 590 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 6) {
        return { player: { x: 500, y: 500 }, opponent: { x: 500, y: 640 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 25) {
        return { player: { x: 500, y: 500 }, opponent: { x: 500, y: 590 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 15) {
        return { player: { x: 500, y: 425 }, opponent: { x: 500, y: 575 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 24) {
        return { player: { x: 500, y: 400 }, opponent: { x: 500, y: 550 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 11) {
        return { player: { x: 500, y: 450 }, opponent: { x: 500, y: 700 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 14) {
        return { player: { x: 500, y: 400 }, opponent: { x: 500, y: 600 }, playerRotation: 180, opponentRotation: 0 };
    }
    return defaults;
}

function buildPreset(ability) {
    const positioning = positioningFor(ability.id);
    const opponent = opponentCode(ability.id);
    const playerLoadout = loadout(ability.id);
    const opponentLoadout = opponent.loadout;
    return Object.freeze({
        id: ability.id,
        abilityId: ability.id,
        label: ability.label,
        round: ability.round,
        kind: ability.kind,
        summary: ability.summary,
        effects: ability.effects,
        delivery: ability.delivery,
        shieldInteraction: ability.shieldInteraction,
        stats: ability.stats,
        playerLoadout,
        opponentLoadout,
        playerCode: { ...castCode(ability.id), loadout: playerLoadout },
        opponentCode: { ...opponent.code, loadout: opponentLoadout },
        playerPosition: positioning.player,
        opponentPosition: positioning.opponent,
        playerRotation: positioning.playerRotation,
        opponentRotation: positioning.opponentRotation,
        replayDurationMs: 12_000,
    });
}

export const ABILITY_TEST_PRESETS = Object.freeze(ALL_ABILITY_DEFINITIONS.map(buildPreset));

export function findAbilityTestingPreset(id) {
    const abilityId = abilityIdFromBoundary(id);
    return ABILITY_TEST_PRESETS.find((preset) => preset.id === abilityId) ?? null;
}

export function getAbilityTestingPreset(id) {
    return findAbilityTestingPreset(id) ?? ABILITY_TEST_PRESETS[0];
}

/**
 * Resolve a catalogue ID into a fresh serializable preset payload.
 * Route consumers should use the stable ID and call this registry rather than
 * accepting a mutable payload from the browser.
 */
export function abilityTestingPreset(id) {
    const preset = findAbilityTestingPreset(id);
    return preset ? JSON.parse(JSON.stringify(preset)) : null;
}

export function buildAbilityTestingArenaShapes(preset) {
    const decodePayloadLoadout = (value) => typeof value === "string"
        ? decodeBotLoadout(value)
        : normalizedBotLoadout(value);
    const playerLoadout = decodePayloadLoadout(preset?.playerLoadout);
    const opponentLoadout = decodePayloadLoadout(preset?.opponentLoadout);
    const player = resetBotShape({
        ...MAIN_SHAPE,
        id: "main",
        type: "circle",
        slot: 1,
        username: "Test Bot",
        userId: "ability-test-player",
        x: preset?.playerPosition?.x ?? 500,
        y: preset?.playerPosition?.y ?? 350,
        rotation: preset?.playerRotation ?? 180,
        combatLoadout: encodeBotLoadout(playerLoadout),
        loadout: playerLoadout,
        locked: false,
    });
    const opponent = resetBotShape({
        ...buildOpponentShape({
            username: "Practice Bot",
            userId: "ability-test-opponent",
            slot: 2,
            loadout: opponentLoadout,
        }),
        id: "opponent-model",
        type: "opponentModel",
        size: 60,
        x: preset?.opponentPosition?.x ?? 500,
        y: preset?.opponentPosition?.y ?? 650,
        rotation: preset?.opponentRotation ?? 0,
        combatLoadout: encodeBotLoadout(opponentLoadout),
        loadout: opponentLoadout,
        locked: false,
        opponentUsername: "Practice Bot",
    });
    return [player, opponent];
}
