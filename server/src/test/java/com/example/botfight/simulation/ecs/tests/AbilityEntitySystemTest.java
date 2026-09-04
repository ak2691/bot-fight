package com.example.botfight.simulation.ecs.tests;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.contracts.EntityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityBot;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.List;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;

class AbilityEntitySystemTest {
    @Test
    void spawnedAbilitiesResolveThroughStableEntityContractsAndGenericFactory() {
        int[] spawnedAbilities = {4, 5, 11, 14, 15, 17, 18, 21, 22, 24, 27, 28, 29, 31};
        for (int abilityId : spawnedAbilities) {
            EntityContracts.EntityContract contract = EntityContracts.forAbility(abilityId);
            assertThat(contract).as("missing contract for %s", abilityId).isNotNull();
            ArenaEntity entity = AbilityEntityFactory.create(
                    "entity-" + abilityId, abilityId, 1, 100, 200, 60, 90, 1,
                    300, 400, 1000, 800);
            assertThat(entity.abilityId()).isEqualTo(abilityId);
            assertThat(entity.type()).isEqualTo(contract.runtimeType());
            assertThat(EntityContracts.forEntity(entity)).isSameAs(contract);
        }
        assertThat(EntityContracts.phaseFor(AbilityEntityFactory.create(
                "grenade", 4, 1, 100, 200, 60, 90, 1, 0, 0, 1000, 800)).type())
                .isEqualTo(EntityContracts.PhaseType.PROJECTILE);
        assertThat(EntityContracts.phaseFor(AbilityEntityFactory.create(
                "windburst", 18, 1, 100, 200, 60, 90, 1, 0, 0, 1000, 800)).type())
                .isEqualTo(EntityContracts.PhaseType.PROJECTILE);
    }

    @Test
    void factoryExposesHunterDroneHealthAsAComponent() {
        ArenaEntity drone = createEntity("drone-1", 17, 100, 100, 0);

        assertThat(drone.hp()).isEqualTo(50);
        assertThat(drone.components().health().hp()).isEqualTo(50);
        assertThat(drone.components().ownership().ownerSlot()).isEqualTo(1);
    }

