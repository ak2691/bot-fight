import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_PATH = fileURLToPath(new URL("./useMatchLifecycle.js", import.meta.url));

test("match lifecycle hook retains authoritative event and timer transitions", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");

    assert.match(source, /export function useMatchLifecycle\(\{ initialRouteMatchEvent, navigate \}\)/);
    assert.match(source, /const handleMatchEvent = \(rawEvent/);
    assert.match(source, /MATCH_ACCEPTED/);
    assert.match(source, /MATCH_LOADOUT_SELECTION_READY/);
    assert.match(source, /MATCH_REPLAY_BATCH/);
    assert.match(source, /MATCH_RESULT_READY/);
    assert.match(source, /matchAcceptanceAuthoritativeDeadlineRef/);
    assert.match(source, /updateQueueStatus\("WAITING"\)/);
    assert.match(source, /isMatchAcceptanceUnavailableError/);
    assert.match(source, /setInterval\(update, 100\)/);
    assert.match(source, /setInterval\(\(\) => \{/);
    assert.match(source, /preloadShapes: arenaPreloadShapes\(matchEvent\)/);
});

test("match errors preserve the current rendered phase", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const errorHandler = source.slice(
        source.indexOf('if (event.type === "MATCH_ERROR")'),
        source.indexOf('if (event.type === "SIMULATION_PREPARING")'),
    );

    assert.doesNotMatch(errorHandler, /updateQueueStatus\("BUILDING"\)/);
    assert.match(errorHandler, /setLoadoutSubmitPending\(false\)/);
});
