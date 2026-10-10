import { ACTION_TO_ABILITY } from "../../loadout/BotLoadout.js";
import { abilityContract, hitVerbs } from "../contracts/AbilityContracts.js";
import { abilityPose } from "../../gameconfig/hitboxGeometry.js";
import { isEntityShape } from "../entities/EntityCombat.js";
import { hitsTarget, TARGET_KIND_BOT, TARGET_KIND_ENTITY } from "./findTargets.js";

/**
 * The trigger-time pose of a `hit` verb: the verb's origin on the owner, or the pose the ability captured
 * when it triggered (so a later move or teleport cannot shift the hitbox).
 */
export function triggerPose(bot, verb, activation) {
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

/** True when one `hit` verb, fired from the attacker's trigger pose, touches the target. */
export function verbHitsTarget(attacker, verb, target, activation) {
    const hitbox = verbHitbox(verb.hitbox ?? {}, attacker);
    if (!hitbox) return false;
    return hitsTarget(triggerPose(attacker, verb, activation), hitbox, target, {
        kinds: [isEntityShape(target) ? TARGET_KIND_ENTITY : TARGET_KIND_BOT],
    });
}

/** Resolves trigger `hit` geometry (through findTargets) without applying the resulting effects. */
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
