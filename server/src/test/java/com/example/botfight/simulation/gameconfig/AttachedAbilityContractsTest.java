package com.example.botfight.simulation.gameconfig;

import static com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType.DAMAGE;
import static com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType.DAMAGE_IMMUNITY;
import static com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType.DAMAGE_REDUCTION;
import static com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType.HEALING;
import static com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType.KNOCKBACK;
import static com.example.botfight.simulation.gameconfig.AttachedAbilityContracts.EffectType.PULL;
import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import org.junit.jupiter.api.Test;

class AttachedAbilityContractsTest {
    @Test
    void directHitboxesUseBotAttachedPhasesWithShapeOwnedGeometry() {
        assertThat(AttachedAbilityContracts.get(1).phases().getFirst().type())
                .isEqualTo(AttachedAbilityContracts.PhaseType.BOT_ATTACHED);
        assertThat(AttachedAbilityContracts.get(1).phases().getFirst().hitbox().get("shape")).isEqualTo("arc");
        assertThat(AttachedAbilityContracts.get(3).phases().getFirst().hitbox().get("shape")).isEqualTo("ray");
        assertThat(AttachedAbilityContracts.get(6).phases().getFirst().hitbox().get("shape")).isEqualTo("rectangle");
        assertThat(AttachedAbilityContracts.get(8).phases().getFirst().hitbox().get("shape")).isEqualTo("circle");
    }

