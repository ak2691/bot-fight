import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./AbilitySelectionPanel.jsx", import.meta.url));

test("ability selection panel keeps draft limits and detail modal wiring", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /loadoutDraftState/);
    assert.match(source, /guaranteedAbilityId/);
    assert.match(source, /String\(guaranteedAbilityId\) === String\(ability\.id\)/);
    assert.match(source, /pointer-events-none absolute left-3 top-3/);
    assert.match(source, />\s*Guaranteed\s*<\/span>/);
    assert.match(source, /\.join\(" · "\)/);
    assert.match(source, /toggleDraftAbility/);
    assert.match(source, /hasAllDraftPicks/);
    assert.match(source, /aria-pressed=\{active\}/);
    assert.match(source, /disabled=\{unavailable\}/);
    assert.match(source, /aria-label=\{`View \$\{ability\.label\} stats`\}/);
    assert.match(source, /src="\/assets\/arena-toolbar\/info-circle-icon\.png"/);
    assert.match(source, /role="button"/);
    assert.match(source, /cursor-pointer/);
    assert.match(source, /\(Me\)/);
    assert.doesNotMatch(source, /className="gray-button-surface absolute right-3 top-3/);
    assert.match(source, /onChange\(toggleDraftAbility\(/);
    assert.doesNotMatch(source, /STAT POINTS|Increase \$\{label\}|Decrease \$\{label\}/);
    assert.match(source, /<AbilityModal ability=\{selectedAbility\}/);
    assert.match(source, /role="alert"/);
    assert.match(source, /MatchToolIcon/);
    assert.match(source, /onSurrender/);
    assert.match(source, /FORFEIT/);
    assert.match(source, /arena-toolbar-button arena-toolbar-button--red arena-toolbar-button--inline/);
    assert.match(source, /arena-toolbar-button arena-toolbar-button--blue arena-toolbar-button--inline min-w-52/);
    assert.match(source, /disabled=\{!canSurrender \|\| surrenderPending\}/);
    assert.match(source, /WITHDRAW FORFEIT/);
});
