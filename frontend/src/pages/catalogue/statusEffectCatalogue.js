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
        description: "Reduces movement and rotation speed to 50% and blocks Dash and Sprint while active.",
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
        id: "overdrive",
        label: "Overdrive",
        category: STATUS_CATEGORY,
        description: "Every stamina cost is free while active, including dash, sprint, fast turns and cancelling a wind-up.",
    }),
    guideEntry({
        id: "parry",
        label: "Parry",
        category: STATUS_CATEGORY,
        description: "Blocks the next attack that damages you while active. The bot that attacked you is stunned.",
    }),
    guideEntry({
        id: "overcharge",
        label: "Overcharge",
        category: STATUS_CATEGORY,
        description: "Doubles all damage you deal while active. Each weapon hit uses up one of its charges.",
    }),
    guideEntry({
        id: "tethered",
        label: "Tethered",
        category: STATUS_CATEGORY,
        description: "Takes more damage while active. It is pulled back toward the bot that tethered it whenever it is too far away.",
    }),
    guideEntry({
        id: "damage_reduction",
        label: "Damage Reduction",
        category: STATUS_CATEGORY,
        description: "Reduces incoming damage by 50% while active.",
    }),
    guideEntry({
        id: "damage_immunity",
        label: "Damage Immunity",
        category: STATUS_CATEGORY,
        description: "Protects against damage and status effects while active.",
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
        id: "hit-stagger",
        label: "Hit Stagger",
        category: COMBAT_CATEGORY,
        description: "Any damage reduces walking speed and rotation speed to 85% for 0.3 seconds.",
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
        id: "rewind",
        label: "Rewind",
        category: COMBAT_CATEGORY,
        description: "Marks the caster's position and health. When it runs out, the caster returns to that point with that health.",
    }),
    guideEntry({
        id: "restore_state",
        label: "Restore State",
        category: COMBAT_CATEGORY,
        description: "Returns the caster to a previous tick.",
    }),
]);

