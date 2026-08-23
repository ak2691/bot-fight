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
        assertThat(AbilityRegistry.legacyAbilityNameFromId(1)).isEqualTo("swing");
        assertThat(AbilityRegistry.legacyAbilityNameFromId(25)).isEqualTo("phase_strike");
        assertThat(AbilityRegistry.legacyAbilityNameFromId(27)).isEqualTo("singularity");
        assertThat(AbilityRegistry.legacyAbilityNameFromId(33)).isEqualTo("overclock");
        assertThat(AbilityRegistry.legacyAbilityNameFromId(34)).isEqualTo("basic_strike");
        assertThat(AbilityRegistry.all().keySet()).doesNotContain(0);
        assertThat(AbilityRegistry.all().keySet()).doesNotContain(2);
    }

    @Test void explicitLegacyConversionsFailClosed() {
        assertThat(AbilityRegistry.abilityIdFromLegacyName("heavy_slash")).isEqualTo(7);
        assertThatThrownBy(() -> AbilityRegistry.abilityIdFromLegacyName("arbitrary"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(-1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AbilityRegistry.requireId(35)).isInstanceOf(IllegalArgumentException.class);
    }
}
