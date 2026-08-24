import assert from "node:assert/strict";
import test from "node:test";
import {
    createDefaultAbilityStrategyConfiguration,
    normalizeAbilityStrategyConfiguration,
} from "../gameArena/botlogic/code/BotCode.js";
import {
    puzzleBotCodeStorageKey,
    readPuzzleBotCodeDraft,
    savePuzzleBotCodeDraft,
} from "./puzzleBotCodeStorage.js";

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    };
}

function draft(name) {
    return {
        ...createDefaultAbilityStrategyConfiguration(),
        roots: [{
            id: `root-${name}`,
            name,
            createdOrder: 0,
            branches: [{
                id: `branch-${name}`,
                conditions: [{ type: "always" }],
                actions: [{ action: "swing" }],
                children: [],
            }],
        }],
    };
}

test("puzzle bot drafts are isolated by puzzle and round-trip normalized code", () => {
    const storage = memoryStorage();
    const firstPuzzle = draft("First puzzle draft");
    const secondPuzzle = draft("Second puzzle draft");

    assert.equal(savePuzzleBotCodeDraft(7, firstPuzzle, storage), true);
    assert.equal(savePuzzleBotCodeDraft(8, secondPuzzle, storage), true);
    assert.equal(storage.getItem(puzzleBotCodeStorageKey(7)) !== null, true);
    assert.deepEqual(readPuzzleBotCodeDraft(7, null, storage), normalizeAbilityStrategyConfiguration(firstPuzzle));
    assert.deepEqual(readPuzzleBotCodeDraft(8, null, storage), normalizeAbilityStrategyConfiguration(secondPuzzle));
    assert.notDeepEqual(readPuzzleBotCodeDraft(7, null, storage), readPuzzleBotCodeDraft(8, null, storage));
});

test("missing or malformed puzzle drafts fall back to the server puzzle code", () => {
    const storage = memoryStorage();
    const fallback = draft("Server puzzle code");

    assert.deepEqual(readPuzzleBotCodeDraft(7, fallback, storage), normalizeAbilityStrategyConfiguration(fallback));
    storage.setItem(puzzleBotCodeStorageKey(7), "not-json");
    assert.deepEqual(readPuzzleBotCodeDraft(7, fallback, storage), normalizeAbilityStrategyConfiguration(fallback));
});
