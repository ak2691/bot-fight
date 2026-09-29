import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAbilityStrategyConfiguration } from "./botlogic/code/BotCode.js";
import { upgradeStoredStrategyCoordinates } from "./persistence/arenaStrategyStorage.js";
import {
    PRACTICE_ROOM_STORAGE_KEY,
    readPracticeRoomDraft,
    savePracticeRoomDraft,
} from "./practiceRoomStorage.js";

function createStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
    };
}

test("practice room storage round-trips code and loadouts", () => {
    const storage = createStorage();
    const playerCode = createDefaultAbilityStrategyConfiguration();
    const opponentCode = createDefaultAbilityStrategyConfiguration();

    assert.equal(savePracticeRoomDraft({
        player: { loadout: "sandbox:1,1,999", code: playerCode },
        opponent: { loadout: "custom:s", code: opponentCode },
    }, storage), true);

    const saved = readPracticeRoomDraft(storage);
    assert.equal(storage.getItem(PRACTICE_ROOM_STORAGE_KEY) !== null, true);
    assert.equal(saved.player.loadout, "sandbox:1");
    assert.equal(saved.opponent.loadout, "custom:s");
    assert.deepEqual(saved.player.code, playerCode);
    assert.deepEqual(saved.opponent.code, opponentCode);
});

test("practice room storage merges player and opponent updates", () => {
    const storage = createStorage();
    const playerCode = createDefaultAbilityStrategyConfiguration();
    const opponentCode = createDefaultAbilityStrategyConfiguration();

    savePracticeRoomDraft({ player: { loadout: "sandbox:3", code: playerCode } }, storage);
    savePracticeRoomDraft({ opponent: { loadout: "sandbox:4", code: opponentCode } }, storage);

    const saved = readPracticeRoomDraft(storage);
    assert.equal(saved.player.loadout, "sandbox:3");
    assert.equal(saved.opponent.loadout, "sandbox:4");
    assert.deepEqual(saved.player.code, playerCode);
});

test("practice room storage bounds the shared practice roster config and keeps code out of it", () => {
    const storage = createStorage();
    savePracticeRoomDraft({
        config: {
            playerTeamSize: 9,
            opponentTeamSize: 0,
            initialElapsedMs: 999_999,
            bots: [
                { role: "PLAYER", teamNumber: 1, slot: 1, startX: -5, startY: 500, startHp: 999, brain: { roots: [] } },
                { role: "PLAYER", teamNumber: 1, slot: 2, startX: 500, startY: 500, startHp: 80 },
                { role: "OPPONENT", teamNumber: 2, slot: 1, startX: 500, startY: 999, startHp: 75 },
            ],
        },
    }, storage);

    const saved = readPracticeRoomDraft(storage);
    assert.equal(saved.config.playerTeamSize, 2);
    assert.equal(saved.config.opponentTeamSize, 1);
    assert.equal(saved.config.initialElapsedMs, 60_000);
    assert.equal(saved.config.bots.length, 3);
    assert.equal(saved.config.bots[0].startX, -5);
    assert.equal(saved.config.bots[0].startHp, 150);
    assert.equal(saved.config.bots[0].brain, undefined);
});

test("practice starting positions and rotations keep one decimal while HP stays integral", () => {
    const storage = createStorage();
    savePracticeRoomDraft({
        config: { bots: [
            { role: "PLAYER", teamNumber: 1, slot: 1, startX: 12.36, startY: -45.24, rotation: 12.36, startHp: 70.8 },
        ] },
    }, storage);

    const [player] = readPracticeRoomDraft(storage).config.bots;
    assert.deepEqual([player.startX, player.startY, player.rotation, player.startHp], [12.4, -45.2, 12.4, 71]);
});

test("legacy practice starts migrate from internal coordinates into centered public coordinates", () => {
    const storage = createStorage();
    storage.setItem(PRACTICE_ROOM_STORAGE_KEY, JSON.stringify({
        version: 2,
        config: { bots: [
            { role: "PLAYER", teamNumber: 1, slot: 1, startX: 600, startY: 1050 },
            { role: "OPPONENT", teamNumber: 2, slot: 1, startX: 600, startY: 150 },
        ] },
    }));

    const migrated = readPracticeRoomDraft(storage);
    assert.deepEqual(migrated.config.bots.map(({ startX, startY }) => [startX, startY]), [[0, -450], [0, 450]]);
    savePracticeRoomDraft({ config: migrated.config }, storage);
    const persisted = JSON.parse(storage.getItem(PRACTICE_ROOM_STORAGE_KEY));
    assert.equal(persisted.version, 3);
    assert.deepEqual(persisted.config.bots.map(({ startX, startY }) => [startX, startY]), [[0, -450], [0, 450]]);
});

test("legacy saved Walk coordinates migrate to centered inputs with a zero origin", () => {
    const upgraded = upgradeStoredStrategyCoordinates({
        roots: [{ branches: [{
            conditions: [{ type: "always" }],
            actions: [
                { action: "move_walk", movementMode: "coordinates", targetX: 600, targetY: 600 },
                { action: "rotate_toward_enemy", targetMode: "coordinates", targetX: 150, targetY: 1050 },
            ],
        }] }],
        customVariables: [],
        editorGraph: {
            version: "code-editor-graph-v1",
            targets: [{ id: "target-1", kind: "target", targetKind: "coordinates", targetX: 1200, targetY: 0 }],
        },
    });

    assert.equal(upgraded.version, "bot-logic-tree-v2");
    assert.deepEqual(upgraded.roots[0].branches[0].actions.map(({ targetX, targetY }) => [targetX, targetY]), [
        [0, 0],
        [-450, -450],
    ]);
    assert.deepEqual([upgraded.editorGraph.targets[0].targetX, upgraded.editorGraph.targets[0].targetY], [600, 600]);
});
