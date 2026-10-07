import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// SubmissionClient imports extensionless browser modules, so its payload shape is checked from source.
const source = readFileSync(new URL("./SubmissionClient.js", import.meta.url), "utf8");

test("a submission carries variable resets and the timeout fallback only when set", () => {
    assert.match(source, /variableResets = null,\s*timeoutFallback = null,/);
    assert.match(source, /Array\.isArray\(variableResets\) && variableResets\.length > 0 \? \{ variableResets: \[\.\.\.new Set\(variableResets\)\] \} : \{\}/);
    assert.match(source, /\.\.\.\(timeoutFallback \? \{ timeoutFallback \} : \{\}\)/);
});
