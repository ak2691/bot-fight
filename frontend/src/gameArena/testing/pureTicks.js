import { tickAbilityEntityWorld as tickAbilityEntityWorldInPlace } from "../../../../shared/engine/ecs/abilities/AbilityEntitySystem.js";
import { dealDamage as dealDamageInPlace, settleHealing as settleHealingInPlace } from "../../../../shared/engine/ecs/abilities/effects.js";
import { resolveTriggerVerbsForRoster as resolveTriggerVerbsInPlace } from "../../../../shared/engine/ecs/abilities/verbs.js";
import { applyBotAction as applyBotActionInPlace } from "../../../../shared/engine/ecs/bots/ActionExecutionSystem.js";
import { tickBotLifecycle as tickBotLifecycleInPlace } from "../../../../shared/engine/ecs/bots/BotLifecycleSystem.js";
import { tickBotResources as tickBotResourcesInPlace } from "../../../../shared/engine/ecs/bots/BotResourceSystem.js";
import { tickBotState as tickBotStateInPlace } from "../../../../shared/engine/ecs/bots/BotStateSystem.js";
import { tickBotStatus as tickBotStatusInPlace } from "../../../../shared/engine/ecs/bots/BotStatusSystem.js";
import { tickDeferredStates as tickDeferredStatesInPlace } from "../../../../shared/engine/ecs/bots/DeferredStateSystem.js";

/**
 * Test helpers: the engine's mutators and systems change their bots and entities in place; these run the same
 * functions on copies and return the changed copy, so a test can keep the state before a step and compare it
 * with the state after. Nested values are never edited in place, so a shallow copy is a full copy.
 */
const copy = (shape) => (shape ? { ...shape } : shape);

export const applyBotAction = (bot, action, elapsedMs) => applyBotActionInPlace(copy(bot), action, elapsedMs);
export const tickBotState = (bot, elapsedMs, justActivated) => tickBotStateInPlace(copy(bot), elapsedMs, justActivated);
export const tickBotStatus = (bot, elapsedMs) => tickBotStatusInPlace(copy(bot), elapsedMs);
export const tickBotResources = (bot, elapsedMs, justActivated) => tickBotResourcesInPlace(copy(bot), elapsedMs, justActivated);
export const tickBotLifecycle = (bot, elapsedMs) => tickBotLifecycleInPlace(copy(bot), elapsedMs);
export const tickDeferredStates = (bot, elapsedMs) => tickDeferredStatesInPlace(copy(bot), elapsedMs);
export const dealDamage = (target, amount, source, options) => dealDamageInPlace(copy(target), amount, source, options);
export const settleHealing = (target) => settleHealingInPlace(copy(target));

/** The resolveHits stage for a roster of bots; returns the changed copies in the same order. */
export const resolveTriggerVerbsForRoster = (bots) => {
    const roster = bots.map(copy);
    resolveTriggerVerbsInPlace(roster);
    return roster;
};

/** One entity-world tick on copies of the world's bots and entities. */
export const tickAbilityEntityWorld = (world) => tickAbilityEntityWorldInPlace({
    ...world,
    bots: world.bots.map(copy),
    entities: world.entities.map(copy),
});

/** Resolves the trigger verbs of one or two bots against each other; a missing second bot is null. */
export function resolveTriggeredAbilityCombat(first, second) {
    const roster = resolveTriggerVerbsForRoster(second ? [first, second] : [first]);
    return [roster[0] ?? null, second ? roster[1] ?? null : null];
}
