import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAbilityEntity } from "../ecs/abilities/AbilityEntitySystem.js";
import { createCombatLog } from "../ecs/combatLog.js";
import { initialAbilityState } from "../gameconfig/AbilityResourceSystem.js";
import { preparingAbilityId, preparingRemainingMs } from "../gameconfig/AbilityState.js";
import { STANDARD_ABILITY_IDS, encodeBotLoadout } from "../loadout/BotLoadout.js";
import { createFight } from "../modelPayloads/arenaPreviewSimulation.js";
import { normalizeAbilityStrategyConfiguration } from "../botlogic/code/BotCode.js";
import { buildInitialArenaShapes, resetBotShape } from "../modelPayloads/arenaShapes.js";
import { isBotState } from "../modelPayloads/botState.js";

/**
 * Runs the shared golden scenarios (shared/gameplay-tests/goldenScenarios.json) through the browser tick
 * and returns, per scenario, the combat log and a per-tick hash of the bot and entity state. The server
 * does the same in GoldenScenarioRunner.java; the two runtimes keep separate golden files.
 */
const SHARED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../shared/gameplay-tests");
export const SCENARIO_FILE = path.join(SHARED_DIR, "goldenScenarios.json");
export const BROWSER_GOLDEN_FILE = path.join(SHARED_DIR, "golden.browser.json");
export const SERVER_GOLDEN_FILE = path.join(SHARED_DIR, "golden.server.json");

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
        // Abilities are set after the reset so ids outside the practice picker (Lock On, Basic Strike) can run
        // like they do on the server, which takes whatever the brain lists.
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

/** Three decimals, null/undefined/NaN as 0, never "-0.000". Same rule as GoldenScenarioRunner.fixed. */
function fixed(value) {
    const number = Number(value ?? 0);
    const text = (Math.round((Number.isFinite(number) ? number : 0) * 1000) / 1000).toFixed(3);
    return text === "-0.000" ? "0.000" : text;
}

/** FNV-1a over the string's UTF-16 code units (the state strings are ASCII). */
export function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/** Runtime-neutral entity id: the browser builds "<type>-<botId>-<n>", the server "ability-<botUuid>-<n>". */
function canonicalEntityId(entity) {
    const id = String(entity.id ?? "");
    const serial = /-([0-9]+)$/.exec(id)?.[1] ?? id;
    return `${entity.type}-s${entity.ownerSlot}-${serial}`;
}

/**
 * The text that gets hashed, one line per bot (by slot) then per ability entity (by id):
 *   b<slot>|x|y|rotation|hp|stamina|preparingAbilityId-or--|preparingMs|<type>:<roundedRemainingMs>,... (sorted)
 *   e|<type>-s<ownerSlot>-<serial>|<type>|x|y|hp
 * Numbers use three decimals; status remainingMs is rounded to whole ms. GoldenScenarioRunner.stateLines
 * on the server must produce the same text.
 */
export function stateLines(shapes) {
    const bots = shapes.filter(isBotState)
        .sort((first, second) => first.slot - second.slot)
        .map((bot) => [
            `b${bot.slot}`, fixed(bot.x), fixed(bot.y), fixed(bot.rotation), fixed(bot.hp), fixed(bot.stamina),
            preparingAbilityId(bot) ?? "-", fixed(preparingRemainingMs(bot)),
            (bot.statusEffects ?? []).map((status) => `${status.type}:${Math.round(Number(status.remainingMs ?? 0))}`).sort().join(","),
        ].join("|"));
    const entities = shapes.filter(isAbilityEntity)
        .map((entity) => ({ entity, id: canonicalEntityId(entity) }))
        .sort((first, second) => (first.id < second.id ? -1 : first.id > second.id ? 1 : 0))
        .map(({ entity, id }) => ["e", id, entity.type, fixed(entity.x), fixed(entity.y), fixed(entity.hp)].join("|"));
    return [...bots, ...entities];
}

export function stateHash(shapes) {
    return fnv1a(stateLines(shapes).join("\n"));
}

export function runScenario(scenario, { log = true } = {}) {
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
