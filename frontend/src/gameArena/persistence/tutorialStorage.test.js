import test from "node:test";
import assert from "node:assert/strict";
import {
    loadTutorialGuideProgress,
    loadTutorialProgress,
    saveTutorialGuideProgress,
    saveTutorialProgress,
} from "./tutorialStorage.js";

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        values,
    };
}

test("tutorial lesson and guide positions restore from versioned scenario records", () => {
    const previousStorage = globalThis.localStorage;
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    try {
        saveTutorialProgress(10);
        saveTutorialGuideProgress(10, 3);
        assert.equal(loadTutorialProgress(0), 10);
        assert.equal(loadTutorialGuideProgress(10), 3);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});

test("tutorial content revision mismatches reset lesson and guide positions", () => {
    const previousStorage = globalThis.localStorage;
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    try {
        saveTutorialProgress(11);
        saveTutorialGuideProgress(11, 4);
        for (const [key, value] of storage.values) {
            const record = JSON.parse(value);
            storage.setItem(key, JSON.stringify({ ...record, revision: "stale-tutorial" }));
        }
        assert.equal(loadTutorialProgress(0), 0);
        assert.equal(loadTutorialGuideProgress(11), 0);
    } finally {
        globalThis.localStorage = previousStorage;
    }
});
