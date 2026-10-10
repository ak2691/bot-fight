import { activeRemainingMs } from "../../../../shared/engine/gameconfig/AbilityState.js";
import { ABILITIES } from "../../../../shared/engine/gameconfig/AbilityRegistry.js";
import { triggerView } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";

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
    smash: {
        visualPriority: 22,
        windup: { color: 0xe2e8f0, alphaStart: 0.15, alphaEnd: 0.75, outlineWidth: 3 },
        active: { color: 0xe2e8f0, fillAlpha: 0.5, impactColor: 0xffffff, impactWidth: 6, dustColor: 0x94a3b8, dustPuffs: 3 },
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
