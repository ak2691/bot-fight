import assert from "node:assert/strict";
import test from "node:test";
import {
    loadPuzzleSubmissions,
    MAX_PUZZLE_SUBMISSIONS,
    puzzleSubmissionsStorageKey,
    savePuzzleSubmission,
} from "./puzzleSubmissions.js";

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    };
}

function submission(index, status = "failed") {
    return {
        id: `submission-${index}`,
        submittedAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        status,
        message: `Attempt ${index}`,
        brain: { version: "bot-logic-tree-v1", roots: [{ id: `root-${index}` }] },
    };
}

test("puzzle history keeps only the newest ten submissions", () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_PUZZLE_SUBMISSIONS + 2; index += 1) {
        savePuzzleSubmission("user-1", 7, submission(index), storage);
    }

    const history = loadPuzzleSubmissions("user-1", 7, storage);
    assert.equal(history.length, MAX_PUZZLE_SUBMISSIONS);
    assert.equal(history[0].id, "submission-11");
    assert.equal(history.at(-1).id, "submission-2");
    assert.equal(storage.getItem(puzzleSubmissionsStorageKey("user-1", 7)) !== null, true);
});

test("puzzle history is isolated by user and puzzle", () => {
    const storage = memoryStorage();
    savePuzzleSubmission("user-1", 7, submission(1, "solved"), storage);
    savePuzzleSubmission("user-2", 7, submission(2), storage);
    savePuzzleSubmission("user-1", 8, submission(3), storage);

    assert.equal(loadPuzzleSubmissions("user-1", 7, storage)[0].status, "solved");
    assert.equal(loadPuzzleSubmissions("user-2", 7, storage)[0].id, "submission-2");
    assert.equal(loadPuzzleSubmissions("user-1", 8, storage)[0].id, "submission-3");
});

test("malformed stored records are ignored", () => {
    const storage = memoryStorage();
    storage.setItem(puzzleSubmissionsStorageKey("user-1", 7), JSON.stringify([
        { id: "bad", submittedAt: "not-a-date", brain: {} },
        submission(1),
    ]));

    const history = loadPuzzleSubmissions("user-1", 7, storage);
    assert.deepEqual(history.map((entry) => entry.id), ["submission-1"]);
});
