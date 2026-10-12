import { activeRemainingMs } from "../../../../shared/engine/gameconfig/AbilityState.js";
import { ABILITIES } from "../../../../shared/engine/gameconfig/AbilityRegistry.js";
import { activationView } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";

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
    repulsorBurst: { visualPriority: 10 },
    phaseStrike: { visualPriority: 14, startBurst: { color: 0xc4b5fd, count: 12 } },
    frostRing: { visualPriority: 15 },
    disruptorDart: { visualPriority: 16, ray: { color: 0x22d3ee, fallbackRange: 500, fallbackWidth: 5, muzzleFlash: true } },
    vampiricBeam: { visualPriority: 17, ray: { color: 0xef4444, fallbackRange: 500, fallbackWidth: 5, muzzleFlash: true } },
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
    // Smash (approved "cracks" preview). Lengths are arena
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
    // Sprint trail (approved option C). Preview units were
    // arena units x 0.42, so the sizes here are the preview sizes / 0.42; offsets are in bot radii.
    sprintTrail: {
        spawnIntervalMs: 50, maxCatchUp: 3, seed: 4129,
        line: { color: 0xe2e8f0, alpha: 0.8, width: 3.6, lifeMs: 220, driftUnits: 33, lengthMin: 19, lengthSpan: 29, behindRadii: 1, sideRadii: 1.1 },
        dust: { color: 0x94a3b8, alpha: 0.45, chance: 0.35, lifeMs: 500, radiusStart: 7, radiusGrow: 14, behindRadii: 0.8, sideRadii: 0.5 },
    },
    // Not an activation visual: the pulse after the snap-back follows the bot's rewindPulseMs field.
    temporalRewindZone: {
        pulse: {
            timerField: "rewindPulseMs", durationMs: 400,
            asset: "temporalRewind", slot: "rewind-pulse", tint: 0xcffafe, width: 110, height: 110,
        },
    },
    dash: { smokeMs: 500, smokeFrameMs: 100 },
    // Lunge (approved card): the crouch rings and chevrons, then the leap's afterimages.
    // The stab is the attached entity's phase visual (ENTITY_VISUAL_SETTINGS.lungeStab). crouchMs matches the crouch phase.
    lunge: {
        visualPriority: 23, crouchMs: 200, leapMs: 100, leapUnits: 150,
        color: 0xf87171, ringRadius: 38, ringSquash: 8,
        chevrons: 3, chevronStart: 40, chevronSpacing: 16, chevronDepth: 10, chevronHalf: 12, chevronWidth: 3,
        afterimages: 3, botRadius: 30,
    },
    // Shotgun Blast (approved card): the muzzle blast on the activation tick. Pellets are the entity visual `pellet`.
    shotgunBlast: {
        visualPriority: 24, color: 0xfbbf24, flash: 0xfff7d6, range: 180, arc: 40, muzzle: 34,
    },
    // Execute (approved card): the strike blade. Its length and width come from the activation hitbox. The below-30%
    // bonus flourish is not drawn: the renderer cannot read the resolved hit.
    execute: {
        visualPriority: 25, color: 0xdc2626, light: 0xfca5a5,
    },
    // Overdrive (approved card): a status aura, no activation visual. durationMs is the applied status's length, read
    // only to scale the shrinking arc; the status's remaining time is the real clock.
    overdrive: {
        color: 0x34d399, bright: 0xa7f3d0, durationMs: 2500, ringRadius: 40, segments: 8, ringTurnsPerSecond: 0.8,
    },
    // Parry (approved card): the stance while the parry status runs, then a burst where an attack was blocked.
    parry: {
        color: 0xfef3c7, edge: 0xfacc15, radius: 46, arc: 120, width: 6, flickerPeriodMs: 70,
        burstSpikes: 10, burstLength: 34, durationMs: 300, burstMs: 350,
    },
    // Overcharge (approved card): the charges as orbiting pips, a crackle, and a pip that flies off when one is spent.
    overcharge: {
        color: 0xfacc15, glow: 0xfef08a, arc: 0xffffff, orbitRadius: 44, pipSize: 7, orbitTurnsPerSecond: 0.6,
        crackleFrom: 34, crackleTo: 64, crackleEveryMs: 80, crackleSegments: 5, crackleJitter: 9,
        durationMs: 8000, popMs: 300,
    },
    // Disruptive Beam counter-hit (approved card): a flash on the target while the stun the beam landed runs.
    // The stun is the beam's (ability 30); stunMs is that stun's length in the shared data.
    counterHit: {
        color: 0x22d3ee, core: 0xecfeff, radius: 36, points: 18, jitter: 9, flickerMs: 50, sparks: 8,
        sourceAbilityId: 30, stunMs: 1000, windowMs: 400,
    },
    // Tether Link (approved card): the chain from the caster to the tethered bot, slack, or taut past the leash.
    tetherChain: {
        slack: 0x94a3b8, taut: 0xef4444, leash: 200, linkSpacing: 13, linkRadius: 4.5, sag: 38, pullChevrons: 2,
    },
};

