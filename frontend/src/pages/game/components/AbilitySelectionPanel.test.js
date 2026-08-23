import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./AbilitySelectionPanel.jsx", import.meta.url));

test("ability selection panel keeps draft limits and detail modal wiring", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /loadoutDraftState/);
    assert.match(source, /\.join\(" · "\)/);
    assert.match(source, /toggleDraftAbility/);
    assert.match(source, /hasAllDraftPicks/);
    assert.match(source, /aria-pressed=\{active\}/);
    assert.match(source, /disabled=\{unavailable\}/);
    assert.match(source, /aria-label=\{`View \$\{ability\.label\} stats`\}/);
    assert.match(source, /src="\/assets\/arena-toolbar\/info-circle-icon\.png"/);
    assert.match(source, /role="button"/);
    assert.match(source, /cursor-pointer/);
    assert.doesNotMatch(source, /className="gray-button-surface absolute right-3 top-3/);
    assert.match(source, /onChange\(toggleDraftAbility\(/);
    assert.doesNotMatch(source, /STAT POINTS|Increase \$\{label\}|Decrease \$\{label\}/);
    assert.match(source, /<AbilityModal ability=\{selectedAbility\}/);
    assert.match(source, /role="alert"/);
    assert.match(source, /MatchToolIcon/);
    assert.match(source, /onSurrender/);
    assert.match(source, /FORFEIT/);
    assert.match(source, /disabled=\{!canSurrender \|\| surrenderPending \|\| hasSurrendered\}/);
});
