const noEffect = Object.freeze({ type: "none" });

function freezeDefinition(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeDefinition);
        Object.freeze(value);
    }
    return value;
}

const definitions = {
    // `visualPriority` preserves the existing activeBotVisual precedence.
    1: { role: "melee", visualPriority: 0, bodyEffect: { type: "meleeSwing", activeMsFallback: 400 }, activeEffect: noEffect },
    3: { role: "gun", visualPriority: 1, directEffect: { type: "gunRay" }, activeEffect: { type: "abilityRay", height: 14, muzzleFlash: true } },
    5: { role: "ability-5", visualPriority: 2, activeEffect: noEffect },
    6: { role: "stun", visualPriority: 3, directEffect: { type: "stun" }, activeEffect: noEffect },
    20: { role: "lock-on", visualPriority: 4, marker: { type: "lockOn" }, activeEffect: noEffect },
    7: { role: "heavy-slash", visualPriority: 5, activeEffect: { type: "heavySlash", sizingHitboxAbilityId: 1 } },
    18: { role: "ability-18", visualPriority: 6, activeEffect: noEffect },
    12: { role: "pistol", visualPriority: 7, activeEffect: { type: "abilityRay", height: 14, muzzleFlash: true } },
    9: { role: "concussive-shot", visualPriority: 8, activeEffect: { type: "abilityRay", height: 76, muzzleFlash: true } },
    13: { role: "rail-shot", visualPriority: 9, activeEffect: { type: "abilityRay", height: 100, muzzleFlash: true } },
    8: { role: "repulsor", visualPriority: 10, visualClock: "repulsorBurst", activeEffect: { type: "repulsorBurst" } },
    10: { role: "basic-heal", visualPriority: 11, onVisualStart: { type: "repairPulse" }, activeEffect: noEffect },
    16: { role: "absolute-guard", visualPriority: 12, selfGuardFlash: true, activeEffect: { type: "shield", tint: 0xfbbf24 } },
    23: { role: "reactive-armor", visualPriority: 13, selfGuardFlash: true, activeEffect: { type: "shield", tint: 0xe2e8f0 } },
    25: { role: "phase-strike", visualPriority: 14, onVisualStart: { type: "burst", color: 0xc4b5fd, count: 12 }, activeEffect: { type: "phaseStrike" } },
    26: { role: "frost-ring", visualPriority: 15, activeEffect: { type: "frostRing" } },
    30: { role: "temporal-ray", visualPriority: 16, activeEffect: { type: "proceduralRay", color: 0x22d3ee, fallbackRange: 500, fallbackWidth: 5, muzzleFlash: true } },
    32: { role: "null-ray", visualPriority: 17, activeEffect: { type: "proceduralRay", color: 0xef4444, fallbackRange: 500, fallbackWidth: 5, muzzleFlash: true } },
    33: { role: "temporal-anchor", visualPriority: 18, activeEffect: { type: "temporalAnchor", periodMs: 100, pulse: 0.18 } },
    34: { role: "dash-strike", visualPriority: 19, activeEffect: { type: "proceduralRay", color: 0xf8fafc, fallbackRange: 80, fallbackWidth: 6 } },
    21: { role: "temporal-rewind", shapeEffect: { type: "temporalRewindPulse", timerField: "temporalRewindPulseMs", durationMs: 400, xField: "temporalRewindVisualX", fallbackXField: "temporalRewindX", yField: "temporalRewindVisualY", fallbackYField: "temporalRewindY", asset: "temporalRewind", slot: "rewind-pulse", tint: 0xcffafe, width: 110, height: 110 } },
    19: { role: "dash", transitionEffect: "dashSmoke" },
};

export const BOT_ABILITY_PRESENTATION_DEFINITIONS = Object.freeze(Object.fromEntries(
    Object.entries(definitions).map(([id, definition]) => [Number(id), freezeDefinition({ id: Number(id), ...definition })]),
));

export const BOT_ABILITY_VISUAL_PRIORITY = Object.freeze(Object.values(BOT_ABILITY_PRESENTATION_DEFINITIONS)
    .filter((definition) => definition.visualPriority != null)
    .sort((left, right) => left.visualPriority - right.visualPriority)
    .map((definition) => definition.id));

const definitionsByRole = Object.freeze(Object.fromEntries(
    Object.values(BOT_ABILITY_PRESENTATION_DEFINITIONS).map((definition) => [definition.role, definition]),
));

export function botAbilityPresentationForId(abilityId) {
    const normalizedId = Number(abilityId);
    return Number.isInteger(normalizedId)
        ? BOT_ABILITY_PRESENTATION_DEFINITIONS[normalizedId] ?? null
        : null;
}

export function botAbilityPresentationForRole(role) {
    return definitionsByRole[role] ?? null;
}

export function botAbilityActiveMs(shape, definition) {
    return Number(shape?.abilityActiveMs?.[definition?.id] ?? 0);
}
