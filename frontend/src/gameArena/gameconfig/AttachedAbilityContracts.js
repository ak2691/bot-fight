const ATTACHED_PHASE_TYPE = "botAttached";

const HITBOXES = Object.freeze({
    1: { shape: "arc", range: "range", arc: "arc" },
    3: { shape: "ray", range: "range", width: "hitboxWidth" },
    6: { shape: "rectangle", length: "range", width: "hitboxWidth" },
    7: { shape: "arc", range: "range", arc: "arc" },
    8: { shape: "circle", radius: "radius" },
    9: { shape: "ray", range: "range", width: "hitboxWidth" },
    12: { shape: "ray", range: "range", width: "hitboxWidth" },
    13: { shape: "ray", range: "range", width: "hitboxWidth" },
    25: { shape: "rectangle", length: "range", width: "hitboxWidth" },
    26: { shape: "circle", radius: "radius" },
    30: { shape: "ray", range: "range", width: "hitboxWidth" },
    32: { shape: "ray", range: "range", width: "hitboxWidth" },
    34: { shape: "arc", range: "range", arc: "arc" },
});

/** Phases hosted by a bot rather than by an independently selectable entity. */
export function attachedAbilityPhases(abilityId, effects) {
    const hitbox = HITBOXES[Number(abilityId)];
    if (!hitbox) return null;
    return Object.freeze([Object.freeze({
        id: "active",
        type: ATTACHED_PHASE_TYPE,
        attachment: Object.freeze({ mode: "owner" }),
        hitbox: Object.freeze({ ...hitbox }),
        effects: Object.freeze([...effects]),
        visual: Object.freeze({ source: "ability" }),
        events: Object.freeze({
            collision: Object.freeze({ actions: Object.freeze(["applyEffects"]) }),
        }),
    })]);
}

export function attachedAbilityHitbox(abilityId) {
    return HITBOXES[Number(abilityId)] ?? null;
}
