import test from "node:test";
import assert from "node:assert/strict";
import { generateAbilityScaffold } from "../src/generators.js";
import { buildAbilityParityReport, catalogRows } from "../src/parity.js";
import { normalizeAbilitySpec } from "../src/spec.js";

function projectileSpec() {
    return {
        schemaVersion: 1,
        id: "test_bolt",
        name: "Test Bolt",
        category: "PROJECTILE",
        round: 1,
        summary: "A test projectile.",
        visualInterpolation: "linear",
        timing: { cooldownMs: 5000, activeMs: 300, durationMs: 600 },
        contract: {
            entityType: "test_bolt",
            runtimeType: "testBolt",
            spawn: { offset: { x: 0, y: 0 }, rotation: 0, rotationSpace: "OWNER" },
            targeting: { owner: "OWNER" },
            lifetime: { timerMode: "AGE", duration: 600 },
            phases: [{
                id: "outbound",
                type: "PROJECTILE",
                movement: { speed: 100, direction: "forward" },
                hitbox: { shape: "rectangle", width: 18, length: 24 },
                effects: [{ type: "DAMAGE", amount: 10, targetKinds: ["BOT", "HP_ENTITY"] }],
                visual: { type: "testBolt", visualSize: 18, visibleMs: 600 },
                events: {
                    COLLISION: {
                        actions: ["APPLY_EFFECTS"],
                        schedule: { mode: "CONTINUOUS" },
                        targetKinds: ["BOT", "HP_ENTITY"],
                    },
                },
            }],
        },
    };
}

test("normalizes and generates paired projectile scaffolds", () => {
    const spec = normalizeAbilitySpec(projectileSpec(), { abilityId: 42 });
    const scaffold = generateAbilityScaffold(spec);
    assert.equal(spec.contract.phases[0].effects[0].targetKinds.length, 2);
    assert.match(scaffold.generatedSnippets.backend["server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java"], /new Hitbox\("rectangle"/);
    assert.match(scaffold.generatedSnippets.backend["server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java"], /EventScheduleMode.CONTINUOUS/);
    assert.match(scaffold.generatedSnippets.browser["frontend/src/gameArena/ecs/contracts/AbilityContracts.js"], /targetKinds/);

    const browserEntry = scaffold.generatedSnippets.browser["frontend/src/gameArena/ecs/contracts/AbilityContracts.js"];
    const evaluated = new Function("entity", "phase", "attachedAbility", "entityAbility",
        "return ({" + browserEntry + "});")(
        (id, value) => ({ id, ...value }),
        (value) => value,
        (value) => value,
        (id, value) => ({ id, ...value }),
    );
    assert.equal(evaluated[42].phases[0].hitbox.length, 24);
});

test("attached scaffold preserves its browser spawn and phase structure", () => {
    const input = projectileSpec();
    input.id = "test_attached";
    input.name = "Test Attached";
    input.category = "BOT_ATTACHED";
    input.contract = {
        spawn: { offset: { x: 12, y: -4 }, rotation: 5, rotationSpace: "OWNER" },
        targeting: { owner: "OWNER" },
        phases: [{ id: "active", type: "BOT_ATTACHED", hitbox: { shape: "circle", radius: 20 }, effects: [] }],
    };
    const spec = normalizeAbilitySpec(input, { abilityId: 43 });
    const scaffold = generateAbilityScaffold(spec);
    const browserEntry = scaffold.generatedSnippets.browser["frontend/src/gameArena/ecs/contracts/AbilityContracts.js"];
    assert.match(browserEntry, /spawn:/);
    assert.match(browserEntry, /x: 12/);
    new Function("entity", "phase", "attachedAbility", "entityAbility", "return ({" + browserEntry + "});")(
        (id, value) => ({ id, ...value }),
        (value) => value,
        (value) => value,
        (id, value) => ({ id, ...value }),
    );
});

test("rejects malformed event lists and attached multi-phase contracts with useful errors", () => {
    const malformedActions = projectileSpec();
    malformedActions.contract.phases[0].events.COLLISION.actions = "APPLY_EFFECTS";
    assert.throws(() => normalizeAbilitySpec(malformedActions), /actions must be an array/);

    const attached = projectileSpec();
    attached.category = "BOT_ATTACHED";
    attached.contract = {
        phases: [
            { id: "first", type: "BOT_ATTACHED" },
            { id: "second", type: "BOT_ATTACHED" },
        ],
    };
    assert.throws(() => normalizeAbilitySpec(attached), /exactly one phase/);
});

test("parity reports a pass only for present matching IDs and preserves target values", () => {
    const matching = {
        registry: { 1: { id: 1, name: "test_ability" } },
        timing: { 1: {} },
        contracts: { 1: {} },
    };
    const backend = { registry: { 1: "test_ability" }, timing: { 1: {} }, contracts: { 1: {} } };
    assert.equal(buildAbilityParityReport(matching, backend).status, "pass");

    const missing = buildAbilityParityReport({ registry: {}, timing: {}, contracts: {} }, { registry: {}, timing: {}, contracts: {} }, 999);
    assert.equal(missing.status, "mismatch");
    assert.equal(missing.mismatches[0].kind, "missing_both");

    const catalog = catalogRows(matching, backend, { savedSpecs: [{ abilityId: 45 }] });
    assert.equal(catalog.suggestedNextAbilityId, 46);
});
