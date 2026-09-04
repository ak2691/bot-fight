package com.example.botfight.simulation.gameconfig;

import static com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType.PROJECTILE;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.DAMAGE;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.DAMAGE_IMMUNITY;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.DAMAGE_REDUCTION;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.HEALING;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.KNOCKBACK;
import static com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType.PULL;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AbilityContractsTest {
    @Test
    void activeContractsDoNotFilterEffects() {
        assertThat(AbilityContracts.all().values()).allSatisfy(contract ->
                assertThat(contract.effects()).isNotNull());
        assertThat(AbilityContracts.get(8).effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(250));
        assertThat(AbilityContracts.get(27).effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(10));
        assertThat(AbilityContracts.get(14).effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(6));
        assertThat(AbilityContracts.get(28).effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(100));
        assertThat(AbilityContracts.effectAmount(9, DAMAGE)).isEqualTo(20);
        assertThat(AbilityContracts.effectAmount(26, DAMAGE)).isEqualTo(15);
        assertThat(AbilityContracts.effectAmount(28, DAMAGE)).isEqualTo(10);
        assertThat(AbilityContracts.effectAmount(29, DAMAGE)).isEqualTo(15);
        assertThat(AbilityContracts.effectDurationMs(9, "slow")).isEqualTo(1_000);
        assertThat(AbilityContracts.effectAmount(11, DAMAGE)).isEqualTo(25);
        assertThat(AbilityContracts.effectAmount(30, DAMAGE)).isEqualTo(15);
        assertThat(AbilityContracts.effectDurationMs(30, "slow")).isEqualTo(2_000);
        assertThat(AbilityContracts.get(4).effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.falloff().maxAmount()).isEqualTo(40);
                    assertThat(effect.falloff().minAmount()).isEqualTo(25);
                    assertThat(effect.falloff().falloffEnd()).isEqualTo(64);
                });
    }

    @Test
    void statusOverrideKeysKeepSeparateStatusInstancesAddressable() {
        AbilityContracts.Effect slow = new AbilityContracts.Effect(
                AbilityContracts.EffectType.STATUS, "slow", 0, 1_000, false);
        AbilityContracts.Effect burn = new AbilityContracts.Effect(
                AbilityContracts.EffectType.STATUS, "burn", 0, 5_000, false);

        assertThat(AbilityContracts.effectOverrideKey(slow)).isEqualTo("status:slow");
        assertThat(AbilityContracts.effectOverrideKey(burn)).isEqualTo("status:burn");
    }

    @Test
    void newAbilitiesDeclareComposableEffectSequences() {
        assertThat(AbilityContracts.get(26).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.RADIAL);
        assertThat(AbilityContracts.get(26).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.STATUS, KNOCKBACK);
        assertThat(AbilityContracts.get(27).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.ZONE);
        assertThat(AbilityContracts.get(27).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(PULL, DAMAGE, AbilityContracts.EffectType.SPAWN_ENTITY);

        assertThat(AbilityContracts.get(28).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, PULL, AbilityContracts.EffectType.STATUS, AbilityContracts.EffectType.SPAWN_ENTITY);
        assertThat(AbilityContracts.get(29).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.STATUS, AbilityContracts.EffectType.INTERRUPT,
                        AbilityContracts.EffectType.SPAWN_ENTITY);
        assertThat(AbilityContracts.get(30).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.INTERRUPT, AbilityContracts.EffectType.STATUS);
        assertThat(AbilityContracts.get(31).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, KNOCKBACK, AbilityContracts.EffectType.SPAWN_ENTITY);
    }

    @Test
    void windBurstContractIncludesDamageAndKnockback() {
        assertThat(AbilityContracts.get(18).delivery()).isEqualTo(PROJECTILE);
        assertThat(AbilityContracts.get(18).effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(20));
        assertThat(AbilityContracts.get(18).effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(200));
    }

    @Test
    void basicHealContractRemainsSelfTargetedAndRestoresTwentyFiveHp() {
        assertThat(AbilityContracts.get(10).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.SELF);
        assertThat(AbilityContracts.get(10).effects())
                .filteredOn(effect -> effect.type() == HEALING)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(25));
    }

    @Test
    void vampiricBeamUsesAConfirmedSourceHealAndOverclockIsASeparateBuffEffect() {
        AbilityContracts.Effect vampiricHeal = AbilityContracts.get(32).effects().stream()
                .filter(effect -> effect.type() == HEALING).findFirst().orElseThrow();
        assertThat(vampiricHeal.recipient()).isEqualTo("source");
        assertThat(vampiricHeal.requiresConfirmedDamage()).isTrue();
        assertThat(vampiricHeal.mirrorsDamage()).isTrue();
        assertThat(AbilityContracts.get(33).effects()).singleElement().satisfies(effect -> {
            assertThat(effect.type()).isEqualTo(AbilityContracts.EffectType.BUFF);
            assertThat(effect.subtype()).isEqualTo("overclock");
            assertThat(effect.amount()).isEqualTo(.5);
            assertThat(effect.durationMs()).isEqualTo(4_000);
        });
    }

    @Test
    void basicStrikeIsADirectDamageOnlyMeleeAction() {
        assertThat(AbilityContracts.get(34).delivery()).isEqualTo(AbilityContracts.DeliveryType.MELEE);
        assertThat(AbilityContracts.get(34).includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(34).effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE);
        assertThat(AbilityContracts.effectAmount(34, DAMAGE)).isEqualTo(8);
    }

    @Test
    void abilityCatalogUsesCanonicalActionIdsOnly() {
        assertThat(AbilityContracts.actions()).contains(1, 3, 4, 5, 6, 7, 18, 19, 25, 34);
        assertThat(AbilityContracts.actions()).doesNotContain(2);
        assertThat(AbilityContracts.abilityForAction("dash")).isNull();
        assertThat(AbilityContracts.abilityForAction("dash_toward_left")).isNull();
        assertThat(AbilityContracts.abilityForAction("phase_strike_face_origin")).isNull();
    }

    @Test
    void generalizedZoneAndBuffContractsExposeTheirCanonicalMetadata() {
        assertThat(AbilityContracts.get(14).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.PROJECTILE);
        assertThat(AbilityContracts.get(22).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.ZONE);
        assertThat(AbilityContracts.get(24).delivery())
                .isEqualTo(AbilityContracts.DeliveryType.ZONE);
        assertThat(AbilityContracts.get(16).effects())
                .filteredOn(effect -> effect.type() == DAMAGE_REDUCTION)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.amount()).isEqualTo(.5);
                    assertThat(effect.durationMs()).isEqualTo(4_000);
                });
        assertThat(AbilityContracts.get(23).effects())
                .filteredOn(effect -> effect.type() == DAMAGE_IMMUNITY)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.amount()).isEqualTo(1);
                    assertThat(effect.durationMs()).isEqualTo(1_500);
                });
    }

    @Test
    void executionMetadataDescribesPayloadOnlyBehavior() {
        assertThat(AbilityContracts.get(3).execution().captureAtActivation()).isTrue();
        assertThat(AbilityContracts.get(19).execution().movement().distanceStat())
                .isEqualTo("distance");
        assertThat(AbilityContracts.get(19).execution().ignoresGlobalAbilityLock()).isFalse();
        assertThat(AbilityContracts.get(20).execution().faceTargetFromPayload()).isTrue();
        assertThat(AbilityContracts.get(25).execution().phaseFacingDefault())
                .isEqualTo("0");
        assertThat(AbilityContracts.get(25).hitboxGeometry())
                .isEqualTo(AbilityContracts.HitboxGeometry.RECTANGLE);
        assertThat(AbilityContracts.get(25).execution().captureAtActivation()).isTrue();
        assertThat(AbilityContracts.get(25).execution().teleportOncePerActivation()).isTrue();
        assertThat(AbilityContracts.get(6).hitboxGeometry())
                .isEqualTo(AbilityContracts.HitboxGeometry.RECTANGLE);
        assertThat(AbilityContracts.get(6).includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.effectDurationMs(6, "stun")).isEqualTo(1_200);
        assertThat(AbilityContracts.get(7).includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(25).includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(8).includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(26).includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(25).effects())
                .filteredOn(effect -> effect.type() == AbilityContracts.EffectType.TELEPORT)
                .singleElement().satisfies(effect -> assertThat(effect.distanceMode()).isEqualTo("center_distance"));
    }
}
