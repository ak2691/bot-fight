import { tickBotLifecycle } from "./BotLifecycleSystem.js";
import { tickBotResources } from "./BotResourceSystem.js";
import { tickStatuses } from "./BotStatusSystem.js";

/** Runs the bot-owned systems in their deterministic per-action order, changing the bot in place. */
export function tickBotState(shape, elapsedMs, justActivatedAbilityIds = null, bots = []) {
    tickBotResources(shape, elapsedMs, justActivatedAbilityIds);
    tickStatuses(shape, elapsedMs, bots);
    return tickBotLifecycle(shape, elapsedMs);
}
