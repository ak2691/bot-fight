import assert from "node:assert/strict";
import test from "node:test";
import { advanceShapes as advanceArenaPreviewTickNormalized } from "../../testing/fightTick.js";
import { buildInitialArenaShapes, buildOpponentShape } from "../../modelPayloads/arenaShapes.js";
import { NEVER_HIT_SECONDS, abilitySinceHitSeconds } from "../../../../../shared/engine/gameconfig/AbilityHitRecord.js";
import { createAbilityEntity } from "../../../../../shared/engine/ecs/entities/EntityFactory.js";
import { applyEffectsFromEntity } from "../../../../../shared/engine/ecs/abilities/effects.js";
import { STATE_VARIABLE_BY_ID } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { normalizeAbilityStrategyConfiguration as normalizeBrainForTick } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { activeRemainingMs } from "../../../../../shared/engine/gameconfig/AbilityState.js";

// The tick takes normalized brains; tests pass raw ones, so normalize here like the edge does.
const normalizeOrNull = (configuration) => (configuration ? normalizeBrainForTick(configuration) : configuration);
const advanceArenaPreviewTick = (shapes, options) => advanceArenaPreviewTickNormalized(shapes, {
    ...options,
    testingConfiguration: normalizeOrNull(options.testingConfiguration),
    opponentTestingConfiguration: normalizeOrNull(options.opponentTestingConfiguration),
});

// Mirrors server TimeSinceHitSimulationTest; keep the scenarios and numbers in step.
const SLASH = 1;
const FIREBALL = 5;
const MAIN_Y = 600;

const sinceHit = (ability) => ({
    type: "expression", left: "bot.selectedAbilitySinceHit", ability, selectable: "my_bot", leftSelectable: "my_bot",
    comparator: "lt", right: { type: "number", value: NEVER_HIT_SECONDS },
});
const castAbility = (ability) => ({ priority: 1, branches: [{ priority: 1, branchType: "if", conditions: [{ type: "always" }], actions: [{ action: ability, selectable: "opponent_1" }], children: [] }] });
const walk = (priority, direction, conditions) => ({ priority, branches: [{ priority: 1, branchType: "if", conditions, actions: [{ action: "move_walk", movementMode: "absolute", movementDirection: direction }], children: [] }] });

function arena({ ability, defenderX, defenderY = MAIN_Y, allyX = null }) {
    const loadout = `custom:${ability}`;
    let shapes = buildInitialArenaShapes(null).map((shape) => {
        const placed = shape.id === "main"
            ? { ...shape, x: 300, y: MAIN_Y, rotation: 90, teamNumber: 1 }
            : { ...shape, x: defenderX, y: defenderY, rotation: 270 };
        return { ...placed, abilities: [ability], combatLoadout: loadout };
    });
    if (allyX != null) {
        const teammate = {
            ...buildOpponentShape({ slot: 3, userId: "ally", teamNumber: 1, selectedLoadout: loadout }),
            id: "bot-ally", type: "bot", x: allyX, y: MAIN_Y, rotation: 270,
        };
        shapes = [...shapes, teammate];
    }
    return { shapes, loadout };
}

function runArena({ shapes, loadout }, configuration, ticks, opponentConfiguration = null) {
    const history = [];
    let current = shapes;
    for (let tick = 0; tick < ticks; tick += 1) {
        current = advanceArenaPreviewTick(current, {
            selectedLoadout: loadout, opponentLoadout: loadout, testingConfiguration: configuration, opponentTestingConfiguration: opponentConfiguration,
        });
        const bots = Object.fromEntries(current.filter((shape) => shape.slot != null).map((shape) => [shape.id, shape]));
        history.push({ main: bots.main, defender: bots["opponent-model"], ally: bots["bot-ally"], entities: current.filter((shape) => shape.abilityId != null) });
    }
    return history;
}

const firstTickWhere = (history, predicate) => history.findIndex(predicate);

test("Time Since Hit is a generic ability variable with the general number range", () => {
    const variable = STATE_VARIABLE_BY_ID.get("bot.selectedAbilitySinceHit");
    assert.equal(variable.label, "Time Since Hit");
    assert.equal(variable.valueType, "number");
    assert.equal(variable.supportsAbility, true);
    assert.deepEqual([variable.min, variable.max, variable.step, variable.unit], [0, 99_999, 0.1, "seconds"]);
    assert.equal(abilitySinceHitSeconds({}, SLASH), NEVER_HIT_SECONDS);
});

test("Slash hit reads 0.1 the next tick and keeps counting through misses", () => {
    const configuration = { roots: [castAbility(SLASH), walk(2, 270, [sinceHit(SLASH)])] };
    const history = runArena(arena({ ability: SLASH, defenderX: 380 }), configuration, 14);
    const hit = firstTickWhere(history, ({ defender }) => defender.hp < defender.maxHp);
    assert.ok(hit >= 0, "Slash lands on the adjacent defender");
    for (let tick = 0; tick < hit; tick += 1) assert.equal(history[tick].main.abilityLastHitAgeMs?.[SLASH], undefined);
    for (const [offset, ageMs] of [[0, 100], [1, 200], [2, 300], [3, 400]]) {
        assert.equal(history[hit + offset].main.abilityLastHitAgeMs[SLASH], ageMs, `tick ${hit + offset}`);
    }
    // The condition sees 0.1 on the tick after the hit: that is when the walk away starts.
    const firstMove = firstTickWhere(history, ({ main }) => main.x < 300);
    assert.equal(firstMove, hit + 1);
});

