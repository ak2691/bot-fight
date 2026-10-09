import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { combatLogActive } from "../ecs/combatLog.js";
import {
    BROWSER_GOLDEN_FILE,
    loadGolden,
    loadScenarios,
    runScenario,
} from "./goldenScenarioRunner.js";

// Browser half of the golden scenarios. Regenerate the golden with `npm run golden:update` after an
// intended gameplay change; the server half is GoldenScenariosTest.java (mvnw test -Dgolden.update=true).
const file = loadScenarios();
const golden = fs.existsSync(BROWSER_GOLDEN_FILE) ? loadGolden(BROWSER_GOLDEN_FILE) : { scenarios: {} };

test("the golden file covers exactly the shared scenarios", () => {
    assert.deepEqual(Object.keys(golden.scenarios).sort(), file.scenarios.map((scenario) => scenario.id).sort());
});

for (const scenario of file.scenarios) {
    test(`golden scenario ${scenario.id}`, () => {
        const expected = golden.scenarios[scenario.id];
        assert.ok(expected, `no golden for ${scenario.id}; run npm run golden:update`);
        const actual = runScenario(scenario);
        assert.equal(actual.hashes.length, scenario.ticks);
        assert.deepEqual(actual.log, expected.log, "combat log");
        assert.deepEqual(actual.hashes, expected.hashes, "per-tick state hashes");
    });
}

test("every ability triggers in at least one scenario", () => {
    const triggered = new Set();
    for (const scenario of file.scenarios) {
        for (const entry of runScenario(scenario).log) {
            if (entry.kind === "trigger") triggered.add(entry.abilityId);
        }
    }
    const expected = [...Array(37).keys()].map((index) => index + 1).filter((id) => id !== 2);
    assert.deepEqual(expected.filter((id) => !triggered.has(id)), []);
});

test("the combat log is off unless requested and never changes the result", () => {
    const scenario = file.scenarios.find((candidate) => candidate.id === "melee-slash-heavy-strike");
    const logged = runScenario(scenario);
    const quiet = runScenario(scenario, { log: false });
    assert.ok(logged.log.length > 0);
    assert.deepEqual(quiet.log, []);
    assert.deepEqual(quiet.hashes, logged.hashes);
    assert.equal(combatLogActive(), false, "no log stays bound after a tick");
});

test("log entries use the shared vocabulary", () => {
    const kinds = new Set(["trigger", "effect", "status", "spawn", "phase", "removal", "stamina"]);
    const stages = new Set(["decide", "act", "resolveHits", "spawn", "entities", "hazards", "settle"]);
    for (const scenario of file.scenarios) {
        for (const entry of runScenario(scenario).log) {
            assert.deepEqual(Object.keys(entry),
                ["tick", "stage", "kind", "source", "target", "abilityId", "effect", "amount"]);
            assert.ok(kinds.has(entry.kind), `${scenario.id}: ${entry.kind}`);
            assert.ok(stages.has(entry.stage), `${scenario.id}: ${entry.stage}`);
        }
    }
});
