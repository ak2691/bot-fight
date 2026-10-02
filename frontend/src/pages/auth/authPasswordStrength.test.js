import assert from "node:assert/strict";
import test from "node:test";
import { PASSWORD_STRENGTH_LABELS, passwordStrength } from "./authPasswordStrength.js";

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
