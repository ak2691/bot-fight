package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AbilitiesTest {

    @Test
    void grenadeDamageUsesTheCanonicalCenterFalloff() {
        assertThat(Abilities.damageAtDistance(4, 0)).isEqualTo(50);
        assertThat(Abilities.damageAtDistance(4, 70)).isEqualTo(25);
        assertThat(Abilities.damageAtDistance(4, 71)).isZero();
    }

    @Test
    void everyAbilityContractUsesTheUnifiedNumericCatalog() {
        assertThat(Abilities.CATALOG.keySet()).containsExactlyInAnyOrderElementsOf(AbilityContracts.all().keySet());
        assertThat(Abilities.CATALOG.values()).allSatisfy(definition -> {
            assertThat(definition.stats()).isNotNull();
            assertThat(definition.damageFalloff()).isNotNull();
            assertThat(definition.activationModel()).isNotNull();
            assertThat(definition.resourceModel()).isNotNull();
        });
    }
}
