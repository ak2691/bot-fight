import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAuthoringGuide } from "./guide.js";
import { generateAbilityScaffold } from "./generators.js";
import { buildAbilityParityReport, catalogRows } from "./parity.js";
import { readBackendSnapshot, readBrowserSnapshot } from "./runtime.js";
import {
    checkNewSpecIdentity,
    listSavedSpecs,
    mergePatch,
    nextAbilityId,
    normalizeAbilitySpec,
    readSavedSpec,
    seedSpecFromRuntime,
    writeSavedSpec,
} from "./spec.js";

const server = new McpServer({
    name: "botfight-ability-authoring",
    version: "1.0.0",
    instructions: "Use get_ability_catalog and get_ability_authoring_guide before authoring. add_ability/edit_ability validate and save canonical specs and return paired snippets; apply runtime changes separately, then call check_ability_parity. No simulation or strategy compiler is provided.",
});

function result(data, { isError = false } = {}) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
        ...(isError ? { isError: true } : {}),
    };
}

function failure(error, context) {
    return result({
        schemaVersion: 1,
        status: "error",
        context,
        error: error instanceof Error ? error.message : String(error),
    }, { isError: true });
}

function runtimeSnapshots() {
    return { browser: readBrowserSnapshot(), backend: readBackendSnapshot() };
}

