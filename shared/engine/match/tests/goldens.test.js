import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { GOLDENS_DIR, readRequest, requestNames, summarize } from "./goldens/summarize.js";

const UPDATE_HINT = "Run `npm --prefix shared run golden:update` only if the change is intended, then review the golden diff.";

for (const name of requestNames()) {
    test(`match golden: ${name}`, () => {
        const goldenPath = path.join(GOLDENS_DIR, `${name}.golden.json`);
        assert.ok(existsSync(goldenPath), `Missing golden for ${name}. ${UPDATE_HINT}`);
        const expected = JSON.parse(readFileSync(goldenPath, "utf8"));
        const actual = summarize(readRequest(name));
        assert.deepEqual(
            actual,
            expected,
            `Match golden changed for ${name} (duel-v1 simulateMatch output). ${UPDATE_HINT}`,
        );
    });
}
