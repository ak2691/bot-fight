// Writes the unhashed per-tick state lines of one golden scenario so a hash mismatch can be read.
//   npm run golden:dump -- <scenario-id|all>   ->  artifacts/golden-debug/browser.<scenario-id>.txt
// The server writes the same layout with -Dgolden.debug=<scenario-id> (GoldenScenariosTest).
import fs from "node:fs";
import path from "node:path";
import { formatStateDump, loadScenarios, runScenario, SCENARIO_FILE } from "../src/gameArena/testing/goldenScenarioRunner.js";

const id = process.argv[2];
const file = loadScenarios();
const selected = id === "all" ? file.scenarios : file.scenarios.filter((candidate) => candidate.id === id);
if (selected.length === 0) {
    console.error(`usage: npm run golden:dump -- <scenario-id>\nscenarios: ${file.scenarios.map((s) => s.id).join(", ")}`);
    process.exit(1);
}
for (const scenario of selected) {
    const out = path.resolve(path.dirname(SCENARIO_FILE), "../../artifacts/golden-debug", `browser.${scenario.id}.txt`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, formatStateDump(runScenario(scenario, { log: false })));
    console.log(`Wrote ${out}`);
}
