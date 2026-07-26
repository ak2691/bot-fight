package com.example.botfight.simulation.combat;

import static com.example.botfight.simulation.combat.AbilityContracts.ChargeCost.ALL;
import static com.example.botfight.simulation.combat.AbilityContracts.EffectType.DAMAGE;
import static com.example.botfight.simulation.combat.AbilityContracts.EffectType.KNOCKBACK;
import static com.example.botfight.simulation.combat.AbilityContracts.EffectType.PULL;
import static com.example.botfight.simulation.combat.AbilityContracts.ShieldMode.DRAIN_WHILE_ACTIVE;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AbilityContractsTest {
    @Test
    void partialShieldInteractionsPreserveDisplacementEffects() {
        assertThat(AbilityContracts.get("repulsor_burst").shieldInteraction().prevents(DAMAGE)).isTrue();
        assertThat(AbilityContracts.get("repulsor_burst").shieldInteraction().prevents(KNOCKBACK)).isFalse();
        assertThat(AbilityContracts.get("gravity_grenade").shieldInteraction().prevents(DAMAGE)).isTrue();
        assertThat(AbilityContracts.get("gravity_grenade").shieldInteraction().prevents(PULL)).isFalse();
        assertThat(AbilityContracts.get("repulsor_burst").effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(250));
    }

    @Test
    void drainPoliciesAreDataRatherThanResolverBranches() {
        assertThat(AbilityContracts.get("heavy_slash").shieldInteraction().chargeCost()).isEqualTo(ALL);
        assertThat(AbilityContracts.get("proximity_mine").shieldInteraction().chargeCost()).isEqualTo(ALL);
        assertThat(AbilityContracts.get("orbital_strike").shieldInteraction().mode()).isEqualTo(DRAIN_WHILE_ACTIVE);
        assertThat(AbilityContracts.get("orbital_strike").shieldInteraction().prevents()).isEmpty();
    }

    @Test
    void thrustContractIncludesDamageAndKnockback() {
        assertThat(AbilityContracts.get("thrust").effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(15));
        assertThat(AbilityContracts.get("thrust").effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(30));
    }
}
