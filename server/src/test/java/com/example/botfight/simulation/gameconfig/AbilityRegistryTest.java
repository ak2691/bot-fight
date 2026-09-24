package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class AbilityRegistryTest {
    @Test void permanentIdsArePositiveUniqueAndMatchDefinitions() {
        assertThat(AbilityRegistry.all()).hasSize(33);
        assertThat(AbilityRegistry.all().keySet()).allMatch(id -> id > 0);
        assertThat(new HashSet<>(AbilityRegistry.all().values())).hasSize(33);
        assertThat(Abilities.CATALOG.keySet()).containsExactlyInAnyOrderElementsOf(AbilityRegistry.all().keySet());
        HashSet<Integer> contractIds = new HashSet<>(AbilityContracts.attachedAll().keySet());
        contractIds.addAll(AbilityContracts.entityAll().keySet());
        assertThat(contractIds).containsExactlyInAnyOrderElementsOf(AbilityRegistry.all().keySet());
        assertThat(AbilityContracts.attachedAll().keySet())
                .doesNotContainAnyElementsOf(AbilityContracts.entityAll().keySet());
        assertThat(AbilityContracts.all()).hasSize(33);
        assertThat(AbilityContracts.all().values()).allSatisfy(contract -> {
            assertThat(contract.category()).isNotNull();
            assertThat(contract.spawn()).isNotNull();
            assertThat(contract.activation()).isNotNull();
            assertThat(contract.phases()).isNotEmpty();
        });
        assertThat(AbilityContracts.get(15).phases().getFirst()
                .events().get(AbilityContracts.PhaseEventType.COLLISION).targetKinds())
                .containsExactly(AbilityContracts.TargetKind.BOT, AbilityContracts.TargetKind.SUMMON);
        assertThat(AbilityContracts.get(11).phases().get(1).trigger())
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
        AbilityContracts.all().values().forEach(contract -> {
            contract.phases().forEach(phase -> phase.events().values().forEach(event -> {
                if (event.visualType() != null) {
                    assertThat(event.actions())
                            .contains(AbilityContracts.PhaseAction.EMIT_VISUAL);
                    assertThat(event.visibleMs()).isPositive();
                }
            }));
            contract.abilities().forEach(ability -> ability.phases().forEach(phase ->
                    phase.events().values().forEach(event -> {
                        if (event.visualType() != null) {
                            assertThat(event.actions())
                                    .contains(AbilityContracts.PhaseAction.EMIT_VISUAL);
                            assertThat(event.visibleMs()).isPositive();
                        }
                    })));
        });

        for (int abilityId : List.of(4, 11, 14, 27, 29)) {
            AbilityContracts.AbilityContract contract = AbilityContracts.entityAll().get(abilityId);
            AbilityContracts.AbilityPhase explosionPhase = contract.phases().stream()
                    .filter(phase -> phase.id().equals(abilityId == 29 ? "destroyed" : "active"))
                    .findFirst().orElseThrow();
            assertThat(explosionPhase.visual()).isNull();
        }

        AbilityContracts.AbilityPhase droneShot = AbilityContracts.entityAll().get(17)
                .abilities().getFirst().phases().getFirst();
        assertThat(droneShot.visual()).isNull();
        assertThat(droneShot.events().get(AbilityContracts.PhaseEventType.COLLISION).visualType())
                .isEqualTo("gun");
        assertThat(droneShot.events().get(AbilityContracts.PhaseEventType.COLLISION).visibleMs())
                .isEqualTo(300);
        assertThat(droneShot.events().get(AbilityContracts.PhaseEventType.COLLISION).visualSize())
                .isEqualTo(16.0);

        AbilityContracts.PhaseEvent explicitVisual = new AbilityContracts.PhaseEvent(
                List.of(AbilityContracts.PhaseAction.APPLY_EFFECTS), Set.of(), null, null,
                "testExplosion", 240, null, null,
                List.of(AbilityContracts.TargetKind.BOT));
        assertThat(explicitVisual.actions())
                .containsExactly(AbilityContracts.PhaseAction.APPLY_EFFECTS,
                        AbilityContracts.PhaseAction.EMIT_VISUAL);
        assertThat(explicitVisual.visibleMs()).isEqualTo(240);
        assertThatThrownBy(() -> new AbilityContracts.PhaseEvent(
                List.of(AbilityContracts.PhaseAction.APPLY_EFFECTS), Set.of(), null, null,
                "testExplosion", null, null, null,
                List.of(AbilityContracts.TargetKind.BOT)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("positive visibleMs");
    }

    @Test void invalidPermanentIdsFailClosed() {
        assertThatThrownBy(() -> AbilityRegistry.requireId(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(-1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(35)).isInstanceOf(IllegalArgumentException.class);
    }
}