    @Test
    void fireballPhaseOwnsConcreteDamageAndBurnPayload() {
        AttachedAbilityContracts.AbilityPhase phase = EntityContracts.forAbility(5).phases().getFirst();

        assertThat(phase.effects()).extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AttachedAbilityContracts.EffectType.STATUS);
        assertThat(phase.effects()).filteredOn(effect -> effect.type() == AttachedAbilityContracts.EffectType.STATUS)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.subtype()).isEqualTo("burn");
                    assertThat(effect.amount()).isEqualTo(2);
                    assertThat(effect.durationMs()).isEqualTo(5_000);
                });
    }

    @Test
    void phaseContractsOwnConcreteEffectPayloads() {
        assertThat(AttachedAbilityContracts.all().values()).allSatisfy(contract ->
                assertThat(contract.phases()).isNotEmpty());
        assertThat(AttachedAbilityContracts.get(8).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(250));
        assertThat(EntityContracts.forAbility(27).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(10));
        assertThat(EntityContracts.forAbility(14).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(6));
        assertThat(EntityContracts.forAbility(28).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == PULL)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(100));
        assertThat(AttachedAbilityContracts.effectAmount(9, DAMAGE)).isEqualTo(20);
        assertThat(AttachedAbilityContracts.effectAmount(26, DAMAGE)).isEqualTo(15);
        assertThat(AttachedAbilityContracts.effectDurationMs(9, "slow")).isEqualTo(1_000);
        assertThat(AttachedAbilityContracts.effectAmount(30, DAMAGE)).isEqualTo(15);
        assertThat(AttachedAbilityContracts.effectDurationMs(30, "slow")).isEqualTo(2_000);
        assertThat(EntityContracts.forAbility(4).phases().get(2).effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.falloff().maxAmount()).isEqualTo(40);
                    assertThat(effect.falloff().minAmount()).isEqualTo(25);
                    assertThat(effect.falloff().falloffEnd()).isEqualTo(64);
                });
    }

    @Test
    void statusOverrideKeysKeepSeparateStatusInstancesAddressable() {
        AttachedAbilityContracts.Effect slow = new AttachedAbilityContracts.Effect(
                AttachedAbilityContracts.EffectType.STATUS, "slow", 0, 1_000, false);
        AttachedAbilityContracts.Effect burn = new AttachedAbilityContracts.Effect(
                AttachedAbilityContracts.EffectType.STATUS, "burn", 0, 5_000, false);

        assertThat(AttachedAbilityContracts.effectOverrideKey(slow)).isEqualTo("status:slow");
        assertThat(AttachedAbilityContracts.effectOverrideKey(burn)).isEqualTo("status:burn");
    }

    @Test
    void newAbilitiesDeclareComposableEffectSequences() {
        assertThat(AttachedAbilityContracts.get(26).phases().getFirst().effects())
                .extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AttachedAbilityContracts.EffectType.STATUS, KNOCKBACK);
        assertThat(EntityContracts.forAbility(27).phases().stream()
                .flatMap(phase -> phase.effects().stream())
                .map(AttachedAbilityContracts.Effect::type))
                .contains(PULL, DAMAGE);

        assertThat(EntityContracts.forAbility(28).phases().getFirst().effects())
                .extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE, PULL, AttachedAbilityContracts.EffectType.STATUS);
        assertThat(EntityContracts.forAbility(29).phases().getFirst().effects())
                .extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AttachedAbilityContracts.EffectType.STATUS, AttachedAbilityContracts.EffectType.INTERRUPT);
        assertThat(AttachedAbilityContracts.get(30).phases().getFirst().effects())
                .extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE, AttachedAbilityContracts.EffectType.INTERRUPT, AttachedAbilityContracts.EffectType.STATUS);
        assertThat(EntityContracts.forAbility(31).phases().getFirst().effects())
                .extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE, KNOCKBACK);
    }

    @Test
    void windBurstContractIncludesDamageAndKnockback() {
        assertThat(EntityContracts.forAbility(18).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == DAMAGE)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(20));
        assertThat(EntityContracts.forAbility(18).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == KNOCKBACK)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(200));
    }

    @Test
    void basicHealContractRemainsSelfTargetedAndRestoresTwentyFiveHp() {
        assertThat(AttachedAbilityContracts.targetsOwner(10)).isTrue();
        assertThat(AttachedAbilityContracts.get(10).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == HEALING)
                .singleElement().satisfies(effect -> assertThat(effect.amount()).isEqualTo(25));
    }

    @Test
    void vampiricBeamUsesAConfirmedSourceHealAndOverclockIsASeparateBuffEffect() {
        AttachedAbilityContracts.Effect vampiricHeal = AttachedAbilityContracts.get(32).phases().getFirst().effects().stream()
                .filter(effect -> effect.type() == HEALING).findFirst().orElseThrow();
        assertThat(vampiricHeal.recipient()).isEqualTo("source");
        assertThat(vampiricHeal.requiresConfirmedDamage()).isTrue();
        assertThat(vampiricHeal.mirrorsDamage()).isTrue();
        assertThat(AttachedAbilityContracts.get(33).phases().getFirst().effects()).singleElement().satisfies(effect -> {
            assertThat(effect.type()).isEqualTo(AttachedAbilityContracts.EffectType.BUFF);
            assertThat(effect.subtype()).isEqualTo("overclock");
            assertThat(effect.amount()).isEqualTo(.5);
            assertThat(effect.durationMs()).isEqualTo(4_000);
        });
    }

    @Test
    void basicStrikeIsADirectDamageOnlyMeleeAction() {
        assertThat(AttachedAbilityContracts.get(34).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AttachedAbilityContracts.get(34).phases().getFirst().effects())
                .extracting(AttachedAbilityContracts.Effect::type)
                .containsExactly(DAMAGE);
        assertThat(AttachedAbilityContracts.effectAmount(34, DAMAGE)).isEqualTo(8);
    }

    @Test
    void abilityCatalogUsesCanonicalActionIdsOnly() {
        assertThat(AttachedAbilityContracts.actions()).contains(1, 3, 4, 5, 6, 7, 18, 19, 25, 34);
        assertThat(AttachedAbilityContracts.actions()).doesNotContain(2);
        assertThat(AttachedAbilityContracts.abilityForAction("dash")).isNull();
        assertThat(AttachedAbilityContracts.abilityForAction("dash_toward_left")).isNull();
        assertThat(AttachedAbilityContracts.abilityForAction("phase_strike_face_origin")).isNull();
    }

    @Test
    void generalizedZoneAndBuffContractsExposeTheirCanonicalMetadata() {
        assertThat(AttachedAbilityContracts.get(16).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == DAMAGE_REDUCTION)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.amount()).isEqualTo(.5);
                    assertThat(effect.durationMs()).isEqualTo(4_000);
                });
        assertThat(AttachedAbilityContracts.get(23).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == DAMAGE_IMMUNITY)
                .singleElement().satisfies(effect -> {
                    assertThat(effect.amount()).isEqualTo(1);
                    assertThat(effect.durationMs()).isEqualTo(1_500);
                });
    }

    @Test
    void activationMetadataDescribesPayloadOnlyBehavior() {
        assertThat(AttachedAbilityContracts.get(3).activation().captureAtActivation()).isTrue();
        assertThat(AttachedAbilityContracts.get(19).phases().getFirst().movement().distance())
                .isEqualTo(150.0);
        assertThat(AttachedAbilityContracts.get(19).phases().getFirst().movement().speed())
                .isEqualTo(75.0);
        assertThat(AttachedAbilityContracts.get(19).phases().getFirst().movement().blockedByStatus())
                .isEqualTo("slow");
        assertThat(AttachedAbilityContracts.get(19).activation().ignoresGlobalAbilityLock()).isFalse();
        assertThat(AttachedAbilityContracts.get(20).activation().faceTargetFromPayload()).isTrue();
        assertThat(AttachedAbilityContracts.get(25).activation().phaseFacingDefault())
                .isEqualTo("0");
        assertThat(AttachedAbilityContracts.get(25).phases().getFirst().hitbox().shape())
                .isEqualTo("rectangle");
        assertThat(AttachedAbilityContracts.get(25).activation().captureAtActivation()).isTrue();
        assertThat(AttachedAbilityContracts.get(25).activation().teleportOncePerActivation()).isTrue();
        assertThat(AttachedAbilityContracts.get(6).phases().getFirst().hitbox().shape())
                .isEqualTo("rectangle");
        assertThat(AttachedAbilityContracts.get(6).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AttachedAbilityContracts.effectDurationMs(6, "stun")).isEqualTo(1_200);
        assertThat(AttachedAbilityContracts.get(7).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AttachedAbilityContracts.get(25).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AttachedAbilityContracts.get(8).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AttachedAbilityContracts.get(26).phases().getFirst().hitbox().includeTargetRadius()).isTrue();
        assertThat(AttachedAbilityContracts.get(25).phases().getFirst().effects())
                .filteredOn(effect -> effect.type() == AttachedAbilityContracts.EffectType.TELEPORT)
                .singleElement().satisfies(effect -> assertThat(effect.distanceMode()).isEqualTo("center_distance"));
    }
}
