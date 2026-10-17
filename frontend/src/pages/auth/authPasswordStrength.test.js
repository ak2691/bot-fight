import assert from "node:assert/strict";
import test from "node:test";
import { PASSWORD_STRENGTH_LABELS, passwordStrength } from "./authPasswordStrength.js";
import { newPasswordError } from "../../auth/validation.js";

test("password strength grows with length and character variety", () => {
    assert.equal(passwordStrength(""), 0);
    assert.equal(passwordStrength(undefined), 0);
    assert.equal(passwordStrength("abc"), 1);
    assert.equal(passwordStrength("abcdefgh"), 1);
    assert.equal(passwordStrength("abcdefg1"), 2);
    assert.equal(passwordStrength("Abcdefgh1234"), 3);
    assert.equal(passwordStrength("aaaaaaaaaaaaaaaa"), 1);
    assert.deepEqual([...PASSWORD_STRENGTH_LABELS], ["", "Weak", "Okay", "Strong"]);
});

test("new passwords respect the 72-byte UTF-8 hashing limit", () => {
    assert.equal(newPasswordError("a".repeat(72)), null);
    assert.match(newPasswordError("a".repeat(73)), /72 bytes/);
    assert.equal(newPasswordError("é".repeat(36)), null);
    assert.match(newPasswordError("é".repeat(37)), /72 bytes/);
    assert.equal(newPasswordError("short"), "Password must be at least 8 characters.");
});
