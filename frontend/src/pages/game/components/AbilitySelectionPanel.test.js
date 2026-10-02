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
    assert.match(source, /Round \{draft\.roundNumber\} of 3/);
    assert.match(source, /aria-label=\{`Pick \$\{pickIndex \+ 1\}`\}/);
    assert.match(source, /toggleDraftAbility/);
    assert.match(source, /hasAllDraftPicks/);
    assert.match(source, /self \? "You"/);
    assert.match(source, /onChange\(toggleDraftAbility\(/);
});
