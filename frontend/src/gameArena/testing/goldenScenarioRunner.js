import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fnv1a, stateLines } from "../../../../shared/engine/stateHash.js";
export { fnv1a, stateLines, stateHash } from "../../../../shared/engine/stateHash.js";
import { createCombatLog } from "../../../../shared/engine/ecs/combatLog.js";
import { initialAbilityState } from "../../../../shared/engine/gameconfig/AbilityResourceSystem.js";
import { STANDARD_ABILITY_IDS, encodeBotLoadout } from "../../../../shared/engine/loadout/BotLoadout.js";
import { createFight } from "../../../../shared/engine/fight.js";
import { normalizeAbilityStrategyConfiguration } from "../../../../shared/engine/botlogic/code/BotCode.js";
import { buildInitialArenaShapes, resetBotShape } from "../modelPayloads/arenaShapes.js";
import { withTestAbilities } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";

/**
 * Runs the shared golden scenarios (shared/gameplay-tests/goldenScenarios.json) through the browser tick
 * and returns, per scenario, the combat log and a per-tick hash of the bot and entity state. The server
 * does the same in GoldenScenarioRunner.java; the two runtimes keep separate golden files.
 */
const SHARED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../shared/gameplay-tests");
export const SCENARIO_FILE = path.join(SHARED_DIR, "goldenScenarios.json");
export const BROWSER_GOLDEN_FILE = path.join(SHARED_DIR, "golden.browser.json");

export function loadScenarios() {
    return JSON.parse(fs.readFileSync(SCENARIO_FILE, "utf8"));
}

export function loadGolden(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function startingShapes(scenario) {
    return buildInitialArenaShapes(null).map((shape) => {
        const slot = shape.id === "main" ? 1 : 2;
        const spec = scenario.bots.find((candidate) => candidate.slot === slot);
        // Abilities are set after the reset, as the server does: it takes whatever the brain lists.
        const abilities = [...new Set([...STANDARD_ABILITY_IDS, ...spec.abilities])];
        const reset = resetBotShape({
            ...shape,
            x: spec.x,
            y: spec.y,
            rotation: spec.rotation,
            teamNumber: slot,
            size: 60,
            ...(spec.hp != null ? { startHp: spec.hp } : {}),
        });
        return {
            ...reset,
            abilities,
            combatLoadout: encodeBotLoadout({ abilities }),
            abilityState: initialAbilityState(abilities, reset.maxHp),
        };
    });
}

/**
 * Runs one scenario. A scenario may carry `testAbilities`: abilities written in the abilities.json schema that
 * replace the shipped ones of the same id for this run.
 */
export function runScenario(scenario, options = {}) {
    return withTestAbilities(scenario.testAbilities ?? [], () => runScenarioFight(scenario, options));
}

function runScenarioFight(scenario, { log = true } = {}) {
    const combatLog = log ? createCombatLog() : null;
    const hashes = [];
    const states = [];
    const spec = (slot) => scenario.bots.find((bot) => bot.slot === slot);
    const loadoutOf = (slot) => encodeBotLoadout({ abilities: spec(slot).abilities });
    // Brains are normalized once per fight; the tick takes normalized input.
    const configurationOf = (slot) => (spec(slot).roots.length > 0
        ? normalizeAbilityStrategyConfiguration({ roots: spec(slot).roots }) : null);
    const fight = createFight(startingShapes(scenario), {
        selectedLoadout: loadoutOf(1),
        opponentLoadout: loadoutOf(2),
        testingConfiguration: configurationOf(1) ?? normalizeAbilityStrategyConfiguration({ roots: [] }),
        opponentTestingConfiguration: configurationOf(2),
        combatLog,
    });
    for (let tick = 0; tick < scenario.ticks; tick += 1) {
        fight.step();
        const lines = stateLines([...fight.bots, ...fight.entities]);
        states.push(lines);
        hashes.push(fnv1a(lines.join("\n")));
    }
    return { log: combatLog ? combatLog.entries : [], hashes, states };
}

/** Debug text for one scenario: a "tick N <hash>" header then the unhashed state lines, per tick. */
export function formatStateDump(result) {
    return result.states.map((lines, index) => `# tick ${index + 1} ${result.hashes[index]}
${lines.join("\n")}`).join("\n") + "\n";
}

export function runAllScenarios(file = loadScenarios()) {
    return {
        version: file.version,
        runtime: "browser",
        scenarios: Object.fromEntries(file.scenarios.map((scenario) => {
            const { log, hashes } = runScenario(scenario);
            return [scenario.id, { log, hashes }];
        })),
    };
}
