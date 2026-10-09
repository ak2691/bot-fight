// Regenerates shared/gameplay-tests/golden.browser.json from the shared golden scenarios.
// Run `npm run golden:update` after an intended gameplay change, then review the golden diff.
import fs from "node:fs";
import { BROWSER_GOLDEN_FILE, runAllScenarios } from "../src/gameArena/testing/goldenScenarioRunner.js";
import { formatGolden } from "../src/gameArena/testing/goldenFormat.js";

const golden = runAllScenarios();
fs.writeFileSync(BROWSER_GOLDEN_FILE, formatGolden(golden));
console.log(`Wrote ${BROWSER_GOLDEN_FILE} (${Object.keys(golden.scenarios).length} scenarios)`);
