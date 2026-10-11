import { activeRemainingMs } from "../gameconfig/AbilityState.js";
import { ABILITIES } from "../gameconfig/AbilityRegistry.js";
import { triggerView } from "../ecs/contracts/AbilityContracts.js";

function freezeDefinition(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeDefinition);
        Object.freeze(value);
    }
    return value;
}

/**
 * Renderer settings keyed by the verb's visual `type` in shared/gameplay/abilities.json.
 * Each key has a renderer module of the same name in `renderers/`. Settings are
 * presentation-only (colours, sizes, fallbacks); they never describe gameplay outcomes.
 * `visualPriority` preserves which active bot visual wins when several are active.
 */
const settingsByType = {
    meleeSlash: { visualPriority: 0, activeMsFallback: 400 },
    // Sniper: a sight line during the wind-up, then a rail_shot ray (direct from the ray origin, active from the visual origin).
    gun: {
        visualPriority: 1,
        sight: { color: 0xef4444, width: 2, alphaMin: 0.35, alphaMax: 0.8, pulses: 3 },
        directRay: { rayFrames: "rail_shot", fallbackRange: 700, fallbackHeight: 16 },
        activeRay: { height: 40, muzzleFlash: true, rayFrames: "rail_shot" },
    },
    stun: { visualPriority: 3 },
    lockOn: { visualPriority: 4 },
    heavySlash: { visualPriority: 5, sizingHitboxAbilityId: 1 },
    pistol: { visualPriority: 7, activeRay: { height: 14, muzzleFlash: true } },
    concussiveShot: { visualPriority: 8, activeRay: { height: 76, muzzleFlash: true } },
    railShot: { visualPriority: 9, activeRay: { height: 100, muzzleFlash: true } },
    repulsorBurst: { visualPriority: 10 },
    basicHeal: { visualPriority: 11 },
    reactiveArmor: { visualPriority: 12, selfGuardFlash: true, tint: 0xfbbf24 },
    absoluteGuard: { visualPriority: 13, selfGuardFlash: true, tint: 0xe2e8f0 },
    phaseStrike: { visualPriority: 14, startBurst: { color: 0xc4b5fd, count: 12 } },
    frostRing: { visualPriority: 15 },
    disruptorDart: { visualPriority: 16, ray: { color: 0x22d3ee, fallbackRange: 500, fallbackWidth: 5, muzzleFlash: true } },
    vampiricBeam: { visualPriority: 17, ray: { color: 0xef4444, fallbackRange: 500, fallbackWidth: 5, muzzleFlash: true } },
    overclock: { visualPriority: 18, periodMs: 100, pulse: 0.18 },
    basicStrike: { visualPriority: 19, ray: { color: 0xf8fafc, fallbackRange: 80, fallbackWidth: 6 } },
    // Placeholder weapon visuals: sized from each contract hitbox, driven only by
    // the ability's wind-up and active stages (abilityState).
    thrust: {
        visualPriority: 20,
        windup: { color: 0xcbd5e1, width: 4, pullbackUnits: 40, lengthUnits: 40 },
        active: { color: 0xcbd5e1, width: 4, tipLength: 14, tipHalfWidth: 8, extendFraction: 0.35, holdFraction: 0.3 },
    },
    cleave: {
        visualPriority: 21,
        windup: { color: 0xf59e0b, alphaStart: 0.25, alphaEnd: 0.6, outlineWidth: 3 },
        sizingHitboxAbilityId: 36, hitboxSizeScale: 1.92, tint: 0xfde68a,
    },
    // Smash (approved "cracks" preview, docs/visual-previews/smash-thrust.html). Lengths are arena
    // units (preview units / 1.25); `impactFraction` places the impact point along the hitbox.
    smash: {
        visualPriority: 22,
        impactFraction: 0.72,
        windup: {
            fill: { color: 0xe2e8f0, alphaStart: 0.04, alphaEnd: 0.14 },
            outline: { color: 0xe2e8f0, alphaStart: 0.25, alphaEnd: 0.6, width: 1.6, dashUnits: 4.8, gapUnits: 4 },
            shadow: { color: 0x000000, alphaStart: 0.15, alphaEnd: 0.55, radiusAlongStart: 14, radiusAlongEnd: 28, radiusAcrossStart: 18, radiusAcrossEnd: 34 },
        },
        active: {
            flash: { color: 0xffffff, alpha: 0.45, falloff: 3 },
            burst: { color: 0xffecc8, alpha: 0.6, falloff: 2, radiusStart: 10, radiusGrow: 22 },
            ring: { color: 0xffffff, radiusStart: 18, radiusGrow: 70, alongScale: 0.8, widthMax: 5, widthMin: 1 },
            cracks: {
                seed: 7, count: 7, segments: 4, lengthMin: 9, lengthSpan: 8, growFraction: 0.12, alpha: 0.8,
                color: 0x0f172a, width: 2.4, highlightColor: 0x94a3b8, highlightAlphaScale: 0.6, highlightWidth: 0.8, highlightOffset: 0.8,
            },
            debris: { seed: 19, count: 9, color: 0x94a3b8, spread: 2.4, reachMin: 70, reachSpan: 110, sizeMin: 3, sizeSpan: 4, spin: 6 },
            chevrons: { color: 0xfde68a, count: 3, offset: 12, spacing: 14, travel: 30, halfHeight: 10, depth: 8, width: 2.4, fadePerChevron: 0.25 },
        },
        linger: {
            ms: 700, crackAlpha: 0.8,
            dust: { color: 0x94a3b8, count: 4, alpha: 0.3, spacing: 14, offsetAcross: 10, riseUnitsPerMs: 0.008, radiusStart: 9, radiusGrowPerMs: 0.012 },
        },
    },
    // Sprint trail (approved option C, docs/visual-previews/sprint-trail.html). Preview units were
    // arena units x 0.42, so the sizes here are the preview sizes / 0.42; offsets are in bot radii.
    sprintTrail: {
        spawnIntervalMs: 50, maxCatchUp: 3, seed: 4129,
        line: { color: 0xe2e8f0, alpha: 0.8, width: 3.6, lifeMs: 220, driftUnits: 33, lengthMin: 19, lengthSpan: 29, behindRadii: 1, sideRadii: 1.1 },
        dust: { color: 0x94a3b8, alpha: 0.45, chance: 0.35, lifeMs: 500, radiusStart: 7, radiusGrow: 14, behindRadii: 0.8, sideRadii: 0.5 },
    },
    // Not an activation visual: the pulse follows the bot's rewind timer fields.
    temporalRewindZone: {
        pulse: {
            timerField: "temporalRewindPulseMs", durationMs: 400,
            xField: "temporalRewindVisualX", fallbackXField: "temporalRewindX",
            yField: "temporalRewindVisualY", fallbackYField: "temporalRewindY",
            asset: "temporalRewind", slot: "rewind-pulse", tint: 0xcffafe, width: 110, height: 110,
        },
    },
    dash: { smokeMs: 500, smokeFrameMs: 100 },
};

