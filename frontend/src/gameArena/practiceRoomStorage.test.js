import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAbilityStrategyConfiguration } from "./botlogic/code/BotCode.js";
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
    assert.equal(saved.config.bots[0].startX, 30);
    assert.equal(saved.config.bots[0].startHp, 150);
    assert.equal(saved.config.bots[0].brain, undefined);
});
