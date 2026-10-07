import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./runtime.js";

const authoringPaths = {
    add: [
        "docs/ABILITIES.md",
        "docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md",
        "frontend/src/gameArena/context.md",
        "server/context.md",
    ],
    edit: [
        "docs/ABILITIES.md",
        "docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md",
        "frontend/src/gameArena/context.md",
        "server/context.md",
    ],
};

const keyHeadings = {
    "docs/ABILITIES.md": [
        "## 1. Where an ability lives",
        "## 2. Two kinds of contract",
        "## 4. Ability lifecycle on the bot",
        "## 6. Phase contract reference",
        "## 7. Entities",
        "## 8. Visuals",
        "## 9. Making a change",
    ],
    "docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md": [
        "## Transforms",
        "## Timed visuals",
        "## Collision schedules",
        "## Combat state",
        "## Required surfaces and tests",
    ],
    "frontend/src/gameArena/context.md": [
        "## Boundaries to preserve",
        "## Relevant documentation",
    ],
    "server/context.md": [
        "## Authority and validation rules",
        "## Cross-runtime gameplay changes",
    ],
};

function extractSections(markdown, headings) {
    const lines = markdown.split(/\r?\n/);
    const wanted = new Set(headings);
    const selected = [];
    let active = false;
    for (const line of lines) {
        if (/^#{1,3} /.test(line)) {
            if (wanted.has(line.trim())) {
                active = true;
                selected.push(line);
                continue;
            }
            if (active && /^#{1,2} /.test(line)) active = false;
        }
        if (active) selected.push(line);
    }
    return selected.join("\n").trim();
}

export async function getAuthoringGuide(operation, includeFullSourceDocs = false) {
    const paths = authoringPaths[operation];
    if (!paths) throw new Error("operation must be add or edit.");
    const documents = {};
    for (const relativePath of paths) {
        const fullPath = path.join(projectRoot, relativePath);
        const markdown = await readFile(fullPath, "utf8");
        const excerpt = keyHeadings[relativePath]
            ? extractSections(markdown, keyHeadings[relativePath])
            : markdown;
        documents[relativePath] = includeFullSourceDocs ? markdown : excerpt;
    }
    return {
        schemaVersion: 1,
        operation,
        purpose: "Authoring reference loaded from the repository's current gameplay guides and runtime context maps.",
        rules: [
            "Ability IDs are permanent positive integers. Assign max(browser ID, backend ID, saved spec ID) + 1; never fill a gap or renumber an existing ID.",
            "Timing/resources belong in the browser Abilities.js and server Abilities.java catalogs. Browser reloadMs/maxCharges correspond to server rechargeMs/charges.",
            "Phase order is authored; phases transition only through explicit events. Keep ordered effect payloads on the phase that applies them.",
            "An event's targetKinds controls collision/event eligibility. Each effect's own targetKinds separately controls who can receive that effect. Damage defaults to BOT and HP_ENTITY; other effects default to BOT.",
            "Use shared phase hitbox shapes (circle, rectangle, ray, arc) and numeric arena units. Keep range, width, length, radius, arc, target-radius expansion, and collision timing aligned across runtimes.",
            "Use allowlisted effect types and explicit subtypes/durations. Add a new generic runtime effect only when existing contracts cannot express it; do not put ability-specific behavior in a generic tick loop.",
            "Visual metadata names an existing renderer/asset and belongs to its phase. Pixi presents state; it never decides movement, collision, damage, readiness, or match outcome.",
            "Set visualInterpolation to none for instantaneous abilities and linear for physical motion. Interpolate authoritative transforms only; presentation timing does not extend gameplay lifetime.",
            "An AbilitySpec and generated snippets do not implement a new renderer, effect executor, targeting payload, replay field, loadout allowlist, or custom simulation behavior. Put those in implementationNotes and add the paired extension at the listed runtime boundary.",
            "After integrating generated snippets, check_ability_parity compares current runtime metadata. It does not run simulation, validation, or gameplay tests.",
        ],
        authoringFlow: [
            "Call get_ability_catalog to inspect permanent IDs and current metadata.",
            operation === "add"
                ? "Call add_ability with the complete structured AbilitySpec. The MCP assigns the next ID, checks the structure, saves the spec, and returns paired source snippets."
                : "Call get_ability_contract, then edit_ability with an RFC 7396 JSON Merge Patch. The MCP preserves the permanent ID, validates the resulting spec, saves it, and returns paired source snippets.",
            "Apply the generated catalog/contract snippets and implement any declared extension points in browser and server systems.",
            "Call check_ability_parity and resolve every reported field mismatch.",
        ],
        documentSections: documents,
        sourceFiles: paths,
    };
}

