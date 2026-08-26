package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashSet;
import org.junit.jupiter.api.Test;

class AbilityRegistryTest {
    @Test void permanentIdsArePositiveUniqueAndMatchDefinitions() {
        assertThat(AbilityRegistry.all()).hasSize(33);
        assertThat(AbilityRegistry.all().keySet()).allMatch(id -> id > 0);
        assertThat(new HashSet<>(AbilityRegistry.all().values())).hasSize(33);
        assertThat(Abilities.CATALOG.keySet()).containsExactlyInAnyOrderElementsOf(AbilityRegistry.all().keySet());
        assertThat(AbilityContracts.all().keySet()).containsExactlyInAnyOrderElementsOf(AbilityRegistry.all().keySet());
    }

    @Test void lookupUsesPermanentMapKeyAndDoesNotDependOnPosition() {
        assertThat(AbilityRegistry.all().keySet()).doesNotContain(0);
        assertThat(AbilityRegistry.all().keySet()).doesNotContain(2);
    }

    @Test void invalidPermanentIdsFailClosed() {
        assertThatThrownBy(() -> AbilityRegistry.requireId(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(-1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(35)).isInstanceOf(IllegalArgumentException.class);
    }
}
