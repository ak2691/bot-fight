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
