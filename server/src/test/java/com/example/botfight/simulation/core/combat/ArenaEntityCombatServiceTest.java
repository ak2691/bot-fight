package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import java.util.List;
import org.junit.jupiter.api.Test;

class ArenaEntityCombatServiceTest {
    @Test
    void fireballDamagesHpEntitiesButOnlyAppliesBurnToCodedSummons() {
        ArenaEntityCombatService combat = new ArenaEntityCombatService(
                new AbilityHitDetectionService());
        ArenaEntity fireball = AbilityEntityFactory.create(
                "fireball-1", 5, 2, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        ArenaEntity ordinaryHpEntity = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        ArenaEntity summon = AbilityEntityFactory.create(
                "drone-1", 17, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);

        ArenaEntity damagedSnare = combat.applyEffectsToEntity(
                ordinaryHpEntity, List.of(), List.of(ordinaryHpEntity, fireball),
                new ArenaBounds(1000, 800));
        ArenaEntity damagedSummon = combat.applyEffectsToEntity(
                summon, List.of(), List.of(summon, fireball),
                new ArenaBounds(1000, 800));

        assertThat(damagedSnare.hp()).isEqualTo(5);
        assertThat(damagedSnare.statusEffects()).noneMatch(status -> status.type().equals("burn"));
        assertThat(damagedSummon.hp()).isEqualTo(35);
        assertThat(damagedSummon.statusEffects()).anyMatch(status -> status.type().equals("burn"));
    }

    @Test
    void hpEntityReceivesDamageFromAnOverlappingProjectilePhase() {
        ArenaEntity snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        // Fireball's forward spawn offset places its rectangle at the Snare's
        // center while its movement segment sweeps away from the collision.
        ArenaEntity fireball = AbilityEntityFactory.create(
                "fireball-1", 5, 2, 100, 147, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);

        ArenaEntityCombatService combat = new ArenaEntityCombatService(
                new AbilityHitDetectionService());

        assertThat(combat.damageToEntityThisTick(snare, List.of(), List.of(snare, fireball)))
                .isEqualTo(15);
    }
}
