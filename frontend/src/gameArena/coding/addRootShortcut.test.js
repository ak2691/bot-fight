import assert from "node:assert/strict";
import test from "node:test";
import {
    ADD_ROOT_SHORTCUT_STORAGE_KEY,
    isAddRootShortcutKeydown,
    readAddRootShortcut,
    saveAddRootShortcut,
} from "./addRootShortcut.js";

function storageWith(value) {
    const entries = new Map(value == null ? [] : [[ADD_ROOT_SHORTCUT_STORAGE_KEY, value]]);
    return {
        getItem: (key) => entries.get(key) ?? null,
        setItem: (key, next) => entries.set(key, next),
    };
}

test("add-root shortcut defaults to R when storage is missing, invalid, or unavailable", () => {
    assert.equal(readAddRootShortcut(storageWith(null)), "r");
    for (const invalid of ["", "F1", "-", "ab", " "]) {
        assert.equal(readAddRootShortcut(storageWith(invalid)), "r");
    }
    assert.equal(readAddRootShortcut({ getItem: () => { throw new Error("blocked"); } }), "r");
});

test("add-root shortcut accepts one letter or digit and saves it in lowercase", () => {
    const storage = storageWith(null);
    assert.equal(saveAddRootShortcut("G", storage), true);
    assert.equal(readAddRootShortcut(storage), "g");
    assert.equal(saveAddRootShortcut("7", storage), true);
    assert.equal(readAddRootShortcut(storage), "7");
    assert.equal(saveAddRootShortcut("Enter", storage), false);
    assert.equal(readAddRootShortcut(storage), "7");
});

test("add-root shortcut ignores typing, modifiers, and repeated presses", () => {
    const keydown = { key: "R", target: { closest: () => null } };
    assert.equal(isAddRootShortcutKeydown(keydown, "r"), true);
    assert.equal(isAddRootShortcutKeydown({ ...keydown, repeat: true }, "r"), false);
    assert.equal(isAddRootShortcutKeydown({ ...keydown, ctrlKey: true }, "r"), false);
    assert.equal(isAddRootShortcutKeydown({ ...keydown, target: { closest: () => ({}) } }, "r"), false);
    assert.equal(isAddRootShortcutKeydown({ ...keydown, key: "T" }, "r"), false);
});
