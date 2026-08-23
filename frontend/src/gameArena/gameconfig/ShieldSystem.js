/**
 * Resolves the defensive interaction hook for an ability hit.
 *
 * Duel-v1 currently has no blocking abilities. Keeping this boundary explicit
 * lets future defensive abilities add behavior without allowing stale Block
 * state or legacy contracts to suppress effects in the current ruleset.
 */
export function resolveShieldInteraction(bot) {
    return { bot, blocked: false, preventedEffects: new Set() };
}
