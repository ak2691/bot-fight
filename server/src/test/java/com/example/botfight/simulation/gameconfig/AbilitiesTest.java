package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AbilitiesTest {

    @Test
    void grenadeDamageUsesTheCanonicalCenterFalloff() {
        assertThat(Abilities.damageAtDistance(4, 0)).isEqualTo(40);
        assertThat(Abilities.damageAtDistance(4, 32)).isEqualTo(32.5);
        assertThat(Abilities.damageAtDistance(4, 64)).isEqualTo(25);
        assertThat(Abilities.damageAtDistance(4, 70)).isEqualTo(25);
        assertThat(Abilities.damageAtDistance(4, 71)).isZero();
    }

    @Test
    void rangedDamageProfilesUseLinearEndpointsAndPlateaus() {
        assertThat(Abilities.damageAtDistance(3, 100)).isEqualTo(15);
        assertThat(Abilities.damageAtDistance(3, 400)).isEqualTo(10);
        assertThat(Abilities.damageAtDistance(3, 700)).isEqualTo(5);
        assertThat(Abilities.damageAtDistance(12, 166.665)).isEqualTo(6);
        assertThat(Abilities.damageAtDistance(12, 400)).isEqualTo(4);
        assertThat(Abilities.damageAtDistance(14, 45)).isEqualTo(27.5);
        assertThat(Abilities.damageAtDistance(14, 120)).isEqualTo(20);
        assertThat(Abilities.damageAtDistance(22, 65)).isEqualTo(15);
    }

    @Test
    void everyAbilityContractUsesTheUnifiedNumericCatalog() {
        assertThat(Abilities.CATALOG.keySet()).containsExactlyInAnyOrderElementsOf(AbilityContracts.all().keySet());
        assertThat(Abilities.CATALOG.values()).allSatisfy(definition -> {
            assertThat(definition.stats()).isNotNull();
            assertThat(definition.damageFalloff()).isNotNull();
            assertThat(definition.resourceModel()).isNotNull();
        });
    }

    @Test
    void everyFiniteChargeResourceUsesTheAuthoritativeCatalog() {
        assertThat(Abilities.CATALOG.entrySet().stream()
                .filter(entry -> entry.getValue().charges() > 0)
                .map(entry -> entry.getKey())
                .toList())
                .containsExactlyInAnyOrder(3, 5, 12);
        assertThat(Abilities.definition(16).charges()).isZero();
        assertThat(Abilities.definition(17).charges()).isZero();
    }

    @Test
    void fixedResourceModelIsReservedForActiveChargePools() {
        assertThat(Abilities.ResourceModel.values()).contains(Abilities.ResourceModel.FIXED);
        assertThat(Abilities.definition(16).resourceModel()).isEqualTo(Abilities.ResourceModel.NONE);
        assertThat(Abilities.definition(17).resourceModel()).isEqualTo(Abilities.ResourceModel.NONE);
    }

    @Test
    void fireGunUsesHalfSecondActiveAndRecoveryWindowsWithoutChangingReload() {
        assertThat(Abilities.definition(3).activeMs()).isEqualTo(500);
        assertThat(Abilities.cooldownMs(3)).isEqualTo(1_000);
        assertThat(Abilities.definition(3).charges()).isEqualTo(6);
        assertThat(Abilities.definition(3).rechargeMs()).isEqualTo(5_000);
        assertThat(Abilities.cooldownMs(5)).isEqualTo(300);
        assertThat(Abilities.definition(5).rechargeMs()).isEqualTo(5_000);
        assertThat(Abilities.definition(12).charges()).isEqualTo(10);
        assertThat(Abilities.definition(12).rechargeMs()).isEqualTo(3_000);
        assertThat(Abilities.definition(12).resourceModel())
                .isEqualTo(Abilities.ResourceModel.RELOAD_WHEN_EMPTY);
    }

    @Test
    void singularityUsesOneCenterToEdgeFalloffProfile() {
        assertThat(Abilities.statusDurationMs(26, "slow", 0)).isEqualTo(1_500);
        assertThat(Abilities.stat(26, "knockback", 0)).isEqualTo(60);
        assertThat(Abilities.damageAtDistance(27, 0)).isEqualTo(35);
        assertThat(Abilities.stat(27, "pullPerTick", 0)).isEqualTo(10);
        assertThat(Abilities.damageAtDistance(27, 140)).isEqualTo(15);
        assertThat(Abilities.damageAtDistance(27, 141)).isZero();
    }

    @Test
    void newAbilityStatsKeepTheirSuggestedRoundStrengths() {
        assertThat(Abilities.definition(6).damage()).isEqualTo(10);
        assertThat(Abilities.windupMs(6)).isEqualTo(200);
        assertThat(Abilities.definition(6).activeMs()).isEqualTo(100);
        assertThat(Abilities.range(6)).isEqualTo(184);
        assertThat(Abilities.stat(6, "hitboxWidth", 0)).isEqualTo(80);
        assertThat(Abilities.definition(9).damage()).isEqualTo(20);
        assertThat(Abilities.definition(11).damage()).isEqualTo(25);
        assertThat(Abilities.definition(17).damage()).isEqualTo(5);
        assertThat(Abilities.definition(18).damage()).isEqualTo(20);
        assertThat(Abilities.stat(18, "knockback", 0)).isEqualTo(200);
        assertThat(Abilities.cooldownMs(28)).isEqualTo(7_700);
        assertThat(Abilities.definition(24).windupMs()).isEqualTo(1_000);
        assertThat(Abilities.definition(25).damage()).isEqualTo(15);
        assertThat(Abilities.definition(26).damage()).isEqualTo(15);
        assertThat(Abilities.definition(28).damage()).isEqualTo(10);
        assertThat(Abilities.stat(28, "pullPerTick", 0)).isEqualTo(100);
        assertThat(Abilities.definition(29).damage()).isEqualTo(15);
        assertThat(Abilities.stat(29, "hp", 0)).isEqualTo(20);
        assertThat(Abilities.cooldownMs(30)).isEqualTo(8_000);
        assertThat(Abilities.windupMs(30)).isEqualTo(200);
        assertThat(Abilities.definition(30).damage()).isEqualTo(15);
        assertThat(Abilities.stat(30, "interruptMs", 0)).isEqualTo(250);
        assertThat(Abilities.statusDurationMs(30, "slow", 0)).isEqualTo(2_000);
        assertThat(Abilities.definition(31).damage()).isEqualTo(3);
        assertThat(Abilities.stat(31, "knockback", 0)).isEqualTo(40);
        assertThat(Abilities.definition(32).damage()).isZero();
        assertThat(Abilities.cooldownMs(32)).isEqualTo(10_000);
        assertThat(Abilities.windupMs(32)).isEqualTo(300);
        assertThat(Abilities.stat(32, "maxDamage", 0)).isEqualTo(25);
        assertThat(Abilities.stat(32, "minDamage", 0)).isEqualTo(15);
        assertThat(Abilities.damageAtDistance(32, 250)).isEqualTo(20);
        assertThat(Abilities.stat(33, "cooldownRecoveryPercent", 0)).isEqualTo(50);
        assertThat(Abilities.stat(33, "cooldownRecoveryMultiplier", 0)).isEqualTo(0.5);
        assertThat(Abilities.durationMs(33)).isEqualTo(4_000);
        assertThat(Abilities.windupMs(33)).isEqualTo(500);
        assertThat(Abilities.definition(33).activeMs()).isZero();
    }

    @Test
    void defensiveStatusesUsePreparationAndDoNotUseTheirEffectDurationAsActionTime() {
        assertThat(Abilities.windupMs(16)).isEqualTo(500);
        assertThat(Abilities.definition(16).activeMs()).isZero();
        assertThat(Abilities.durationMs(16)).isEqualTo(4_000);
        assertThat(Abilities.windupMs(23)).isEqualTo(500);
        assertThat(Abilities.definition(23).activeMs()).isZero();
        assertThat(Abilities.durationMs(23)).isEqualTo(1_500);
    }

    @Test
    void basicStrikeUsesTheSmallImmediateMeleeProfile() {
        assertThat(Abilities.cooldownMs(34)).isEqualTo(500);
        assertThat(Abilities.windupMs(34)).isZero();
        assertThat(Abilities.durationMs(34)).isZero();
        assertThat(Abilities.definition(34).activeMs()).isEqualTo(200);
        assertThat(Abilities.definition(34).damage()).isEqualTo(8);
        assertThat(Abilities.range(34)).isEqualTo(80);
        assertThat(Abilities.arcDegrees(34)).isEqualTo(30);
    }

    @Test
    void phaseStrikeUsesAForwardRectangleProfile() {
        assertThat(Abilities.range(25)).isEqualTo(100);
        assertThat(Abilities.arcDegrees(25)).isZero();
        assertThat(Abilities.stat(25, "hitboxWidth", 0)).isEqualTo(60);
    }

    @Test
    void dashUsesTheLongerRequestedRecoveryWindow() {
        assertThat(Abilities.cooldownMs(19)).isEqualTo(1_800);
        assertThat(Abilities.definition(19).activeMs()).isEqualTo(200);
    }

    @Test
    void effectiveActionLocksMatchTheBrowserTimingFallbacks() {
        int[][] expectedActiveMs = {
                {1, 400}, {3, 500}, {4, 1}, {5, 500}, {6, 100}, {7, 400},
                {8, 500}, {9, 300}, {10, 300}, {11, 300}, {12, 300}, {13, 300},
                {14, 2_000}, {15, 2_000}, {16, 0}, {17, 300}, {18, 500}, {19, 200},
                {20, 200}, {21, 300}, {22, 0}, {23, 0}, {24, 300}, {25, 300},
                {26, 300}, {27, 300}, {28, 300}, {29, 300}, {30, 300}, {31, 300},
                {32, 300}, {33, 0}, {34, 200},
        };
        for (int[] expected : expectedActiveMs) {
            assertThat(Abilities.definition(expected[0]).activeMs())
                    .as("ability %s activeMs", expected[0])
                    .isEqualTo(expected[1]);
        }
    }

    @Test
    void entityLifecyclesUseCanonicalDurationAndAbilityOwnedStatusTiming() {
        assertThat(Abilities.stat(14, "fuseMs", 0)).isZero();
        assertThat(Abilities.durationMs(14)).isEqualTo(7_000);
        assertThat(Abilities.durationMs(15)).isEqualTo(1_200);
        assertThat(Abilities.durationMs(21)).isEqualTo(3_100);
        assertThat(Abilities.durationMs(24)).isEqualTo(5_000);
        assertThat(Abilities.definition(24).activeMs()).isEqualTo(300);
        assertThat(Abilities.stat(27, "fuseMs", 0)).isZero();
        assertThat(Abilities.durationMs(27)).isEqualTo(1_300);
        assertThat(Abilities.statusDurationMs(5, "burn", 0)).isEqualTo(5_000);
        assertThat(Abilities.statusIntervalMs(5, "burn", 0)).isEqualTo(1_000);
    }

    @Test
    void thrownAbilityRangesDescribeTravelWithoutReplacingImpactRadii() {
        assertThat(Abilities.stat(4, "throwRange", 0)).isEqualTo(336);
        assertThat(Abilities.stat(11, "throwRange", 0)).isEqualTo(176);
        assertThat(Abilities.range(4)).isEqualTo(70);
        assertThat(Abilities.stat(11, "triggerRadius", 0)).isEqualTo(87.5);
    }

    @Test
    void entityProjectileRangesMatchDurationTimesFixedStepDisplacement() {
        assertThat(Abilities.range(5))
                .isEqualTo(Abilities.stat(5, "speed", 0) * Abilities.durationMs(5) / 100);
        assertThat(Abilities.range(18))
                .isEqualTo(Abilities.stat(18, "speed", 0) * Abilities.durationMs(18) / 100);
        assertThat(Abilities.range(28))
                .isEqualTo(Abilities.stat(28, "speed", 0) * Abilities.durationMs(28) / 100);
    }

    @Test
    void dronesSeparateShortActionLocksFromEntityLifetimes() {
        assertThat(Abilities.definition(17).activeMs()).isEqualTo(300);
        assertThat(Abilities.durationMs(17)).isEqualTo(6_000);
        assertThat(Abilities.definition(31).activeMs()).isEqualTo(300);
        assertThat(Abilities.durationMs(31)).isEqualTo(6_000);
    }

    @Test
    void orbitalStrikeUsesFiveTickPreparationAndGenericIntervalDamage() {
        assertThat(Abilities.windupMs(22)).isEqualTo(500);
        assertThat(Abilities.definition(22).activeMs()).isZero();
        assertThat(Abilities.durationMs(22)).isEqualTo(1_500);
        assertThat(Abilities.definition(22).damage()).isEqualTo(15);
        assertThat(Abilities.stat(22, "intervalMs", 0)).isEqualTo(500);
        assertThat(Abilities.damageAtDistance(22, 0)).isEqualTo(15);
        assertThat(Abilities.damageAtDistance(22, 100)).isEqualTo(15);
    }
}