export const BOT_ABILITY_VISUAL_SETTINGS = Object.freeze(Object.fromEntries(
    Object.entries(settingsByType).map(([type, settings]) => [type, freezeDefinition(settings)]),
));

const abilityIdByType = new Map();
for (const id of Object.keys(ABILITIES).map(Number)) {
    const type = triggerView(id)?.visual?.type;
    if (type && BOT_ABILITY_VISUAL_SETTINGS[type] && !abilityIdByType.has(type)) abilityIdByType.set(type, id);
}

/** Settings plus the ability that declares the type; `abilityId` is null for types without a trigger visual. */
const presentations = Object.entries(BOT_ABILITY_VISUAL_SETTINGS).map(([type, settings]) =>
    freezeDefinition({ type, abilityId: abilityIdByType.get(type) ?? null, ...settings }));

/** Presentations in active-visual precedence order, then those without a precedence. */
export const BOT_ABILITY_PRESENTATIONS = Object.freeze([...presentations].sort((left, right) =>
    (left.visualPriority ?? Infinity) - (right.visualPriority ?? Infinity)));

const presentationsByType = new Map(BOT_ABILITY_PRESENTATIONS.map((presentation) => [presentation.type, presentation]));
const presentationsByAbilityId = new Map(BOT_ABILITY_PRESENTATIONS
    .filter((presentation) => presentation.abilityId != null)
    .map((presentation) => [presentation.abilityId, presentation]));

/** Ability ids in active-visual precedence order, the order `activeBotVisual` picks from. */
export const BOT_ABILITY_VISUAL_PRIORITY = Object.freeze(BOT_ABILITY_PRESENTATIONS
    .filter((presentation) => presentation.visualPriority != null && presentation.abilityId != null)
    .map((presentation) => presentation.abilityId));

export function botAbilityPresentationForType(type) {
    return presentationsByType.get(type) ?? null;
}

export function botAbilityPresentationForId(abilityId) {
    return presentationsByAbilityId.get(Number(abilityId)) ?? null;
}

export function botAbilityActiveMs(shape, presentation) {
    return presentation?.abilityId == null ? 0 : activeRemainingMs(shape, presentation.abilityId);
}