const falloffInputSchema = z.object({
    minAmount: z.number().optional(),
    maxAmount: z.number().optional(),
    minDurationMs: z.number().int().optional(),
    maxDurationMs: z.number().int().optional(),
    falloffStart: z.number().optional(),
    falloffEnd: z.number().optional(),
}).strict();
const effectInputSchema = z.object({
    type: z.string(),
    subtype: z.string().optional(),
    buff: z.string().optional(),
    amount: z.number().optional(),
    multiplier: z.number().optional(),
    durationMs: z.number().int().optional(),
    delayMs: z.number().int().optional(),
    whileInside: z.boolean().optional(),
    runtimeComputed: z.boolean().optional(),
    recipient: z.string().optional(),
    requiresConfirmedDamage: z.boolean().optional(),
    mirrorsDamage: z.boolean().optional(),
    distanceMode: z.string().optional(),
    falloff: falloffInputSchema.optional(),
    intervalMs: z.number().int().optional(),
    movementLockMs: z.number().int().optional(),
    targetKinds: z.array(z.string()).optional(),
}).strict();
const eventInputSchema = z.object({
    actions: z.array(z.string()).optional(),
    effectTypes: z.array(z.string()).optional(),
    transition: z.object({ to: z.string() }).strict().optional(),
    schedule: z.object({
        mode: z.string().optional(),
        intervalMs: z.number().int().optional(),
        startImmediately: z.boolean().optional(),
        count: z.number().int().optional(),
    }).strict().optional(),
    visualType: z.string().optional(),
    visibleMs: z.number().int().optional(),
    visualSize: z.number().optional(),
    targetPolicy: z.object({
        mode: z.string(),
        intervalStat: z.string().optional(),
        interval: z.string().optional(),
        intervalMs: z.number().int().optional(),
    }).strict().optional(),
    targetKinds: z.array(z.string()).optional(),
    statusTypes: z.array(z.string()).optional(),
    pullDirection: z.string().optional(),
    recheckCollisionOnTransition: z.boolean().optional(),
}).strict();
const phaseInputSchema = z.object({
    id: z.string(),
    type: z.string(),
    movement: z.object({
        speed: z.number(),
        turnDegrees: z.number().optional(),
        size: z.number().optional(),
        distance: z.number().optional(),
        trailMs: z.number().int().optional(),
        blockedByStatus: z.string().optional(),
        direction: z.string().optional(),
    }).strict().optional(),
    trigger: z.object({
        radius: z.number().optional(),
        lifetimeMs: z.number().int().optional(),
        attackHits: z.boolean().optional(),
        projectileOverlap: z.boolean().optional(),
        botContact: z.boolean().optional(),
        chain: z.boolean().optional(),
    }).strict().optional(),
    hitbox: z.object({
        shape: z.string(),
        radius: z.number().optional(),
        range: z.number().optional(),
        arc: z.number().optional(),
        radiusMultiplier: z.number().optional(),
        width: z.number().optional(),
        length: z.number().optional(),
        includeTargetRadius: z.boolean().optional(),
    }).strict().optional(),
    health: z.object({
        hp: z.number().optional(),
        maxHp: z.number(),
        allowFriendlyDamage: z.boolean().optional(),
    }).strict().optional(),
    effects: z.array(effectInputSchema).optional(),
    visual: z.union([z.object({
        type: z.string(),
        state: z.string().optional(),
        visualSize: z.number(),
        visibleMs: z.number().int().optional(),
    }).strict(), z.null()]).optional(),
    events: z.record(z.string(), eventInputSchema).optional(),
    durationMs: z.number().int().optional(),
    execution: z.object({
        event: z.string().optional(),
        interval: z.string().optional(),
        intervalMs: z.number().int().optional(),
        startImmediately: z.boolean().optional(),
        abilityId: z.string().optional(),
    }).strict().optional(),
    transitionOnly: z.boolean().optional(),
    skipOwner: z.boolean().optional(),
    hit: z.object({
        mode: z.string().optional(),
        removeOnHit: z.boolean().optional(),
        oncePerTarget: z.boolean().optional(),
        knockbackDirection: z.string().optional(),
    }).strict().optional(),
    visibleMs: z.number().int().optional(),
    statOverrides: z.record(z.string(), z.number()).optional(),
    effectOverrides: z.record(z.string(), z.object({
        amount: z.number().optional(),
        durationMs: z.number().int().optional(),
        falloff: falloffInputSchema.optional(),
    }).strict()).optional(),
    startMs: z.number().int().optional(),
    orientation: z.object({ mode: z.string(), targetSource: z.string() }).strict().optional(),
}).strict();
const spawnInputSchema = z.object({
    offset: z.object({ x: z.number().optional(), y: z.number().optional() }).strict().optional(),
    rotation: z.number().optional(),
    rotationSpace: z.string().optional(),
}).strict();
const specInputSchema = z.object({
    schemaVersion: z.number().int().optional(),
    id: z.string(),
    name: z.string(),
    abilityId: z.number().int().positive().optional(),
    label: z.string().optional(),
    category: z.string(),
    round: z.number().int(),
    summary: z.string(),
    visualInterpolation: z.string(),
    timing: z.object({
        cooldownMs: z.number(),
        windupMs: z.number().optional(),
        activeMs: z.number().optional(),
        durationMs: z.number().optional(),
        maxCharges: z.number().int().optional(),
        reloadMs: z.number().int().optional(),
        resourceModel: z.string().optional(),
    }).strict(),
    contract: z.object({
        entityType: z.string().nullable().optional(),
        runtimeType: z.string().nullable().optional(),
        spawn: spawnInputSchema.optional(),
        targeting: z.object({
            owner: z.string().optional(),
            position: z.string().optional(),
            clampToRadius: z.number().optional(),
            defaultX: z.union([z.number(), z.string()]).optional(),
            defaultY: z.union([z.number(), z.string()]).optional(),
        }).strict().optional(),
        lifetime: z.object({
            duration: z.number().int().optional(),
            add: z.number().int().optional(),
            timerMode: z.string().optional(),
        }).strict().optional(),
        state: z.object({
            armed: z.boolean().optional(),
            damageMultiplier: z.object({
                context: z.string(),
                fallback: z.object({ ownerStat: z.string(), fallback: z.number() }).strict(),
            }).strict().optional(),
        }).strict().optional(),
        activation: z.object({
            targetMode: z.string().optional(),
            captureAtActivation: z.boolean().optional(),
            phaseFacingDefault: z.string().optional(),
            ignoresGlobalAbilityLock: z.boolean().optional(),
            teleportOncePerActivation: z.boolean().optional(),
            capture: z.record(z.string(), z.unknown()).optional(),
        }).strict().optional(),
        phases: z.array(phaseInputSchema).describe("Ordered phase contract. Each phase owns its geometry, effects, visual, and event handlers."),
        abilities: z.array(z.object({
            id: z.string(),
            spawn: spawnInputSchema.optional(),
            phases: z.array(phaseInputSchema),
        }).strict()).optional(),
    }).strict(),
    implementationNotes: z.object({
        browser: z.string().optional(),
        backend: z.string().optional(),
        visual: z.string().optional(),
    }).strict().optional(),
}).strict();

