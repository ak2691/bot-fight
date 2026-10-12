import { GAMEPLAY_DATA } from "./gameplayData.js";
import { validateGameplayData } from "./gameplayValidation.js";
import { MODIFIER_STATS, STATUS_EFFECT_APPLICATIONS } from "./vocabulary.js";

let PRESETS = GAMEPLAY_DATA.statuses.statuses;

/** The shipped preset with this name, or null. Status effects read presets through here, so a test can add some. */
export function statusPreset(subtype) {
    return PRESETS[subtype] ?? null;
}

/**
 * Runs `fn` with extra status presets in place (written in the statuses.json schema); a name already used replaces the
 * shipped preset. The merged data goes through the same validation as the shared files. For tests.
 */
export function withTestStatuses(extraPresets, fn) {
    const merged = {
        ...GAMEPLAY_DATA,
        statuses: { ...GAMEPLAY_DATA.statuses, statuses: { ...GAMEPLAY_DATA.statuses.statuses, ...extraPresets } },
    };
    validateGameplayData({ abilities: GAMEPLAY_DATA.abilities, statuses: merged.statuses, movement: GAMEPLAY_DATA.movement, channels: GAMEPLAY_DATA.channels });
    const previous = PRESETS;
    PRESETS = merged.statuses.statuses;
    try {
        return fn();
    } finally {
        PRESETS = previous;
    }
}

/** The effects a status preset applies, in order (empty for an unknown subtype). */
export function presetEffects(subtype) {
    return PRESETS[subtype]?.effects ?? [];
}

/** True when a preset stops the bot (or the summon) from executing an interrupt-style cast. */
export function presetInterrupts(subtype) {
    return PRESETS[subtype]?.interrupts === true;
}

/**
 * The numbers a status preset gives a player, as { kind, value } in preset order, where value is a fraction:
 * damage reduction (an incomingDamage modifier below 1), damage immunity and cooldown recovery
 * (a cooldown modifier below 1). Hostile presets (bleed's incoming increase, stun, slow) give none.
 */
export function positiveStatusEffects(subtype) {
    // A reaction that damages the attacker by a multiple of the hit is damage reflection (after the preset's own effects).
    const hit = PRESETS[subtype]?.on?.hit;
    const reflected = hit?.target === "attacker"
        ? (hit.effects ?? []).filter((entry) => entry.type === STATUS_EFFECT_APPLICATIONS.DAMAGE && entry.multiplier != null)
            .map((entry) => ({ kind: "damage_reflection", value: Number(entry.multiplier) }))
        : [];
    return [...presetEffects(subtype).flatMap((entry) => {
        if (entry.type === STATUS_EFFECT_APPLICATIONS.MODIFIER && entry.stat === MODIFIER_STATS.INCOMING_DAMAGE
            && Number(entry.multiply) < 1) {
            return [{ kind: "damage_reduction", value: 1 - Number(entry.multiply) }];
        }
        if (entry.type === STATUS_EFFECT_APPLICATIONS.DAMAGE_IMMUNITY) {
            return [{ kind: "damage_immunity", value: Number(entry.amount) }];
        }
        if (entry.type === STATUS_EFFECT_APPLICATIONS.MODIFIER && entry.stat === MODIFIER_STATS.COOLDOWN) {
            return [{ kind: "cooldown_recovery", value: 1 - Number(entry.multiply) }];
        }
        return [];
    }), ...reflected];
}
