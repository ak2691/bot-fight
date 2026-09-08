package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import java.util.HashSet;
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
                .containsExactly(AbilityContracts.TargetKind.BOT);
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
    }

    @Test void invalidPermanentIdsFailClosed() {
        assertThatThrownBy(() -> AbilityRegistry.requireId(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(-1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(35)).isInstanceOf(IllegalArgumentException.class);
    }
}
