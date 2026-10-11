import { loadScenarios, runScenario } from "./goldenScenarioRunner.js";
const ids = process.argv.slice(2);
for (const scenario of loadScenarios().scenarios.filter((s) => ids.includes(s.id) || (ids[0] === "all" && s.id.startsWith("timeline")))) {
    const result = runScenario(scenario);
    console.log("==", scenario.id);
    for (const e of result.log) if (e.kind !== "status") console.log(JSON.stringify(e));
    if (process.env.STATES) result.states.forEach((lines, i) => console.log(i + 1, lines.join(" || ")));
}
