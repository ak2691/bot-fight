import { tickAbilityEntityWorld as tickAbilityEntityWorldInPlace } from "../../../../shared/engine/ecs/abilities/AbilityEntitySystem.js";
import { dealDamage as dealDamageInPlace, settleHealing as settleHealingInPlace } from "../../../../shared/engine/ecs/abilities/effects.js";
import { resolveActivationVerbsForRoster as resolveActivationVerbsInPlace } from "../../../../shared/engine/ecs/abilities/verbs.js";
import { applyBotAction as applyBotActionInPlace } from "../../../../shared/engine/ecs/bots/ActionExecutionSystem.js";
import { tickBotLifecycle as tickBotLifecycleInPlace } from "../../../../shared/engine/ecs/bots/BotLifecycleSystem.js";
import { tickBotResources as tickBotResourcesInPlace } from "../../../../shared/engine/ecs/bots/BotResourceSystem.js";
import { tickBotState as tickBotStateInPlace } from "../../../../shared/engine/ecs/bots/BotStateSystem.js";
import { tickStatuses as tickStatusesInPlace } from "../../../../shared/engine/ecs/bots/BotStatusSystem.js";

/**
 * Test helpers: the engine's mutators and systems change their bots and entities in place; these run the same
 * functions on copies and return the changed copy, so a test can keep the state before a step and compare it
 * with the state after. Nested values are never edited in place, so a shallow copy is a full copy.
 */
const copy = (shape) => (shape ? { ...shape } : shape);

export const applyBotAction = (bot, action, elapsedMs) => applyBotActionInPlace(copy(bot), action, elapsedMs);
export const tickBotState = (bot, elapsedMs, justActivated) => tickBotStateInPlace(copy(bot), elapsedMs, justActivated);
export const tickStatuses = (shape, elapsedMs) => tickStatusesInPlace(copy(shape), elapsedMs);
export const tickBotResources = (bot, elapsedMs, justActivated) => tickBotResourcesInPlace(copy(bot), elapsedMs, justActivated);
export const tickBotLifecycle = (bot, elapsedMs) => tickBotLifecycleInPlace(copy(bot), elapsedMs);
export const dealDamage = (target, amount, source, options) => dealDamageInPlace(copy(target), amount, source, options);
export const settleHealing = (target) => settleHealingInPlace(copy(target));

/**
 * The resolveHits stage for a roster of bots and their entities; returns the changed copies in the same order, and the
 * impact queue the hits filled (pass it to tickAbilityEntityWorld as `impacts` so the queued hits land).
 */
export const resolveActivationVerbsForWorld = (bots, entities = [], impacts = new Map()) => {
    const roster = bots.map(copy);
    const shapes = entities.map(copy);
    resolveActivationVerbsInPlace(roster, shapes, impacts);
    return { bots: roster, entities: shapes, impacts };
};

/** The resolveHits stage for a roster of bots; returns the changed copies in the same order. */
export const resolveActivationVerbsForRoster = (bots, entities = []) => resolveActivationVerbsForWorld(bots, entities).bots;

/** One entity-world tick on copies of the world's bots and entities. */
export const tickAbilityEntityWorld = (world) => tickAbilityEntityWorldInPlace({
    ...world,
    bots: world.bots.map(copy),
    entities: world.entities.map(copy),
});

/** Resolves the activation verbs of one or two bots against each other; a missing second bot is null. */
export function resolveTriggeredAbilityCombat(first, second) {
    const roster = resolveActivationVerbsForRoster(second ? [first, second] : [first]);
    return [roster[0] ?? null, second ? roster[1] ?? null : null];
}
