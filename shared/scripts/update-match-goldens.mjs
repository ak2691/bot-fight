// Rewrites shared/engine/match/tests/goldens/<name>.golden.json from the current simulateMatch output.
// Run `npm --prefix shared run golden:update` only when a simulation change is intended, then review the diff.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GOLDENS_DIR, readRequest, requestNames, summarize } from "../engine/match/tests/goldens/summarize.js";

const names = requestNames();
for (const name of names) {
    const summary = summarize(readRequest(name));
    const target = path.join(GOLDENS_DIR, `${name}.golden.json`);
    writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`${name}: ${summary.result} frames=${summary.frameCount} lastElapsedMs=${summary.lastElapsedMs}`);
}
console.log(`Wrote ${names.length} golden files to ${path.relative(process.cwd(), GOLDENS_DIR) || "."}`);
