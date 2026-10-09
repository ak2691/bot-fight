import {
    eventTargetsKind,
    eventVerbs,
    TARGET_KINDS,
} from "../contracts/AbilityContracts.js";
import { entityEffectStats } from "./effects.js";
import { entityContract, phaseForEntity } from "../contracts/AbilityContracts.js";
import { canApplyToTarget, executeVerb, transitionEntityPhase } from "./verbs.js";

export { canApplyToTarget, transitionEntityPhase };

/**
 * Dispatches a contract event to one entity by running the event's `do` verbs through the verb executor.
 *
 * Collision detection deliberately stays outside this module. A detector supplies stable target IDs and the
 * verbs turn those IDs into the allowlisted payload changes declared by the current phase. That keeps
 * geometry, lifecycle transitions, and bot-payload mutation independent and makes two copies of the same
 * entity maintain independent hit ledgers.
 *
 * The entity and the bots change in place. Returns { entity, bots, emittedVisuals, spawned, hitConnected }:
 * `entity` is the same entity, or null when the event removed it. `spawned` lists entities that a `spawn` verb
 * of the event created; the caller adds them to the world.
 */
export function dispatchEntityEvent(entity, eventType, {
    bots = [],
    world = {},
    phase = phaseForEntity(entity),
    contract = null,
    targetIds = [],
    targetDistances = null,
    effectSources = null,
    collisionDistance = undefined,
    seekTargetId = null,
} = {}) {
    const handler = phase?.on?.[eventType];
    if (!handler) return { entity, bots, emittedVisuals: [], spawned: [], hitConnected: false };

    const run = {
        kind: "entity",
        entity,
        bots,
        world,
        phase,
        event: handler,
        eventType,
        contract: contract ?? entityContract(entity),
        targets: normalizeTargetIds(targetIds),
        targetDistances,
        effectSources,
        collisionDistance,
        seekTargetId,
        entityStats: entityEffectStats(phase),
        eventReachesBots: eventTargetsKind(handler, TARGET_KINDS.BOT),
        emittedVisuals: [],
        spawned: [],
        hitConnected: false,
    };
    for (const verb of eventVerbs(handler)) {
        executeVerb(verb, run);
        if (!run.entity) break;
    }
    return {
        entity: run.entity,
        bots: run.bots,
        emittedVisuals: run.emittedVisuals,
        spawned: run.spawned,
        hitConnected: run.hitConnected,
    };
}

function normalizeTargetIds(targetIds) {
    return [...new Set((Array.isArray(targetIds) ? targetIds : [targetIds])
        .filter((targetId) => targetId != null)
        .map((targetId) => typeof targetId === "object" ? targetId.id ?? targetId.slot : targetId))];
}
