import { ALL_ABILITY_DEFINITIONS, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { abilityIdFromBoundary } from "../gameconfig/AbilityCompatibility.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS, BASE_BOT_HP } from "../modelPayloads/arenaConstants.js";
import { MAIN_SHAPE, buildOpponentShape, resetBotShapeToStartingConfiguration } from "../modelPayloads/arenaShapes.js";
import { normalizePracticeConfig } from "../practiceRoomStorage.js";
import { BOT_CODE_SELECTABLES } from "../botlogic/code/BotCode.js";

const MOVEMENT_TEST_ABILITIES = new Set([21]);
const TEST_CENTER_X = ARENA_WIDTH_UNITS / 2;
const TEST_CENTER_Y = ARENA_HEIGHT_UNITS / 2;
const DEFAULT_PLAYER_POSITION = Object.freeze({ x: TEST_CENTER_X, y: 420 });
const DEFAULT_OPPONENT_POSITION = Object.freeze({ x: TEST_CENTER_X, y: 780 });

function loadout(...abilities) {
    return encodeBotLoadout({ abilities });
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
        priority: 1,
        branches: [branch(branchId, actions, conditions)],
    };
}

function code(roots) {
    return {
        version: "bot-logic-tree-v1",
        roots: roots.map((entry, index) => {
            const normalized = { ...(entry ?? {}) };
            return {
                ...normalized,
                id: String(entry?.id || `ability-root-${index + 1}`),
                name: String(entry?.name || "Root"),
                priority: Number.isFinite(Number(entry?.priority)) ? Number(entry.priority) : index + 1,
            };
        }),
        customVariables: [],
    };
}

function faceTarget() {
    return { action: "rotate_toward_enemy", selectable: BOT_CODE_SELECTABLES.OPPONENT };
}

function moveTowardTarget() {
    return {
        action: "move_walk",
        movementMode: "target",
        movementDirection: 0,
        selectable: BOT_CODE_SELECTABLES.OPPONENT,
    };
}

