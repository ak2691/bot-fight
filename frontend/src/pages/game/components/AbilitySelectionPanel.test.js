import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./AbilitySelectionPanel.jsx", import.meta.url));

test("ability selection panel keeps draft limits, stat controls, and detail modal wiring", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /loadoutDraftState/);
    assert.match(source, /\.join\(" · "\)/);
    assert.match(source, /toggleDraftAbility/);
    assert.match(source, /hasAllDraftPicks/);
    assert.match(source, /aria-pressed=\{active\}/);
    assert.match(source, /disabled=\{unavailable\}/);
    assert.match(source, /aria-label=\{`View \$\{ability\.label\} stats`\}/);
    assert.match(source, /onChange\(toggleDraftAbility\(/);
    assert.match(source, /Increase \$\{label\}/);
    assert.match(source, /Decrease \$\{label\}/);
    assert.match(source, /<AbilityModal ability=\{selectedAbility\}/);
    assert.match(source, /role="alert"/);
});
