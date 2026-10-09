/**
 * Writes a golden file with one combat-log entry per line so a changed golden reviews as a readable diff.
 * The server writes the same layout (GoldenScenarioRunner.java).
 */
export function formatGolden(golden) {
    const scenarios = Object.entries(golden.scenarios).map(([id, scenario]) => {
        const log = scenario.log.map((entry) => `        ${JSON.stringify(entry)}`).join(",\n");
        return `    ${JSON.stringify(id)}: {\n`
            + `      "hashes": ${JSON.stringify(scenario.hashes)},\n`
            + `      "log": [${log ? `\n${log}\n      ` : ""}]\n    }`;
    });
    return `{\n  "version": ${golden.version},\n  "runtime": ${JSON.stringify(golden.runtime)},\n`
        + `  "scenarios": {\n${scenarios.join(",\n")}\n  }\n}\n`;
}