function actionForAbility(abilityId) {
    const action = { action: abilityId, selectable: BOT_CODE_SELECTABLES.OPPONENT };
    if (abilityId === 19) Object.assign(action, { movementMode: "target", movementDirection: 0 });
    if ([22, 24].includes(abilityId)) action.targetMode = "target";
    if (abilityId === 25) action.phaseFacingMode = 0;
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
        player: DEFAULT_PLAYER_POSITION,
        opponent: DEFAULT_OPPONENT_POSITION,
        playerRotation: 180,
        opponentRotation: 0,
    };
    if ([1, 16, 23, 10, 7, 8, 17, 18, 34].includes(abilityId)) {
        return { player: { x: TEST_CENTER_X, y: TEST_CENTER_Y }, opponent: { x: TEST_CENTER_X, y: 708 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 6) {
        return { player: { x: TEST_CENTER_X, y: TEST_CENTER_Y }, opponent: { x: TEST_CENTER_X, y: 768 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 25) {
        return { player: { x: TEST_CENTER_X, y: TEST_CENTER_Y }, opponent: { x: TEST_CENTER_X, y: 708 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 15) {
        return { player: { x: TEST_CENTER_X, y: 510 }, opponent: { x: TEST_CENTER_X, y: 690 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 24) {
        return { player: { x: TEST_CENTER_X, y: 480 }, opponent: { x: TEST_CENTER_X, y: 660 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 11) {
        return { player: { x: TEST_CENTER_X, y: 540 }, opponent: { x: TEST_CENTER_X, y: 840 }, playerRotation: 180, opponentRotation: 0 };
    }
    if (abilityId === 14) {
        return { player: { x: TEST_CENTER_X, y: 480 }, opponent: { x: TEST_CENTER_X, y: 720 }, playerRotation: 180, opponentRotation: 0 };
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
        stats: ability.stats,
        playerLoadout,
        opponentLoadout,
        playerCode: { ...castCode(ability.id), loadout: playerLoadout },
        opponentCode: { ...opponent.code, loadout: opponentLoadout },
        playerPosition: positioning.player,
        opponentPosition: positioning.opponent,
        playerRotation: positioning.playerRotation,
        opponentRotation: positioning.opponentRotation,
    });
}

export const ABILITY_TEST_PRESETS = Object.freeze(ALL_ABILITY_DEFINITIONS.map(buildPreset));

export function findAbilityTestingPreset(id) {
    const abilityId = abilityIdFromBoundary(id);
    return ABILITY_TEST_PRESETS.find((preset) => preset.id === abilityId) ?? null;
}

export function buildAbilityTestingPracticeConfig(preset) {
    if (!preset?.id) return normalizePracticeConfig(null);
    return normalizePracticeConfig({
        playerTeamSize: 1,
        opponentTeamSize: 1,
        initialElapsedMs: 0,
        bots: [
            {
                role: "PLAYER",
                teamNumber: 1,
                slot: 1,
                loadout: preset.playerLoadout,
                startX: preset.playerPosition?.x ?? DEFAULT_PLAYER_POSITION.x,
                startY: preset.playerPosition?.y ?? DEFAULT_PLAYER_POSITION.y,
                rotation: preset.playerRotation ?? 180,
                startHp: BASE_BOT_HP,
            },
            {
                role: "OPPONENT",
                teamNumber: 2,
                slot: 1,
                loadout: preset.opponentLoadout,
                startX: preset.opponentPosition?.x ?? DEFAULT_OPPONENT_POSITION.x,
                startY: preset.opponentPosition?.y ?? DEFAULT_OPPONENT_POSITION.y,
                rotation: preset.opponentRotation ?? 0,
                startHp: BASE_BOT_HP,
            },
        ],
    });
}

export function buildAbilityTestingArenaShapes(preset) {
    const decodePayloadLoadout = (value) => typeof value === "string"
        ? decodeBotLoadout(value)
        : normalizedBotLoadout(value);
    const playerLoadout = decodePayloadLoadout(preset?.playerLoadout);
    const opponentLoadout = decodePayloadLoadout(preset?.opponentLoadout);
    const player = resetBotShapeToStartingConfiguration({
        ...MAIN_SHAPE,
        id: "main",
        type: "circle",
        slot: 1,
        username: "My Bot",
        userId: "ability-test-player",
        x: preset?.playerPosition?.x ?? DEFAULT_PLAYER_POSITION.x,
        y: preset?.playerPosition?.y ?? DEFAULT_PLAYER_POSITION.y,
        rotation: preset?.playerRotation ?? 180,
        combatLoadout: encodeBotLoadout(playerLoadout),
        loadout: playerLoadout,
        locked: false,
    }, {
        startX: preset?.playerPosition?.x ?? DEFAULT_PLAYER_POSITION.x,
        startY: preset?.playerPosition?.y ?? DEFAULT_PLAYER_POSITION.y,
        rotation: preset?.playerRotation ?? 180,
        startHp: BASE_BOT_HP,
    });
    const opponent = resetBotShapeToStartingConfiguration({
        ...buildOpponentShape({
            username: "Opponent 1",
            userId: "ability-test-opponent",
            slot: 2,
            loadout: opponentLoadout,
        }),
        id: "opponent-model",
        type: "opponentModel",
        size: 60,
        x: preset?.opponentPosition?.x ?? DEFAULT_OPPONENT_POSITION.x,
        y: preset?.opponentPosition?.y ?? DEFAULT_OPPONENT_POSITION.y,
        rotation: preset?.opponentRotation ?? 0,
        combatLoadout: encodeBotLoadout(opponentLoadout),
        loadout: opponentLoadout,
        locked: false,
        opponentUsername: "Opponent 1",
    }, {
        startX: preset?.opponentPosition?.x ?? DEFAULT_OPPONENT_POSITION.x,
        startY: preset?.opponentPosition?.y ?? DEFAULT_OPPONENT_POSITION.y,
        rotation: preset?.opponentRotation ?? 0,
        startHp: BASE_BOT_HP,
    });
    return [player, opponent];
}
