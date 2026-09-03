const STATUS_CATEGORY = "Status";
const COMBAT_CATEGORY = "Combat";

const guideEntry = (values) => Object.freeze(values);

/**
 * Player-facing effect glossary. Status is reserved for effects that remain
 * active on a bot; combat covers direct, reactive, and one-shot interactions.
 */
export const EFFECT_GUIDE = Object.freeze([
    guideEntry({
        id: "burn",
        label: "Burn",
        category: STATUS_CATEGORY,
        description: "Deals 2 damage every second for 5 seconds.",
    }),
    guideEntry({
        id: "bleed",
        label: "Bleed",
        category: STATUS_CATEGORY,
        description: "Deals 2 damage every second for 5 seconds. While active, incoming damage increases by 25%, except for Bleed's own damage.",
    }),
    guideEntry({
        id: "stun",
        label: "Stun",
        category: STATUS_CATEGORY,
        description: "Stops movement and normal ability execution while active.",
    }),
    guideEntry({
        id: "slow",
        label: "Slow",
        category: STATUS_CATEGORY,
        description: "Reduces movement and rotation speed to 50% while active.",
    }),
    guideEntry({
        id: "shock",
        label: "Shock",
        category: STATUS_CATEGORY,
        description: "Deals 3 damage and briefly locks movement once per second for 3 seconds.",
    }),
    guideEntry({
        id: "silence",
        label: "Silence",
        category: STATUS_CATEGORY,
        description: "Prevents abilities from starting and can cancel a preparing ability without resetting its cooldown.",
    }),
    guideEntry({
        id: "damage_reduction",
        label: "Damage Reduction",
        category: STATUS_CATEGORY,
        description: "Reduces incoming hostile damage by 50% while active.",
    }),
    guideEntry({
        id: "damage_immunity",
        label: "Damage Immunity",
        category: STATUS_CATEGORY,
        description: "Prevents hostile damage and status effects while active.",
    }),
    guideEntry({
        id: "overclock",
        label: "Overclock",
        category: STATUS_CATEGORY,
        description: "Reduces cooldown and reload time for abilities activated while active. Existing timers are unchanged.",
    }),
    guideEntry({
        id: "damage",
        label: "Damage",
        category: COMBAT_CATEGORY,
        description: "This is self-explanatory.",
    }),
    guideEntry({
        id: "healing",
        label: "Healing",
        category: COMBAT_CATEGORY,
        description: "Restores HP to the recipient",
    }),
    guideEntry({
        id: "knockback",
        label: "Knockback",
        category: COMBAT_CATEGORY,
        description: "Pushes the target away from the source.",
    }),
    guideEntry({
        id: "pull",
        label: "Pull",
        category: COMBAT_CATEGORY,
        description: "Draws the target toward the source.",
    }),
    guideEntry({
        id: "interrupt",
        label: "Interrupt",
        category: COMBAT_CATEGORY,
        description: "Cancels a preparing or active ability, then starts that ability's cooldown or reload. It also briefly stuns the target.",
    }),
    guideEntry({
        id: "damage_reflection",
        label: "Damage Reflection",
        category: COMBAT_CATEGORY,
        description: "Reflects 50% of incoming hostile damage back to its source while active.",
    }),
    guideEntry({
        id: "hit-stagger",
        label: "Hit Stagger",
        category: COMBAT_CATEGORY,
        description: "Successful hostile damage briefly reduces movement and rotation speed to 85%.",
    }),
    guideEntry({
        id: "movement",
        label: "Movement",
        category: COMBAT_CATEGORY,
        description: "Moves the caster through the arena over some distance.",
    }),
    guideEntry({
        id: "teleport",
        label: "Teleport",
        category: COMBAT_CATEGORY,
        description: "Moves the caster instantly to a new position.",
    }),
    guideEntry({
        id: "restore_state",
        label: "Restore State",
        category: COMBAT_CATEGORY,
        description: "Returns the caster to a previously captured tick.",
    }),
]);

// Kept as an alias for condition/catalogue consumers that still use the
// original name while the visible section now covers all player-facing effects.
export const STATUS_EFFECT_GUIDE = EFFECT_GUIDE;