    @Test
    void proximityMineMovesAwayFromItsOwnerBeforeItArms() {
        ArenaEntity mine = AbilityEntityFactory.create(
                "mine-1", 11, 1, 500, 450, 60, 180, 1,
                Double.NaN, Double.NaN, 1000, 800);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(mine), List.of(), new ArenaBounds(1000, 800), 100, noDamageCombat());

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.x()).isEqualTo(500);
            assertThat(entity.y()).isEqualTo(472);
            assertThat(entity.traveled()).isEqualTo(22);
            assertThat(entity.armed()).isFalse();
        });
    }

    @Test
    void proximityMineTransitionsFromTravelToItsArmedPhase() {
        ArenaEntity mine = AbilityEntityFactory.create(
                "mine-1", 11, 1, 500, 450, 60, 180, 1,
                Double.NaN, Double.NaN, 1000, 800);
        List<ArenaEntity> active = List.of(mine);
        for (int tick = 0; tick < 8; tick += 1) {
            int elapsedMs = (tick + 1) * 100;
            active = active.stream().map(entity -> entity.withAgeMs(elapsedMs)).toList();
            active = AbilityEntitySystem.tick(
                    active, List.of(), new ArenaBounds(1000, 800), 100, noDamageCombat());
        }

        ArenaEntity armedMine = active.getFirst();
        assertThat(armedMine.armed()).isTrue();
        assertThat(armedMine.traveled()).isEqualTo(176);
        assertThat(armedMine.timerMs()).isZero();
        assertThat(armedMine.ageMs()).isEqualTo(800);
        assertThat(armedMine.velocityX()).isZero();
        assertThat(armedMine.velocityY()).isZero();

        active = active.stream().map(entity -> entity.withAgeMs(900)).toList();
        List<ArenaEntity> armed = AbilityEntitySystem.tick(
                active, List.of(), new ArenaBounds(1000, 800), 100, noDamageCombat());
        assertThat(armed).singleElement().satisfies(entity -> {
            assertThat(entity.timerMs()).isEqualTo(100);
            assertThat(entity.x()).isEqualTo(armedMine.x());
            assertThat(entity.y()).isEqualTo(armedMine.y());
        });
    }

    @Test
    void grenadeTravelsThenArmsAfterItsOneSecondTravelPhaseWithoutCollision() {
        ArenaBounds arena = new ArenaBounds(1000, 800);
        ArenaEntity grenade = AbilityEntityFactory.create(
                "grenade-1", 4, 1, 500, 450, 60, 0, 1,
                Double.NaN, Double.NaN, arena.width(), arena.height());
        List<ArenaEntity> active = List.of(grenade);

        for (int tick = 0; tick < 9; tick += 1) {
            int elapsedMs = (tick + 1) * 100;
            active = active.stream().map(entity -> entity.withAgeMs(elapsedMs)).toList();
            active = AbilityEntitySystem.tick(active, List.of(), arena, 100, noDamageCombat());
            assertThat(active).singleElement().satisfies(entity -> {
                assertThat(entity.phaseId()).isEqualTo("travel");
                assertThat(Math.hypot(entity.velocityX(), entity.velocityY())).isEqualTo(32);
            });
        }

        active = active.stream().map(entity -> entity.withAgeMs(1_000)).toList();
        active = AbilityEntitySystem.tick(active, List.of(), arena, 100, noDamageCombat());
        assertThat(active).singleElement().satisfies(entity -> {
            assertThat(entity.phaseId()).isEqualTo("armed");
            assertThat(entity.phaseLocked()).isTrue();
            assertThat(entity.timerMs()).isEqualTo(1_000);
            assertThat(entity.velocityX()).isZero();
            assertThat(entity.velocityY()).isZero();
        });

        for (int tick = 0; tick < 9; tick += 1) {
            int elapsedMs = 1_100 + tick * 100;
            active = active.stream().map(entity -> entity.withAgeMs(elapsedMs)).toList();
            active = AbilityEntitySystem.tick(active, List.of(), arena, 100, noDamageCombat());
            assertThat(active).singleElement().satisfies(entity -> {
                assertThat(entity.phaseId()).isEqualTo("armed");
                assertThat(entity.timerMs()).isGreaterThan(0);
            });
        }

        active = active.stream().map(entity -> entity.withAgeMs(2_000)).toList();
        active = AbilityEntitySystem.tick(active, List.of(), arena, 100, noDamageCombat());
        assertThat(active).singleElement().satisfies(entity -> {
            assertThat(entity.phaseId()).isEqualTo("active");
            assertThat(entity.timerMs()).isEqualTo(100);
        });
    }

    @Test
    void gravityZoneTransitionsThroughDeclarativePhasesEvenWhenItCannotTranslate() {
        ArenaEntity gravity = new ArenaEntity("gravity", "gravityZone", 1, 500, 400,
                240, 0, 0, 0, 7_000, false, 0, 0, 1.0, 14, 0, 0);
        List<ArenaEntity> active = List.of(gravity);
        for (int tick = 0; tick < 19; tick += 1) {
            int elapsedMs = (tick + 1) * 100;
            active = active.stream().map(entity -> entity.withAgeMs(elapsedMs)).toList();
            active = AbilityEntitySystem.tick(
                    active, List.of(), new ArenaBounds(1000, 800), 100, noDamageCombat());
            ArenaEntity moving = active.getFirst();
            assertThat(moving.armed()).isFalse();
            assertThat(moving.type()).isEqualTo("gravityZone");
            assertThat(moving.phaseTimerMs()).isEqualTo((tick + 1) * 100);
        }
        assertThat(active.getFirst().traveled()).isZero();

        active = active.stream().map(entity -> entity.withAgeMs(2_000)).toList();
        ArenaEntity stopped = AbilityEntitySystem.tick(
                active, List.of(), new ArenaBounds(1000, 800), 100, noDamageCombat()).getFirst();
        assertThat(stopped.armed()).isTrue();
        assertThat(EntityContracts.phaseFor(stopped).id())
                .isEqualTo("fuse");
        assertThat(stopped.phaseTimerMs()).isZero();
        assertThat(stopped.velocityX()).isZero();
        assertThat(stopped.velocityY()).isZero();
    }

    @Test
    void hunterDronePursuesTargetsAtFourPointFiveUnitsPerTick() {
        ArenaEntity drone = createEntity("drone-1", 17, 100, 100, 0);
        TestCombatant target = new TestCombatant(2, 500, 100, 50, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(drone), List.of(target), new ArenaBounds(1000, 800), 100, noDamageCombat());

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.x()).isEqualTo(104.5);
            assertThat(entity.y()).isEqualTo(100);
        });
    }

    @Test
    void tetherBoltComposesDamagePullAndSlowThroughTheSegmentSystem() {
        TestCombatant owner = new TestCombatant(1, 100, 100, 60, 100);
        ArenaEntity bolt = AbilityEntityFactory.create(
                "tether-1", 28, 1, owner.x, owner.y, owner.size, 90, 1,
                Double.NaN, Double.NaN, 1000, 800);
        TestCombatant target = new TestCombatant(2, 180, 100, 60, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(bolt), List.of(owner, target), new ArenaBounds(1000, 800), 100, damageCombat());

        assertThat(result).isEmpty();
        assertThat(target.hp).isEqualTo(90);
        assertThat(target.slowedMs).isEqualTo(1_200);
        assertThat(target.x).isEqualTo(80);
    }

    @Test
    void staticSnareUsesItsStrongerPhaseWhenGenericDamageReachesZero() {
        ArenaEntity snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        AbilityEntitySystem.Combat<TestCombatant> destroyer = new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant bot, double amount) {}
            @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target, double amount, double sourceX, double sourceY) {}
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return 20; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return false; }
        };

        assertThat(AbilityEntitySystem.tick(
                List.of(snare), List.of(new TestCombatant(2, 800, 700, 60, 100)),
                new ArenaBounds(1000, 800), 100, destroyer)).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("staticSnare");
            assertThat(entity.phaseId()).isEqualTo("destroyed");
            assertThat(entity.visualEventType()).isNull();
            assertThat(entity.visualEventSize()).isZero();
            assertThat(entity.size()).isEqualTo(24);
        });
    }

    @Test
    void staticSnareTriggersSlowAndInterruptsWithoutChaining() {
        ArenaEntity snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        TestCombatant target = new TestCombatant(2, 140, 100, 60, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(snare), List.of(target), new ArenaBounds(1000, 800), 100, damageCombat());

        assertThat(target.hp).isEqualTo(85);
        assertThat(target.slowedMs).isEqualTo(2_200);
        assertThat(target.stunMs).isEqualTo(150);
        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("staticSnare");
            assertThat(entity.phaseId()).isEqualTo("triggered");
            assertThat(entity.visualEventType()).isNull();
            assertThat(entity.visualEventSize()).isZero();
            assertThat(entity.size()).isEqualTo(24);
        });
    }

    @Test
    void staticSnareUsesItsStrongerPhaseWhenAnyAttackDestroysIt() {
        ArenaEntity snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        TestCombatant owner = new TestCombatant(1, 100, 100, 60, 100);
        TestCombatant target = new TestCombatant(2, 210, 100, 60, 100);
        AbilityEntitySystem.Combat<TestCombatant> ownerAttack = new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant bot, double amount) {}
            @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target,
                                                  double amount, double sourceX, double sourceY) {
                target.hp -= amount;
            }
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots,
                                                List<ArenaEntity> entities) { return 20; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots,
                                                              List<ArenaEntity> entities) { return true; }
        };

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(snare), List.of(owner, target), new ArenaBounds(1000, 800), 100, ownerAttack);

        assertThat(owner.hp).isEqualTo(100);
        assertThat(target.hp).isEqualTo(80);
        assertThat(target.slowedMs).isEqualTo(3_000);
        assertThat(target.stunMs).isEqualTo(150);
        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("staticSnare");
            assertThat(entity.phaseId()).isEqualTo("destroyed");
            assertThat(entity.visualEventType()).isNull();
            assertThat(entity.visualEventSize()).isZero();
            assertThat(entity.size()).isEqualTo(24);
        });
    }

    @Test
    void staticSnareWaitsForADeadlyAttackBeforeDetonating() {
        ArenaEntity snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        TestCombatant attacker = new TestCombatant(2, 800, 700, 60, 100);
        AbilityEntitySystem.Combat<TestCombatant> nonlethalAttack = new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant bot, double amount) {}
            @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target,
                                                  double amount, double sourceX, double sourceY) {}
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots,
                                                List<ArenaEntity> entities) { return 5; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots,
                                                              List<ArenaEntity> entities) { return true; }
        };

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(snare), List.of(attacker), new ArenaBounds(1000, 800), 100, nonlethalAttack);

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("staticSnare");
            assertThat(entity.hp()).isEqualTo(15);
        });
    }

    @Test
    void staticSnareUsesItsStrongerPhaseWhenAnOpponentDestroysIt() {
        ArenaEntity snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1000, 800);
        TestCombatant owner = new TestCombatant(1, 100, 100, 60, 100);
        TestCombatant attacker = new TestCombatant(2, 140, 100, 60, 100);
        AbilityEntitySystem.Combat<TestCombatant> opponentAttack = new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant bot, double amount) {}
            @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target,
                                                  double amount, double sourceX, double sourceY) {
                target.hp -= amount;
            }
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots,
                                                List<ArenaEntity> entities) { return 20; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots,
                                                              List<ArenaEntity> entities) { return true; }
        };

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(snare), List.of(owner, attacker), new ArenaBounds(1000, 800), 100, opponentAttack);

        assertThat(owner.hp).isEqualTo(100);
        assertThat(attacker.hp).isEqualTo(80);
        assertThat(attacker.slowedMs).isEqualTo(3_000);
        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("staticSnare");
            assertThat(entity.phaseId()).isEqualTo("destroyed");
            assertThat(entity.visualEventType()).isNull();
            assertThat(entity.visualEventSize()).isZero();
            assertThat(entity.size()).isEqualTo(24);
        });
    }

    @Test
    void repellerDroneUsesTheHunterDroneBodyWithLowDamageAndKnockbackShots() {
        ArenaEntity drone = AbilityEntityFactory.create(
                "repeller-1", 31, 1, 100, 100, 60, 90, 1,
                Double.NaN, Double.NaN, 1000, 800);
        TestCombatant target = new TestCombatant(2, 180, 100, 60, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(drone), List.of(target), new ArenaBounds(1000, 800), 100, damageCombat());

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("hunterDrone");
            assertThat(entity.hp()).isEqualTo(50);
            assertThat(entity.x()).isEqualTo(104.5);
        });
        assertThat(target.hp).isEqualTo(97);
        assertThat(target.x).isGreaterThan(180);
    }

    @Test
    void windburstTravelsFiveTicksAndAppliesProjectileDamageAndKnockback() {
        TestCombatant owner = new TestCombatant(1, 100, 100, 60, 100);
        ArenaEntity projectile = AbilityEntityFactory.create(
                "windburst-1", 18, 1, owner.x, owner.y, owner.size, 90, 1,
                Double.NaN, Double.NaN, 1000, 800);
        List<ArenaEntity> active = List.of(projectile);
        for (int tick = 0; tick < 4; tick += 1) {
            active = AbilityEntitySystem.tick(active, List.of(owner), new ArenaBounds(1000, 800), 100, noDamageCombat());
            int expectedTravel = (tick + 1) * 44;
            assertThat(active).singleElement().satisfies(entity -> assertThat(entity.traveled()).isEqualTo(expectedTravel));
        }
        assertThat(AbilityEntitySystem.tick(active, List.of(owner), new ArenaBounds(1000, 800), 100, noDamageCombat())).isEmpty();

        TestCombatant target = new TestCombatant(2, 210, 100, 60, 100);
        RecordingCombat combat = new RecordingCombat(false);
        List<ArenaEntity> hit = AbilityEntitySystem.tick(
                List.of(projectile), List.of(owner, target), new ArenaBounds(1000, 800), 100, combat);
        assertThat(hit).isEmpty();
        assertThat(combat.damage).isEqualTo(20);
        assertThat(target.hp).isEqualTo(80);
        assertThat(target.x).isEqualTo(410);
    }

    @Test
    void genericSegmentHitboxesSweepAcrossABotDashSegment() {
        TestCombatant owner = new TestCombatant(1, 700, 100, 60, 100);
        TestCombatant target = new TestCombatant(2, 425, 432, 60, 100);
        target.movementStartX = 500.0;
        target.movementStartY = 432.0;
        ArenaEntity windburst = new ArenaEntity("windburst", "windburstProjectile", 1,
                500, 467.6, 12, 0, 0, 0, 1000, true);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(windburst), List.of(owner, target), new ArenaBounds(1000, 800), 100, damageCombat());

        assertThat(result).isEmpty();
        assertThat(target.hp).isLessThan(100);
    }

    @Test
    void gravityZonePullIncludesBotEdgeAtExactBoundaryAndExcludesJustBeyondIt() {
        ArenaBounds arena = new ArenaBounds(1000, 800);
        ArenaEntity gravity = new ArenaEntity("gravity", "gravityZone", 1, 100, 100,
                240, 0, 0, 0, 1000, true, 0, 0, 1.0, 14, 0, 0).withAgeMs(2_000);

        TestCombatant exactBoundary = new TestCombatant(2, 250, 100, 60, 100);
        AbilityEntitySystem.tick(List.of(gravity), List.of(exactBoundary), arena, 100, noDamageCombat());
        assertThat(exactBoundary.x).isBetween(243.9, 244.2);
        assertThat(exactBoundary.y).isEqualTo(100);

        TestCombatant justOutside = new TestCombatant(2, 250.1, 100, 60, 100);
        AbilityEntitySystem.tick(List.of(gravity), List.of(justOutside), arena, 100, noDamageCombat());
        assertThat(justOutside.x).isEqualTo(250.1);
        assertThat(justOutside.y).isEqualTo(100);
    }

    @Test
    void gravityZoneDetonationIncludesBotEdgeAtExactBoundaryAndExcludesJustBeyondIt() {
        ArenaBounds arena = new ArenaBounds(1000, 800);
        ArenaEntity gravity = new ArenaEntity("gravity", "gravityZone", 1, 100, 100,
                240, 0, 0, 0, 2_000, true, 0, 0, 1.0, 14, 0, 2_900).withAgeMs(5_000);

        TestCombatant exactBoundary = new TestCombatant(2, 250, 100, 60, 100);
        TestCombatant justOutside = new TestCombatant(2, 250.1, 100, 60, 100);
        RecordingCombat combat = new RecordingCombat(false);
        AbilityEntitySystem.tick(List.of(gravity), List.of(exactBoundary, justOutside), arena, 100, combat);

        assertThat(combat.damageCalls).isEqualTo(1);
        assertThat(justOutside.hp).isEqualTo(100);
    }

    @Test
    void singularityPullsDuringItsFuseAndDetonatesOnceThroughTheGenericZoneSystem() {
        ArenaBounds arena = new ArenaBounds(1000, 800);
        ArenaEntity singularity = AbilityEntityFactory.create(
                "singularity-1", 27, 1, 100, 100, 60, 0, 1,
                200, 100, arena.width(), arena.height());
        TestCombatant target = new TestCombatant(2, 300, 100, 60, 100);
        AbilityEntitySystem.Combat<TestCombatant> combat = damageCombat();
        List<ArenaEntity> entities = List.of(singularity);

        for (int tick = 0; tick < 11; tick++) {
            int elapsedMs = (tick + 1) * 100;
            entities = entities.stream().map(entity -> entity.withAgeMs(elapsedMs)).toList();
            entities = AbilityEntitySystem.tick(entities, List.of(target), arena, 100, combat);
        }
        assertThat(target.x).isLessThan(300.0);
        assertThat(target.hp).isEqualTo(100);

        entities = entities.stream().map(entity -> entity.withAgeMs(1_200)).toList();
        entities = AbilityEntitySystem.tick(entities, List.of(target), arena, 100, combat);
        assertThat(target.hp).isLessThan(100);
        assertThat(entities).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("singularityZone");
            assertThat(entity.phaseId()).isEqualTo("active");
            assertThat(entity.visualEventType()).isNull();
        });
        int hpAfterDetonation = target.hp;

        AbilityEntitySystem.tick(entities, List.of(target), arena, 100, combat);
        assertThat(target.hp).isEqualTo(hpAfterDetonation);
    }

    @Test
    void orbitalStrikePulsesFourTimesAtFiveTickIntervalsWithFlatDamage() {
        ArenaBounds arena = new ArenaBounds(1000, 800);
        ArenaEntity orbital = AbilityEntityFactory.create(
                "orbital-1", 22, 1, 100, 100, 60, 0, 1,
                200, 100, arena.width(), arena.height());
        TestCombatant target = new TestCombatant(2, 200, 100, 60, 100);
        RecordingCombat combat = new RecordingCombat(false);
        List<ArenaEntity> entities = List.of(orbital);

        for (int tick = 0; tick < 16; tick += 1) {
            entities = AbilityEntitySystem.tick(entities, List.of(target), arena, 100, combat);
        }

        assertThat(combat.damage).isEqualTo(60);
        assertThat(target.hp).isEqualTo(40);
        assertThat(entities).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("orbitalMarker");
            assertThat(entity.visualEventType()).isEqualTo("orbitalExplosion");
        });
        for (int tick = 0; tick < 2; tick += 1) {
            entities = AbilityEntitySystem.tick(entities, List.of(target), arena, 100, combat);
            assertThat(entities).singleElement();
        }
        assertThat(AbilityEntitySystem.tick(entities, List.of(target), arena, 100, combat)).isEmpty();
    }

    @Test
    void nullZoneIncludesBotEdgeAtExactBoundaryAndExcludesJustBeyondIt() {
        ArenaBounds arena = new ArenaBounds(1000, 800);

        TestCombatant exactBoundary = new TestCombatant(2, 480, 300, 60, 100);
        AbilityEntitySystem.tick(List.of(createEntity("zone-exact", 24, 300, 300, 0)),
                List.of(exactBoundary), arena, 100, noDamageCombat());
        assertThat(exactBoundary.zoneSilenced).isTrue();

        TestCombatant justOutside = new TestCombatant(2, 480.1, 300, 60, 100);
        AbilityEntitySystem.tick(List.of(createEntity("zone-outside", 24, 300, 300, 0)),
                List.of(justOutside), arena, 100, noDamageCombat());
        assertThat(justOutside.zoneSilenced).isFalse();
    }

    @Test
    void attackHitTriggersMineAndEmitsExplosion() {
        ArenaEntity mine = new ArenaEntity("mine-1", "proximityMine", 1, 100, 100,
                24, 0, 0, 176, 500, true);
        TestCombatant attacker = new TestCombatant(2, 500, 500, 50, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(mine), List.of(attacker), new ArenaBounds(1000, 800), 100,
                new AbilityEntitySystem.Combat<>() {
                    @Override public void damage(TestCombatant bot, double amount) { bot.hp -= amount; }
                    @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target, double amount, double sourceX, double sourceY) { target.hp -= amount; }
                    @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return 0; }
                    @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return true; }
                });

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.id()).isEqualTo("mine-1");
            assertThat(entity.type()).isEqualTo("proximityMine");
            assertThat(entity.phaseId()).isEqualTo("active");
            assertThat(entity.visualEventType()).isNull();
            assertThat(entity.visualEventSize()).isZero();
        });
    }

    @Test
    void proximityMineTriggersAndDamagesWithinIncreasedRadius() {
        ArenaEntity mine = new ArenaEntity("mine", "proximityMine", 1, 100, 100,
                24, 0, 0, 176, 500, true);
        TestCombatant target = new TestCombatant(2, 180, 100, 50, 100);
        RecordingCombat combat = new RecordingCombat(false);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(mine), List.of(target), new ArenaBounds(1000, 800), 100, combat);

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.id()).isEqualTo("mine");
            assertThat(entity.type()).isEqualTo("proximityMine");
            assertThat(entity.phaseId()).isEqualTo("active");
            assertThat(entity.visualEventType()).isNull();
            assertThat(entity.visualEventSize()).isZero();
            assertThat(entity.size()).isEqualTo(24);
        });
        assertThat(combat.damage).isEqualTo(25);
    }

    @Test
    void nullZoneSilenceClearsImmediatelyAfterLeavingWhileTimedSilenceRemainsSeparate() {
        ArenaEntity zone = createEntity("zone-1", 24, 300, 300, 0);
        TestCombatant target = new TestCombatant(2, 300, 300, 50, 100);
        AbilityEntitySystem.Combat<TestCombatant> combat = noDamageCombat();

        List<ArenaEntity> active = AbilityEntitySystem.tick(List.of(zone), List.of(target), new ArenaBounds(1000, 800), 50, combat);
        assertThat(target.zoneSilenced).isTrue();
        assertThat(target.silenceMs).isZero();

        target.x = 800;
        target.y = 700;
        AbilityEntitySystem.tick(active, List.of(target), new ArenaBounds(1000, 800), 50, combat);
        assertThat(target.zoneSilenced).isFalse();
        assertThat(target.silenceMs).isZero();
    }

    @Test
    void entityInteractionsApplyEffectsWithoutLegacyBlocking() {
        TestCombatant target = new TestCombatant(2, 150, 100, 50, 100);

        RecordingCombat mineCombat = new RecordingCombat(true);
        ArenaEntity mine = new ArenaEntity("mine", "proximityMine", 1, 100, 100, 24, 0, 0, 176, 500, true);
        AbilityEntitySystem.tick(List.of(mine), List.of(target), new ArenaBounds(1000, 800), 100, mineCombat);

        RecordingCombat gravityCombat = new RecordingCombat(false);
        ArenaEntity gravity = new ArenaEntity("gravity", "gravityZone", 1, 100, 100,
                240, 0, 0, 0, 2_000, true, 0, 0, 1.0, 14, 0, 2_900).withAgeMs(2_000);
        AbilityEntitySystem.tick(List.of(gravity), List.of(target), new ArenaBounds(1000, 800), 100, gravityCombat);

        RecordingCombat silenceCombat = new RecordingCombat(false);
        ArenaEntity silence = createEntity("silence", 15, 100, 100, 0);
        AbilityEntitySystem.tick(List.of(silence), List.of(target), new ArenaBounds(1000, 800), 100, silenceCombat);
        assertThat(target.silenceMs).isEqualTo(2_000);

        RecordingCombat droneCombat = new RecordingCombat(false);
        ArenaEntity drone = new ArenaEntity("drone", "hunterDrone", 1, 100, 100, 28, 1, 0, 0, 900, true, 50);
        List<ArenaEntity> droneEntities = AbilityEntitySystem.tick(
                List.of(drone), List.of(target), new ArenaBounds(1000, 800), 100, droneCombat);
        assertThat(droneCombat.damage).isEqualTo(5);
        assertThat(droneEntities).singleElement().satisfies(updatedDrone ->
                assertThat(updatedDrone.shotVisualMs()).isEqualTo(300));

        RecordingCombat orbitalCombat = new RecordingCombat(false);
        ArenaEntity orbital = new ArenaEntity("orbital", "orbitalMarker", 1, 150, 100, 260, 0, 0, 0, 100, true);
        AbilityEntitySystem.tick(List.of(orbital), List.of(target), new ArenaBounds(1000, 800), 100, orbitalCombat);
        assertThat(orbitalCombat.damage).isPositive();
    }

    @Test
    void radialEffectsIncludeBotEdgeContactAndExcludeAJustOutsideBot() {
        ArenaBounds arena = new ArenaBounds(1000, 800);
        TestCombatant orbitalTarget = new TestCombatant(2, 260, 100, 60, 100);
        RecordingCombat orbitalCombat = new RecordingCombat(false);
        ArenaEntity orbital = new ArenaEntity("orbital", "orbitalMarker", 1, 100, 100, 260, 0, 0, 0, 100, true);
        AbilityEntitySystem.tick(List.of(orbital), List.of(orbitalTarget), arena, 100, orbitalCombat);
        assertThat(orbitalCombat.damage).isEqualTo(15);
        assertThat(orbitalTarget.hp).isEqualTo(85);

        TestCombatant mineTarget = new TestCombatant(2, 217.5, 100, 60, 100);
        RecordingCombat mineCombat = new RecordingCombat(false);
        ArenaEntity mine = new ArenaEntity("mine", "proximityMine", 1, 100, 100, 24, 0, 0, 176, 500, true);
        AbilityEntitySystem.tick(List.of(mine), List.of(mineTarget), arena, 100, mineCombat);
        assertThat(mineCombat.damage).isEqualTo(25);
        assertThat(mineTarget.hp).isEqualTo(75);

        TestCombatant outsideTarget = new TestCombatant(2, 217.6, 100, 60, 100);
        RecordingCombat outsideCombat = new RecordingCombat(false);
        AbilityEntitySystem.tick(List.of(mine), List.of(outsideTarget), arena, 100, outsideCombat);
        assertThat(outsideCombat.damage).isZero();
        assertThat(outsideTarget.hp).isEqualTo(100);
    }

    @Test
    void absoluteGuardRejectsEveryHostileEntityMutationBeforeEffectApplication() {
        TestCombatant target = new TestCombatant(2, 150, 100, 50, 100);
        target.absoluteGuard = true;
        RecordingCombat combat = new RecordingCombat(false);
        ArenaBounds arena = new ArenaBounds(1000, 800);

        ArenaEntity silence = createEntity("silence", 15, 100, 100, 0);
        AbilityEntitySystem.tick(List.of(silence), List.of(target), arena, 100, combat);
        assertThat(target.silenceMs).isZero();
        assertThat(target.stunMs).isZero();

        ArenaEntity gravity = new ArenaEntity("gravity", "gravityZone", 1, 100, 100, 240, 0, 0, 176, 1000, false);
        AbilityEntitySystem.tick(List.of(gravity), List.of(target), arena, 100, combat);
        assertThat(target.x).isEqualTo(150);
        assertThat(target.y).isEqualTo(100);

        ArenaEntity zone = createEntity("zone", 24, 150, 100, 0);
        AbilityEntitySystem.tick(List.of(zone), List.of(target), arena, 100, combat);
        assertThat(target.zoneSilenced).isFalse();

        ArenaEntity mine = new ArenaEntity("mine", "proximityMine", 1, 100, 100, 24, 0, 0, 176, 500, true);
        ArenaEntity orbital = new ArenaEntity("orbital", "orbitalMarker", 1, 150, 100, 260, 0, 0, 0, 100, true);
        AbilityEntitySystem.tick(List.of(mine, orbital), List.of(target), arena, 100, combat);
        assertThat(combat.damage).isZero();
    }

    private static AbilityEntitySystem.Combat<TestCombatant> noDamageCombat() {
        return new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant bot, double amount) {}
            @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target, double amount, double sourceX, double sourceY) {}
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return 0; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return false; }
        };
    }

    private static ArenaEntity createEntity(String id, int abilityId, double x, double y, double rotation) {
        return AbilityEntityFactory.create(
                id, abilityId, 1, x, y, 60, rotation, 1, x, y, 1000, 800);
    }

    private static AbilityEntitySystem.Combat<TestCombatant> damageCombat() {
        return new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant bot, double amount) { bot.hp -= amount; }
            @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target, double amount, double sourceX, double sourceY) { target.hp -= amount; }
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return 0; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return false; }
        };
    }

    private static final class RecordingCombat implements AbilityEntitySystem.Combat<TestCombatant> {
        private final boolean entityHit;
        private double damage;
        private int damageCalls;

        private RecordingCombat(boolean entityHit) { this.entityHit = entityHit; }
        @Override public void damage(TestCombatant bot, double amount) { damage += amount; }
        @Override public void damageFromOwner(List<TestCombatant> bots, int ownerSlot, TestCombatant target, double amount, double sourceX, double sourceY) { damageCalls += 1; damage += amount; target.hp -= amount; }
        @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return 0; }
        @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> bots, List<ArenaEntity> entities) { return entityHit; }
    }

    private static final class TestCombatant implements AbilityEntityBot {
        private final int slot;
        private double x;
        private double y;
        private Double movementStartX;
        private Double movementStartY;
        private final int size;
        private int hp;
        private int silenceMs;
        private int slowedMs;
        private boolean zoneSilenced;
        private int stunMs;
        private boolean absoluteGuard;

        private TestCombatant(int slot, double x, double y, int size, int hp) {
            this.slot = slot;
            this.x = x;
            this.y = y;
            this.size = size;
            this.hp = hp;
        }

        @Override public int entitySlot() { return slot; }
        @Override public double entityX() { return x; }
        @Override public double entityY() { return y; }
        @Override public double entityMovementStartX() { return movementStartX == null ? x : movementStartX; }
        @Override public double entityMovementStartY() { return movementStartY == null ? y : movementStartY; }
        @Override public int entitySize() { return size; }
        @Override public double entityHp() { return hp; }
        @Override public boolean ignoresHostileEffects() { return absoluteGuard; }
        @Override public void setEntityPosition(double x, double y) { this.x = x; this.y = y; }
        @Override public void applySilence(int durationMs) { silenceMs = Math.max(silenceMs, durationMs); }
        @Override public void applySlow(int durationMs) { slowedMs = Math.max(slowedMs, durationMs); }
        @Override public void setZoneSilenced(boolean silenced) { zoneSilenced = silenced; }
        @Override public void applyStun(int durationMs) { stunMs = Math.max(stunMs, durationMs); }
        @Override public void applyInterrupt(int durationMs) { if (durationMs > 0) applyStun(durationMs); }
    }
}
