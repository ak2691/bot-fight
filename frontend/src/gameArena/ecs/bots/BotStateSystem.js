import { tickDeferredStates } from "./DeferredStateSystem.js";
import { tickBotLifecycle } from "./BotLifecycleSystem.js";
import { tickBotResources } from "./BotResourceSystem.js";
import { tickBotStatus } from "./BotStatusSystem.js";

/** Runs the bot-owned systems in their deterministic per-action order. */
export function tickBotState(shape, elapsedMs, applyDamage) {
    const resourced = tickBotResources(shape, elapsedMs);
    const statused = tickBotStatus(resourced, elapsedMs, applyDamage);
    const deferred = Number(statused.hp ?? 0) > 0
        ? tickDeferredStates(statused, elapsedMs)
        : statused;
    return tickBotLifecycle(deferred, elapsedMs);
}
