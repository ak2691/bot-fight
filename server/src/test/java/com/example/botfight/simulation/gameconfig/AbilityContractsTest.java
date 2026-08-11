package com.example.botfight.simulation.gameconfig;

import static com.example.botfight.simulation.gameconfig.AbilityContracts.ChargeCost.ALL;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType.PROJECTILE;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.DAMAGE;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.HEALING;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.KNOCKBACK;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.PULL;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.ShieldMode.DRAIN_WHILE_ACTIVE;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AbilityContractsTest {
    @Test
    void partialShieldInteractionsPreserveDisplacementEffects() {
        assertThat(AbilityContracts.get(8).shieldInteraction().prevents(DAMAGE)).isTrue();
        assertThat(AbilityContracts.get(8).shieldInteraction().prevents(KNOCKBACK)).isFalse();
        assertThat(AbilityContracts.get(14).shieldInteraction().prevents(DAMAGE)).isTrue();
        assertThat(AbilityContracts.get(14).shieldInteraction().prevents(PULL)).isFalse();
        assertThat(AbilityContracts.get(8).effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(250));
    }

    @Test
    void drainPoliciesAreDataRatherThanResolverBranches() {
        assertThat(AbilityContracts.get(7).shieldInteraction().chargeCost()).isEqualTo(ALL);
        assertThat(AbilityContracts.get(11).shieldInteraction().chargeCost()).isEqualTo(ALL);
        assertThat(AbilityContracts.get(22).shieldInteraction().mode()).isEqualTo(DRAIN_WHILE_ACTIVE);
        assertThat(AbilityContracts.get(22).shieldInteraction().prevents()).isEmpty();
    }

    @Test
    void windBurstContractIncludesDamageAndKnockback() {
        assertThat(AbilityContracts.get(18).delivery()).isEqualTo(PROJECTILE);
        assertThat(AbilityContracts.get(18).effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(15));
        assertThat(AbilityContracts.get(18).effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(90));
    }

    @Test
    void basicHealContractRemainsSelfTargetedAndRestoresFifteenHp() {
        assertThat(AbilityContracts.get(10).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.SELF);
        assertThat(AbilityContracts.get(10).effects())
                .filteredOn(effect -> effect.type() == HEALING)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(15));
    }

    @Test
    void abilityCatalogUsesCanonicalActionIdsOnly() {
        assertThat(AbilityContracts.actions()).contains(1, 2, 3, 4, 5, 6, 7, 18, 19, 25);
        assertThat(AbilityContracts.abilityForAction("dash")).isNull();
        assertThat(AbilityContracts.abilityForAction("dash_toward_left")).isNull();
        assertThat(AbilityContracts.abilityForAction("phase_strike_face_origin")).isNull();
    }
}