let authoringQueue = Promise.resolve();
function serializeAuthoringMutation(operation) {
    const pending = authoringQueue.then(operation, operation);
    authoringQueue = pending.catch(() => undefined);
    return pending;
}

server.registerTool("get_ability_catalog", {
    title: "Get the current ability catalog",
    description: "Read current browser and backend ability IDs, names, timing, phases, and browser draft/visual metadata. Optionally include browser contracts and a full field parity summary.",
    inputSchema: {
        includeContracts: z.boolean().optional(),
        includeParity: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
}, async ({ includeContracts = false, includeParity = false }) => {
    try {
        const { browser, backend } = runtimeSnapshots();
        const savedSpecs = await listSavedSpecs();
        const catalog = catalogRows(browser, backend, { includeContracts, savedSpecs });
        catalog.sourceFiles = [
            "frontend/src/gameArena/gameconfig/AbilityRegistry.js",
            "frontend/src/gameArena/gameconfig/Abilities.js",
            "frontend/src/gameArena/loadout/BotLoadout.js",
            "frontend/src/gameArena/ecs/contracts/AbilityContracts.js",
            "server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityRegistry.java",
            "server/src/main/java/com/example/botfight/simulation/gameconfig/Abilities.java",
            "server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java",
        ];
        if (includeParity) {
            const parity = buildAbilityParityReport(browser, backend);
            catalog.parity = {
                status: parity.status,
                mismatchCount: parity.totalMismatchCount,
                sectionMismatchCounts: parity.sectionMismatchCounts,
                mismatches: parity.mismatches,
                coverage: parity.coverage,
            };
        }
        return result(catalog);
    } catch (error) {
        return failure(error, "get_ability_catalog");
    }
});

server.registerTool("get_ability_contract", {
    title: "Get an ability's current runtime contracts",
    description: "Return the raw current browser and authoritative Java contract and timing record for one permanent ability ID, plus its field-level parity result.",
    inputSchema: { abilityId: z.number().int().positive() },
    annotations: { readOnlyHint: true },
}, async ({ abilityId }) => {
    try {
        const { browser, backend } = runtimeSnapshots();
        const id = String(abilityId);
        if (!browser.registry?.[id] && !backend.registry?.[id]) throw new Error("Ability " + abilityId + " is not in either runtime registry.");
        return result({
            schemaVersion: 1,
            abilityId,
            browser: {
                identity: browser.registry?.[id] ?? null,
                loadout: browser.loadout?.[id] ?? null,
                timingAndProjection: browser.timing?.[id] ?? null,
                contract: browser.contracts?.[id] ?? null,
            },
            backend: {
                identity: backend.registry?.[id] ?? null,
                timingAndProjection: backend.timing?.[id] ?? null,
                contract: backend.contracts?.[id] ?? null,
            },
            parity: buildAbilityParityReport(browser, backend, abilityId),
        });
    } catch (error) {
        return failure(error, "get_ability_contract");
    }
});

server.registerTool("get_ability_authoring_guide", {
    title: "Get the current ability authoring rules",
    description: "Load the repository's current ability, effect, target, lifecycle, visual, replay, and browser/server parity rules for adding or editing an ability.",
    inputSchema: {
        operation: z.enum(["add", "edit"]),
        includeFullSourceDocs: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
}, async ({ operation, includeFullSourceDocs = false }) => {
    try {
        return result(await getAuthoringGuide(operation, includeFullSourceDocs));
    } catch (error) {
        return failure(error, "get_ability_authoring_guide");
    }
});

server.registerTool("list_ability_specs", {
    title: "List saved canonical ability specs",
    description: "List MCP-authored AbilitySpec drafts and their assigned permanent IDs. Saved specs are authoring sources; they are not loaded by game runtimes until generated snippets are integrated.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
}, async () => {
    try {
        const specs = await listSavedSpecs();
        return result({ schemaVersion: 1, specCount: specs.length, specs });
    } catch (error) {
        return failure(error, "list_ability_specs");
    }
});

server.registerTool("add_ability", {
    title: "Add a canonical ability spec and paired code scaffold",
    description: "Validate a structured AbilitySpec, assign the next permanent ability ID, save it, and generate browser plus Java catalog/contract snippets and extension points. It does not silently patch active gameplay files.",
    inputSchema: { spec: specInputSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, async ({ spec: input }) => {
    return serializeAuthoringMutation(async () => {
        try {
            if (input.abilityId != null) throw new Error("abilityId is assigned by the MCP and must be omitted.");
            const { browser, backend } = runtimeSnapshots();
            const spec = normalizeAbilitySpec(input);
            await checkNewSpecIdentity(spec, browser, backend);
            spec.abilityId = await nextAbilityId(browser, backend);
            const assigned = normalizeAbilitySpec(spec, { abilityId: spec.abilityId });
            const scaffold = generateAbilityScaffold(assigned);
            const specPath = await writeSavedSpec(assigned);
            return result({
                schemaVersion: 1,
                status: "scaffold_generated",
                sourceCodeApplied: false,
                savedSpecPath: specPath,
                abilityId: assigned.abilityId,
                slug: assigned.id,
                assignedIdPolicy: "max(runtime IDs, saved spec IDs) + 1; gaps are never reused",
                spec: assigned,
                ...scaffold,
            });
        } catch (error) {
            return failure(error, "add_ability");
        }
    });
});

server.registerTool("edit_ability", {
    title: "Edit a canonical ability spec and regenerate paired snippets",
    description: "Seed from a saved spec or the current browser/backend runtime, apply an RFC 7396 JSON Merge Patch while preserving the permanent ID and slug, validate, save, and regenerate paired snippets. It does not silently patch active gameplay files.",
    inputSchema: {
        abilityId: z.number().int().positive(),
        patch: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, async ({ abilityId, patch }) => {
    return serializeAuthoringMutation(async () => {
        try {
            if ("abilityId" in patch || "id" in patch) throw new Error("edit_ability cannot change the assigned abilityId or permanent slug.");
            const { browser, backend } = runtimeSnapshots();
            const id = String(abilityId);
            const saved = (await listSavedSpecs()).find((row) => row.abilityId === abilityId);
            const slug = saved?.id ?? browser.registry?.[id]?.name ?? backend.registry?.[id];
            if (!slug) throw new Error("Ability " + abilityId + " is not in either runtime registry or saved specs.");
            const current = await readSavedSpec(slug);
            const base = current ?? seedSpecFromRuntime(abilityId, browser, backend);
            const merged = mergePatch(base, patch);
            const edited = normalizeAbilitySpec(merged, { abilityId });
            if (edited.id !== base.id) throw new Error("edit_ability cannot change the permanent slug.");
            const scaffold = generateAbilityScaffold(edited);
            const specPath = await writeSavedSpec(edited, { overwrite: true });
            const parity = buildAbilityParityReport(browser, backend, abilityId);
            return result({
                schemaVersion: 1,
                status: "scaffold_regenerated",
                sourceCodeApplied: false,
                savedSpecPath: specPath,
                abilityId,
                slug: edited.id,
                spec: edited,
                preEditRuntimeParity: parity,
                ...scaffold,
            });
        } catch (error) {
            return failure(error, "edit_ability");
        }
    });
});

server.registerTool("check_ability_parity", {
    title: "Check browser/server ability metadata parity",
    description: "Compare live runtime ability identity, timing/resources, derived compatibility values, targeting, phase structure, hitboxes, movement, health, ordered effects, events, schedules, and visuals. Returns structured JSON mismatches; does not simulate combat.",
    inputSchema: { abilityId: z.number().int().positive().optional() },
    annotations: { readOnlyHint: true },
}, async ({ abilityId } = {}) => {
    try {
        const { browser, backend } = runtimeSnapshots();
        return result(buildAbilityParityReport(browser, backend, abilityId));
    } catch (error) {
        return failure(error, "check_ability_parity");
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
