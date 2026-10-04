package com.example.botfight.simulation.gameconfig;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.AbilityContract;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.AbilityPhase;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Hitbox;
import java.util.OptionalDouble;

/**
 * Base range of an ability in arena units, derived from the real contract hitbox and mirrored by
 * the browser's {@code abilityBaseRange}: arc -> range, rectangle -> length, ray -> range,
 * projectile -> speed per tick x ticks of its first phase. Target radius is never added.
 */
public final class AbilityBaseRange {
    private static final int STEP_MS = 100;

    private AbilityBaseRange() {}

    /** Empty for abilities without a meaningful range. */
    public static OptionalDouble of(int abilityId) {
        AbilityContract attached = AbilityContracts.attachedAbilityContract(abilityId);
        AbilityPhase attachedPhase = attached == null || attached.phases().isEmpty() ? null : attached.phases().get(0);
        Hitbox hitbox = attachedPhase == null ? null : attachedPhase.hitbox();
        if (hitbox != null && hitbox.shape() != null) {
            switch (hitbox.shape()) {
                case "arc", "ray" -> { return positive(hitbox.range()); }
                case "rectangle" -> { return positive(hitbox.length()); }
                default -> { /* fall through to the projectile check */ }
            }
        }
        return projectileRange(AbilityContracts.entityContractForAbility(abilityId));
    }

    public static boolean hasRange(int abilityId) {
        return of(abilityId).isPresent();
    }

    private static OptionalDouble projectileRange(AbilityContract entity) {
        if (entity == null || entity.phases().isEmpty()) return OptionalDouble.empty();
        AbilityPhase phase = entity.phases().get(0);
        if (phase.type() != AbilityContracts.PhaseType.PROJECTILE || phase.movement() == null) {
            return OptionalDouble.empty();
        }
        int durationMs = phase.durationMs() != null ? phase.durationMs() : entity.lifetime().duration();
        double speed = phase.movement().speed();
        if (!(speed > 0) || durationMs <= 0) return OptionalDouble.empty();
        return OptionalDouble.of(speed * (durationMs / (double) STEP_MS));
    }

    private static OptionalDouble positive(Double value) {
        return value != null && Double.isFinite(value) && value > 0 ? OptionalDouble.of(value) : OptionalDouble.empty();
    }
}
