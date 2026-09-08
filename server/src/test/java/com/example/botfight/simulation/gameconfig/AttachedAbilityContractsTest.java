package com.example.botfight.simulation.gameconfig;

import static com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType.DAMAGE;
import static com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType.DAMAGE_IMMUNITY;
import static com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType.DAMAGE_REDUCTION;
import static com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType.HEALING;
import static com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType.KNOCKBACK;
import static com.example.botfight.simulation.ecs.contracts.AbilityContracts.EffectType.PULL;
import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import org.junit.jupiter.api.Test;

class AbilityContractsTest {
    @Test
    void directHitboxesUseBotAttachedPhasesWithShapeOwnedGeometry() {
        assertThat(AbilityContracts.get(1).phases().getFirst().type())
                .isEqualTo(AbilityContracts.PhaseType.BOT_ATTACHED);
        assertThat(AbilityContracts.get(1).phases().getFirst().hitbox().get("shape")).isEqualTo("arc");
        assertThat(AbilityContracts.get(3).phases().getFirst().hitbox().get("shape")).isEqualTo("ray");
        assertThat(AbilityContracts.get(6).phases().getFirst().hitbox().get("shape")).isEqualTo("rectangle");
        assertThat(AbilityContracts.get(8).phases().getFirst().hitbox().get("shape")).isEqualTo("circle");
    }