test("Fireball hit is attributed at impact time, not cast time", () => {
    const configuration = { roots: [castAbility(FIREBALL)] };
    const history = runArena(arena({ ability: FIREBALL, defenderX: 800 }), configuration, 24);
    const impact = firstTickWhere(history, ({ defender }) => defender.hp < defender.maxHp);
    const cast = firstTickWhere(history, ({ main }) => main.triggeredAbility === FIREBALL || activeRemainingMs(main, FIREBALL) > 0);
    assert.ok(impact > 1, "the projectile takes time to arrive");
    assert.ok(cast < impact, "the Fireball was cast before it landed");
    for (let tick = 0; tick < impact; tick += 1) assert.equal(history[tick].main.abilityLastHitAgeMs?.[FIREBALL], undefined, `tick ${tick}`);
    assert.equal(history[impact].main.abilityLastHitAgeMs[FIREBALL], 100);
    assert.equal(history[impact + 1].main.abilityLastHitAgeMs[FIREBALL], 200);
});

test("A hit on an ally does not count", () => {
    for (const ability of [SLASH, FIREBALL]) {
        const history = runArena(arena({ ability, defenderX: 300, defenderY: 1150, allyX: ability === SLASH ? 380 : 700 }),
            { roots: [castAbility(ability)] }, 24);
        assert.ok(history.every(({ main, defender }) => defender.hp === defender.maxHp && main.abilityLastHitAgeMs?.[ability] === undefined),
            `ability ${ability} never hit an enemy, so it never records a hit`);
    }
});

test("An ability that never hit reads the general number limit", () => {
    const history = runArena(arena({ ability: SLASH, defenderX: 1100 }), { roots: [castAbility(SLASH)] }, 8);
    assert.ok(history.every(({ main }) => main.abilityLastHitAgeMs?.[SLASH] === undefined));
    assert.equal(abilitySinceHitSeconds(history.at(-1).main, SLASH), 99_999);
});

test("Entity effects record a hit for the owner only when they land on an enemy bot", () => {
    const owner = { id: "o", slot: 1, teamNumber: 1, x: 100, y: 100, size: 60, hp: 150, maxHp: 150 };
    const ally = { id: "a", slot: 3, teamNumber: 1, x: 300, y: 100, size: 60, hp: 150, maxHp: 150 };
    const enemy = { id: "e", slot: 2, teamNumber: 2, x: 500, y: 100, size: 60, hp: 150, maxHp: 150 };
    const source = { ownerId: "o", ownerSlot: 1, x: 300, y: 100, abilityId: FIREBALL };
    const effects = [{ type: "damage", amount: 5, targetKinds: ["BOT"] }];
    // The effects change the bots in place, so each landing starts from fresh copies.
    const land = (targetIndex) => {
        const bots = [owner, ally, enemy].map((bot) => ({ ...bot }));
        applyEffectsFromEntity(bots, targetIndex, source, FIREBALL, { effects });
        return bots;
    };

    assert.deepEqual(land(1)[0].abilityHitsThisTick ?? [], []);
    assert.deepEqual(land(2)[0].abilityHitsThisTick, [FIREBALL]);
    assert.equal(land(2)[2].hp, 145);
});

test("A hit on an enemy summon does not count", () => {
    const { shapes, loadout } = arena({ ability: SLASH, defenderX: 300, defenderY: 1150 });
    const opponent = shapes.find((shape) => shape.id === "opponent-model");
    const drone = { ...createAbilityEntity(opponent, 17, {}), x: 380, y: MAIN_Y };
    const history = runArena({ shapes: [...shapes, drone], loadout }, { roots: [castAbility(SLASH)] }, 6);
    assert.ok(history.at(-1).entities.find((entity) => entity.abilityId === 17).hp < drone.hp, "the Slash did hit the summon");
    assert.ok(history.every(({ main }) => main.abilityLastHitAgeMs?.[SLASH] === undefined));
});

test("Time Since Hit can be read for an opponent's ability", () => {
    const opponentCondition = { ...sinceHit(SLASH), selectable: "opponent_1", leftSelectable: "opponent_1" };
    const watcher = { roots: [walk(1, 180, [opponentCondition])] };
    const history = runArena(arena({ ability: SLASH, defenderX: 380 }), watcher, 8, { roots: [castAbility(SLASH)] });
    const hit = firstTickWhere(history, ({ main }) => main.hp < main.maxHp);
    assert.ok(hit >= 0, "the opponent's Slash lands on My Bot");
    assert.equal(history[hit].defender.abilityLastHitAgeMs[SLASH], 100);
    // My Bot starts walking on the tick after it reads 0.1 for the opponent's Slash.
    assert.equal(firstTickWhere(history, ({ main }) => main.y !== MAIN_Y), hit + 1);
});
