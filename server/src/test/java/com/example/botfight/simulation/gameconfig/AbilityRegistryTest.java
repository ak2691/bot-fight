package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import java.util.HashSet;
import java.util.List;
import org.junit.jupiter.api.Test;

class AbilityRegistryTest {
    @Test void permanentIdsArePositiveUniqueAndMatchDefinitions() {
        assertThat(AbilityRegistry.all()).hasSize(36);
        assertThat(AbilityRegistry.all().keySet()).allMatch(id -> id > 0);
        assertThat(new HashSet<>(AbilityRegistry.all().values())).hasSize(36);
        assertThat(Abilities.CATALOG.keySet()).containsExactlyInAnyOrderElementsOf(AbilityRegistry.all().keySet());
        assertThat(AbilityContracts.all().keySet()).containsExactlyInAnyOrderElementsOf(AbilityRegistry.all().keySet());
        assertThat(AbilityContracts.all()).hasSize(36);
        assertThat(AbilityContracts.entityAll()).hasSize(14);
        assertThat(AbilityContracts.all().values()).allSatisfy(contract -> {
            assertThat(contract.activation()).isNotNull();
            assertThat(contract.onTrigger()).isNotEmpty();
            contract.entities().values().forEach(entity -> assertThat(entity.phases()).isNotEmpty());
        });
        AbilityContracts.entityAll().forEach((abilityId, entity) ->
                assertThat(AbilityContracts.get(abilityId).onTrigger()).anySatisfy(verb ->
                        assertThat(verb).isInstanceOfSatisfying(AbilityContracts.SpawnVerb.class,
                                spawn -> assertThat(spawn.entity()).isEqualTo(entity.entityType()))));
        assertThat(AbilityContracts.entityContractForAbility(15).phases().getFirst()
                .on().get(AbilityContracts.PhaseEventType.COLLISION).targets())
                .containsExactly(AbilityContracts.TargetKind.BOT, AbilityContracts.TargetKind.SUMMON);
        assertThat(AbilityContracts.entityContractForAbility(11).phases().get(1).trigger())
                .satisfies(trigger -> {
                    assertThat(trigger.botContact()).isTrue();
                    assertThat(trigger.attackHits()).isFalse();
                    assertThat(trigger.projectileOverlap()).isFalse();
                    assertThat(trigger.chain()).isFalse();
                });
    }

    @Test void lookupUsesPermanentMapKeyAndDoesNotDependOnPosition() {
        assertThat(AbilityRegistry.all().keySet()).doesNotContain(0);
        assertThat(AbilityRegistry.all().keySet()).doesNotContain(2);
        assertThat(AbilityRegistry.all().get(32)).isEqualTo("vampiric_beam");
        assertThat(AbilityRegistry.all()).containsEntry(8, "repelling_blast");
        assertThat(AbilityRegistry.all()).containsEntry(21, "rewind");
        assertThat(AbilityRegistry.all()).containsEntry(29, "snare_bomb");
    }

    @Test void eventVisualsAreExplicitAndAlwaysEmitSeparatelyFromPhaseVisuals() {
        AbilityContracts.all().values().forEach(contract -> contract.entities().values().forEach(entity ->
                entity.phases().forEach(phase -> phase.on().values().forEach(event ->
                        event.verbs().stream().filter(AbilityContracts.EmitVisualVerb.class::isInstance)
                                .map(AbilityContracts.EmitVisualVerb.class::cast).forEach(emit -> {
                                    assertThat(emit.visualType()).isNotNull();
                                    assertThat(emit.visibleMs()).isPositive();
                                })))));

        for (int abilityId : List.of(4, 11, 14, 27, 29)) {
            AbilityContracts.EntityContract entity = AbilityContracts.entityAll().get(abilityId);
            AbilityContracts.AbilityPhase explosionPhase = entity.phases().stream()
                    .filter(phase -> phase.id().equals(abilityId == 29 ? "destroyed" : "active"))
                    .findFirst().orElseThrow();
            assertThat(explosionPhase.visual()).isNull();
        }

        AbilityContracts.HitVerb droneShot = AbilityContracts.entityAll().get(17).phases().getFirst().scheduledHit();
        assertThat(droneShot.visual().type()).isEqualTo("gun");
        assertThat(droneShot.visual().visibleMs()).isEqualTo(300);
        assertThat(droneShot.visual().visualSize()).isEqualTo(16.0);
        assertThat(droneShot.aim()).isEqualTo("seekTarget");
    }

    @Test void invalidPermanentIdsFailClosed() {
        assertThatThrownBy(() -> AbilityRegistry.requireId(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(-1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(38)).isInstanceOf(IllegalArgumentException.class);
    }
}