/**
 * Settings for the procedural entity renderers (renderers/entityRenderers.js), keyed by a phase visual type. These are
 * phase visuals, not bot visuals, so they stay out of the bot precedence list. Orbital Strike: a ground marker, then one
 * blast (approved card).
 */
export const ENTITY_VISUAL_SETTINGS = Object.freeze({
    orbitalMarker: freezeDefinition({ color: 0x93c5fd, core: 0xffffff, warn: 0x60a5fa, radius: 140, brackets: 4 }),
    orbitalBlast: freezeDefinition({ color: 0x93c5fd, core: 0xffffff, warn: 0x60a5fa, radius: 140, spikes: 12, seed: 22 }),
    // Shotgun Blast pellet (flying): a tracer and a bright head.
    pellet: freezeDefinition({ color: 0xfbbf24, flash: 0xfff7d6, tracer: 22, pelletRadius: 3 }),
    // Lunge stab (attached): the blade and blood. Its length and width come from the phase hitbox.
    lungeStab: freezeDefinition({ color: 0xf87171, blood: 0xb91c1c, extendFraction: 0.3, holdFraction: 0.45, droplets: 5, seed: 38, botRadius: 30 }),
    // Tar Pit: the thrown glob (landing) and the pool. The pool's radius comes from its phase hitbox.
    tarGlob: freezeDefinition({ pool: 0x1c1917, edge: 0x92400e, bubble: 0xa8a29e, globRadius: 14, arcHeight: 60 }),
    tarPit: freezeDefinition({ pool: 0x1c1917, edge: 0x92400e, bubble: 0xa8a29e, lobes: 16, seed: 43, wobble: 3, bubbles: 7, bubbleMinMs: 900, bubbleSpanMs: 700 }),
    // Boomerang (out and back, one visual for both phases): a spinning crescent, returnColor once it turns back.
    boomerang: freezeDefinition({
        color: 0xf59e0b, returnColor: 0xfde68a, armLength: 16, armWidth: 6, spinTurnsPerSecond: 3, trailDots: 5, trailSpacing: 12,
    }),
    // Fan of Blades (one visual for both legs): a spinning three-point blade with a ghost trail.
    blade: freezeDefinition({
        fill: 0xe2e8f0, edge: 0x22d3ee, outer: 13, inner: 4, points: 3, spinTurnsPerSecond: 4, ghosts: 2, ghostSpacing: 10,
    }),
    // Phase Strike's Backstab (attached): the sweep in the wait phase, the from-behind flash in the stab phase.
    backstab: freezeDefinition({ color: 0xc4b5fd, bonus: 0xf5f3ff, radius: 44, sweep: 70, width: 5, sparks: 6, seed: 25 }),
    // Tether Link's bolt (flying): a head with a slack trail behind it.
    tetherLink: freezeDefinition({ slack: 0x94a3b8, head: 0xe2e8f0, trail: 36, linkRadius: 4.5 }),
});

export const BOT_ABILITY_VISUAL_SETTINGS = Object.freeze(Object.fromEntries(
    Object.entries(settingsByType).map(([type, settings]) => [type, freezeDefinition(settings)]),
));

const abilityIdByType = new Map();
for (const id of Object.keys(ABILITIES).map(Number)) {
    const type = activationView(id)?.visual?.type;
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
