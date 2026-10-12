import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { abilityContract, hitVerbs } from "../contracts/AbilityContracts.js";
import { abilityPose } from "../../gameconfig/hitboxGeometry.js";
import { isEntityShape } from "../entities/EntityCombat.js";
import { findTargets, hitsTarget, TARGET_KIND_BOT, TARGET_KIND_ENTITY } from "./findTargets.js";

/**
 * The activation pose of a `hit` verb: the verb's origin on the owner, or the pose the ability captured
 * when it activated (so a later move or teleport cannot shift the hitbox).
 */
export function activationPose(bot, verb, activation) {
    return abilityPose(bot, verb?.origin, activation?.capture);
}

/** The verb's hitbox with every number resolved, ready for findTargets. */
export function verbHitbox(hitbox, attacker) {
    if (hitbox.shape === "ray") {
        return {
            shape: "ray",
            width: Number(hitbox.width ?? 5),
            range: Number(hitbox.range ?? 0),
        };
    }
    if (!["arc", "rectangle", "circle"].includes(hitbox.shape)) return null;
    return {
        shape: hitbox.shape,
        includeTargetRadius: Boolean(hitbox.includeTargetRadius),
        range: Number(hitbox.shape === "circle" ? hitbox.radius : hitbox.length ?? hitbox.range ?? 0),
        width: Number(hitbox.width ?? attacker.size ?? 60),
        arc: Number(hitbox.arc ?? 36),
    };
}

/** The key a targetPolicy's memory records a target under: a bot's slot, an entity's id. */
export function hitKey(target) {
    return isEntityShape(target) ? `entity:${target.id}` : String(target.slot ?? target.id);
}

/**
 * The targets a hit shape, fired from `pose`, touches among `candidates` (bots and entities), nearest first. Every
 * shape goes through findTargets, so a ray has its hitbox width. Targets already in `once` (a scope's hit set) are
 * left out, and `nearestOnly` keeps just the nearest. Returns [{ target, distance }].
 */
export function collectHitTargets(pose, hitbox, candidates, { nearestOnly = false, once = null, stepMs } = {}) {
    const open = candidates.filter((target) => !once?.has(hitKey(target)));
    const found = findTargets(pose, hitbox, {
        world: {
            bots: open.filter((target) => !isEntityShape(target)),
            entities: open.filter((target) => isEntityShape(target)),
            stepMs,
        },
        kinds: [TARGET_KIND_BOT, TARGET_KIND_ENTITY],
    });
    return nearestOnly ? found.slice(0, 1) : found;
}

/** True when one `hit` verb, fired from the attacker's activation pose, touches the target. */
export function verbHitsTarget(attacker, verb, target, activation) {
    const hitbox = verbHitbox(verb.hitbox ?? {}, attacker);
    if (!hitbox) return false;
    return hitsTarget(activationPose(attacker, verb, activation), hitbox, target, {
        kinds: [isEntityShape(target) ? TARGET_KIND_ENTITY : TARGET_KIND_BOT],
    });
}

/** Resolves activation `hit` geometry (through findTargets) without applying the resulting effects. */
export function abilityHitsTarget(
    attacker,
    target,
    abilityId = ACTION_TO_ABILITY[attacker?.triggeredAbility],
) {
    const id = typeof abilityId === "object" ? abilityId?.abilityId : abilityId;
    if (!attacker || !target || id == null || ACTION_TO_ABILITY[attacker.triggeredAbility] !== id) return false;
    const activation = abilityContract(id)?.activation;
    return hitVerbs(id).some((verb) => verbHitsTarget(attacker, verb, target, activation));
}
