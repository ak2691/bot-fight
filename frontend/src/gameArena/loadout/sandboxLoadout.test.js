import assert from "node:assert/strict";
import test from "node:test";
import {
    SANDBOX_MAX_ABILITY_PICKS,
    sandboxLoadoutWithWeapon,
    sandboxWeaponId,
    toggleSandboxAbility,
} from "./sandboxLoadout.js";

test("a practice loadout defaults to Slash and holds one weapon", () => {
    assert.equal(sandboxWeaponId({ abilities: [] }), 1);
    assert.deepEqual(sandboxLoadoutWithWeapon({ abilities: [6] }).abilities, [1, 6]);
    assert.deepEqual(toggleSandboxAbility({ abilities: [1, 6] }, 36).abilities, [36, 6]);
    assert.deepEqual(toggleSandboxAbility({ abilities: [36] }, 36).abilities, [36], "the weapon cannot be unpicked");
});

test("practice abilities toggle and stop at six picks", () => {
    let loadout = { abilities: [] };
    for (const id of [3, 4, 5, 6, 8, 15, 17, 18]) loadout = toggleSandboxAbility(loadout, id);
    assert.equal(loadout.abilities.length, 1 + SANDBOX_MAX_ABILITY_PICKS);
    assert.ok(!loadout.abilities.includes(18));
    assert.deepEqual(toggleSandboxAbility(loadout, 3).abilities.includes(3), false);
});
