package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.HitVerb;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.List;
import org.springframework.stereotype.Service;

/** Resolves the geometry of an ability's {@code hit} verbs for bots and arena entities. */
@Service
final class AbilityHitDetectionService {
    /** Whether any hit verb of the triggered ability, fired from its pose, touches the defender. */
    boolean abilityHitsTarget(Bot attacker, Bot defender, AbilityExecutionPayload payload) {
        if (attacker == null || defender == null || payload == null) return false;
        return payload.hitVerbs().stream().anyMatch(verb -> hits(attacker, defender, payload, verb));
    }

    /** Whether one hit verb, fired from the bot's captured pose, touches the defender. */
    boolean abilityHitsTarget(Bot attacker, Bot defender, AbilityExecutionPayload payload, HitVerb verb) {
        if (attacker == null || defender == null || payload == null || verb == null) return false;
        return hits(attacker, defender, payload, verb);
    }

    /** Whether one hit verb, fired from {@code pose}, touches the defender. */
    boolean abilityHitsTarget(Bot attacker, Bot defender, AbilityExecutionPayload.Pose pose, HitVerb verb) {
        if (attacker == null || defender == null || pose == null || verb == null) return false;
        return !FindTargets.findTargets(new FindTargets.Pose(pose.x(), pose.y(), pose.rotation()),
                hitbox(verb), FindTargets.Options.hitbox(null), List.of(defender)).isEmpty();
    }

    /** Whether any hit verb of the ability, fired from the bot's captured pose, reaches an arena entity. */
    boolean abilityHitsEntity(Bot attacker, ArenaEntity target, AbilityExecutionPayload payload) {
        if (attacker == null || target == null || payload == null) return false;
        return payload.hitVerbs().stream().anyMatch(verb -> hits(attacker, target, payload, verb));
    }

    /** Whether one hit verb, fired from the bot's captured pose, reaches an arena entity. */
    boolean verbHitsEntity(Bot attacker, ArenaEntity target, AbilityExecutionPayload payload, HitVerb verb) {
        return attacker != null && target != null && payload != null && hits(attacker, target, payload, verb);
    }

    private static boolean hits(Bot attacker, Object target, AbilityExecutionPayload payload, HitVerb verb) {
        AbilityExecutionPayload.Pose pose = payload.pose(attacker);
        return !FindTargets.findTargets(new FindTargets.Pose(pose.x(), pose.y(), pose.rotation()),
                hitbox(verb), FindTargets.Options.hitbox(null), List.of(target)).isEmpty();
    }

    /** The reach of the ability's first hit verb, or {@code fallback}. */
    double phaseRange(AbilityExecutionPayload payload, double fallback) {
        List<HitVerb> verbs = payload.hitVerbs();
        if (verbs.isEmpty()) return fallback;
        AbilityContracts.Hitbox hitbox = hitbox(verbs.getFirst());
        if ("circle".equals(hitbox.shape())) return numeric(hitbox.radius(), fallback);
        if ("rectangle".equals(hitbox.shape())) {
            return numeric(hitbox.length() == null ? hitbox.range() : hitbox.length(), fallback);
        }
        return numeric(hitbox.range(), fallback);
    }

    private static final AbilityContracts.Hitbox EMPTY_HITBOX =
            new AbilityContracts.Hitbox(null, null, null, null, 1.0, null, null, false);

    private static AbilityContracts.Hitbox hitbox(HitVerb verb) {
        return verb == null || verb.hitbox() == null ? EMPTY_HITBOX : verb.hitbox();
    }

    private static double numeric(Double value, double fallback) {
        return value == null || !Double.isFinite(value) ? fallback : value;
    }
}