    @Test
    void fireballPhaseOwnsConcreteDamageAndBurnPayload() {
        AbilityContracts.AbilityPhase phase = AbilityContracts.entityContractForAbility(5).phases().getFirst();

        assertThat(phase.effects()).extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.STATUS);
        assertThat(phase.effects()).filteredOn(effect -> effect.type() == AbilityContracts.EffectType.STATUS)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.subtype()).isEqualTo("burn");
                    assertThat(effect.amount()).isEqualTo(2);
                    assertThat(effect.durationMs()).isEqualTo(5_000);
                });
    }

    @Test
    void phaseContractsOwnConcreteEffectPayloads() {
        assertThat(AbilityContracts.attachedAll().values()).allSatisfy(contract ->
                assertThat(contract.phases()).isNotEmpty());
        assertThat(AbilityContracts.get(8).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(250));
        assertThat(AbilityContracts.entityContractForAbility(27).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(10));
        assertThat(AbilityContracts.entityContractForAbility(14).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(6));
        assertThat(AbilityContracts.entityContractForAbility(28).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(100));
        assertThat(AbilityContracts.effectAmount(9, DAMAGE)).isEqualTo(20);
        assertThat(AbilityContracts.effectAmount(26, DAMAGE)).isEqualTo(15);
        assertThat(AbilityContracts.effectDurationMs(9, "slow")).isEqualTo(1_000);
        assertThat(AbilityContracts.effectAmount(30, DAMAGE)).isEqualTo(15);
        assertThat(AbilityContracts.effectDurationMs(30, "slow")).isEqualTo(2_000);
        assertThat(AbilityContracts.entityContractForAbility(4).phases().get(2).effects())
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
        assertThat(AbilityContracts.get(26).phases().getFirst().effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.STATUS, KNOCKBACK);
        assertThat(AbilityContracts.entityContractForAbility(27).phases().stream()
                .flatMap(phase -> phase.effects().stream())
                .map(AbilityContracts.Effect::type))
                .contains(PULL, DAMAGE);

        assertThat(AbilityContracts.entityContractForAbility(28).phases().getFirst().effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, PULL, AbilityContracts.EffectType.STATUS);
        assertThat(AbilityContracts.entityContractForAbility(29).phases().getFirst().effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.STATUS, AbilityContracts.EffectType.INTERRUPT);
        assertThat(AbilityContracts.get(30).phases().getFirst().effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AbilityContracts.EffectType.INTERRUPT, AbilityContracts.EffectType.STATUS);
        assertThat(AbilityContracts.entityContractForAbility(31).abilities().getFirst().phases().getFirst().effects())
                .extracting(AbilityContracts.Effect::type)
                .containsExactly(DAMAGE, KNOCKBACK);
    }

    @Test
    void windBurstContractIncludesDamageAndKnockback() {
        assertThat(AbilityContracts.entityContractForAbility(18).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(20));
        assertThat(AbilityContracts.entityContractForAbility(18).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(200));
    }

    @Test
    void basicHealContractRemainsSelfTargetedAndRestoresTwentyFiveHp() {
        assertThat(AbilityContracts.targetsOwner(10)).isTrue();
        assertThat(AbilityContracts.get(10).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == HEALING)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(25));
    }

    @Test
    void vampiricBeamUsesAConfirmedSourceHealAndOverclockIsASeparateBuffEffect() {
        AbilityContracts.Effect vampiricHeal = AbilityContracts.get(32).phases().getFirst().effects().stream()
                .filter(effect -> effect.type() == HEALING).findFirst().orElseThrow();
        assertThat(vampiricHeal.recipient()).isEqualTo("source");
        assertThat(vampiricHeal.requiresConfirmedDamage()).isTrue();
        assertThat(vampiricHeal.mirrorsDamage()).isTrue();
        assertThat(AbilityContracts.get(33).phases().getFirst().effects()).singleElement().satisfies(effect -> {
            assertThat(effect.type()).isEqualTo(AbilityContracts.EffectType.BUFF);
            assertThat(effect.subtype()).isEqualTo("overclock");
            assertThat(effect.amount()).isEqualTo(.5);
            assertThat(effect.durationMs()).isEqualTo(4_000);
        });
    }

    @Test
    void basicStrikeIsADirectDamageOnlyMeleeAction() {
        assertThat(AbilityContracts.get(34).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(34).phases().getFirst().effects())
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
        assertThat(AbilityContracts.get(16).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == DAMAGE_REDUCTION)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.amount()).isEqualTo(.5);
                    assertThat(effect.durationMs()).isEqualTo(4_000);
                });
        assertThat(AbilityContracts.get(23).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == DAMAGE_IMMUNITY)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.amount()).isEqualTo(1);
                    assertThat(effect.durationMs()).isEqualTo(1_500);
                });
    }

    @Test
    void activationMetadataDescribesPayloadOnlyBehavior() {
        assertThat(AbilityContracts.get(3).activation().captureAtActivation()).isTrue();
        assertThat(AbilityContracts.get(19).phases().getFirst().movement().distance())
                .isEqualTo(150.0);
        assertThat(AbilityContracts.get(19).phases().getFirst().movement().speed())
                .isEqualTo(75.0);
        assertThat(AbilityContracts.get(19).phases().getFirst().movement().blockedByStatus())
                .isEqualTo("slow");
        assertThat(AbilityContracts.get(19).activation().ignoresGlobalAbilityLock()).isFalse();
        assertThat(AbilityContracts.get(20).activation().faceTargetFromPayload()).isTrue();
        assertThat(AbilityContracts.get(25).activation().phaseFacingDefault())
                .isEqualTo("0");
        assertThat(AbilityContracts.get(25).phases().getFirst().hitbox().shape())
                .isEqualTo("rectangle");
        assertThat(AbilityContracts.get(25).activation().captureAtActivation()).isTrue();
        assertThat(AbilityContracts.get(25).activation().teleportOncePerActivation()).isTrue();
        assertThat(AbilityContracts.get(6).phases().getFirst().hitbox().shape())
                .isEqualTo("rectangle");
        assertThat(AbilityContracts.get(6).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.effectDurationMs(6, "stun")).isEqualTo(1_200);
        assertThat(AbilityContracts.get(7).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(25).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(8).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(26).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AbilityContracts.get(25).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == AbilityContracts.EffectType.TELEPORT)
                .singleElement().satisfies(effect -> assertThat(effect.distanceMode()).isEqualTo("center_distance"));
    }
}
