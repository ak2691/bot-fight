import { tickDeferredStates } from "./DeferredStateSystem.js";
import { tickBotLifecycle } from "./BotLifecycleSystem.js";
import { tickBotResources } from "./BotResourceSystem.js";
import { tickBotStatus } from "./BotStatusSystem.js";

/** Runs the bot-owned systems in their deterministic per-action order, changing the bot in place. */
export function tickBotState(shape, elapsedMs, justActivatedAbilityIds = null) {
    tickBotResources(shape, elapsedMs, justActivatedAbilityIds);
    tickBotStatus(shape, elapsedMs);
    if (Number(shape.hp ?? 0) > 0) tickDeferredStates(shape, elapsedMs);
    return tickBotLifecycle(shape, elapsedMs);
}
