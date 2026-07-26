package com.example.botfight.simulation.ecs;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;

class AbilityEntitySystemTest {
    @Test
    void factoryExposesHunterDroneHealthAsAComponent() {
        ArenaEntity drone = AbilityEntityFactory.hunterDrone("drone-1", 1, 100, 100, 0);

        assertThat(drone.hp()).isEqualTo(50);
        assertThat(drone.components().health().hp()).isEqualTo(50);
        assertThat(drone.components().ownership().ownerSlot()).isEqualTo(1);
    }

    @Test
    void hunterDronePursuesTargetsAtFourPointFiveUnitsPerTick() {
        ArenaEntity drone = AbilityEntityFactory.hunterDrone("drone-1", 1, 100, 100, 0);
        TestCombatant target = new TestCombatant(2, 500, 100, 50, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(drone), List.of(target), new ArenaBounds(1000, 800), 100, noDamageCombat());

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.x()).isEqualTo(104.5);
            assertThat(entity.y()).isEqualTo(100);
        });
    }

    @Test
    void attackHitTriggersMineAndEmitsExplosion() {
        ArenaEntity mine = new ArenaEntity("mine-1", "proximityMine", 1, 100, 100,
                24, 0, 0, 176, 500, true);
        TestCombatant attacker = new TestCombatant(2, 500, 500, 50, 100);

        List<ArenaEntity> result = AbilityEntitySystem.tick(
                List.of(mine), List.of(attacker), new ArenaBounds(1000, 800), 100,
                new AbilityEntitySystem.Combat<>() {
                    @Override public void damage(TestCombatant fighter, int amount) { fighter.hp -= amount; }
                    @Override public void damageFromOwner(List<TestCombatant> fighters, int ownerSlot, TestCombatant target, int amount) { target.hp -= amount; }
                    @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> fighters, List<ArenaEntity> entities) { return 0; }
                    @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> fighters, List<ArenaEntity> entities) { return true; }
                });

        assertThat(result).singleElement().satisfies(entity -> {
            assertThat(entity.type()).isEqualTo("mineExplosion");
            assertThat(entity.timerMs()).isEqualTo(300);
        });
    }

    @Test
    void nullZoneSilenceClearsImmediatelyAfterLeavingWhileTimedSilenceRemainsSeparate() {
        ArenaEntity zone = AbilityEntityFactory.nullZone("zone-1", 1, 300, 300);
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
    void entityShieldRulesUseExpectedArcsAndDrainPolicies() {
        TestCombatant target = new TestCombatant(2, 150, 100, 50, 100);

        RecordingCombat mineCombat = new RecordingCombat(true);
        ArenaEntity mine = new ArenaEntity("mine", "proximityMine", 1, 100, 100, 24, 0, 0, 176, 500, true);
        AbilityEntitySystem.tick(List.of(mine), List.of(target), new ArenaBounds(1000, 800), 100, mineCombat);
        assertThat(mineCombat.blocks).containsExactly(new BlockRequest(100, 100, "proximity_mine"));

        RecordingCombat gravityCombat = new RecordingCombat(false);
        ArenaEntity gravity = new ArenaEntity("gravity", "gravityField", 1, 100, 100, 240, 0, 0, 176, 3800, false);
        AbilityEntitySystem.tick(List.of(gravity), List.of(target), new ArenaBounds(1000, 800), 100, gravityCombat);
        assertThat(gravityCombat.blocks).containsExactly(new BlockRequest(100, 100, "gravity_grenade"));

        RecordingCombat silenceCombat = new RecordingCombat(false);
        ArenaEntity silence = AbilityEntityFactory.silenceWave("silence", 1, 100, 100, 0);
        AbilityEntitySystem.tick(List.of(silence), List.of(target), new ArenaBounds(1000, 800), 100, silenceCombat);
        assertThat(silenceCombat.blocks).containsExactly(new BlockRequest(100, 100, "silence_pulse"));
        assertThat(target.silenceMs).isZero();

        RecordingCombat droneCombat = new RecordingCombat(false);
        ArenaEntity drone = new ArenaEntity("drone", "hunterDrone", 1, 100, 100, 28, 1, 0, 0, 900, true, 50);
        List<ArenaEntity> droneEntities = AbilityEntitySystem.tick(
                List.of(drone), List.of(target), new ArenaBounds(1000, 800), 100, droneCombat);
        assertThat(droneCombat.blocks).singleElement().satisfies(request -> {
            assertThat(request.abilityId()).isEqualTo("hunter_drone");
        });
        assertThat(droneCombat.damage).isZero();
        assertThat(droneEntities).singleElement().satisfies(updatedDrone ->
                assertThat(updatedDrone.shotVisualMs()).isEqualTo(300));

        RecordingCombat orbitalCombat = new RecordingCombat(false);
        ArenaEntity orbital = new ArenaEntity("orbital", "orbitalMarker", 1, 150, 100, 260, 0, 0, 0, 100, true);
        AbilityEntitySystem.tick(List.of(orbital), List.of(target), new ArenaBounds(1000, 800), 100, orbitalCombat);
        assertThat(orbitalCombat.damage).isPositive();
        assertThat(orbitalCombat.drainCalls).isEqualTo(1);
    }

    @Test
    void absoluteGuardRejectsEveryHostileEntityMutationBeforeShieldHandling() {
        TestCombatant target = new TestCombatant(2, 150, 100, 50, 100);
        target.absoluteGuard = true;
        RecordingCombat combat = new RecordingCombat(false);
        ArenaBounds arena = new ArenaBounds(1000, 800);

        ArenaEntity silence = AbilityEntityFactory.silenceWave("silence", 1, 100, 100, 0);
        AbilityEntitySystem.tick(List.of(silence), List.of(target), arena, 100, combat);
        assertThat(target.silenceMs).isZero();
        assertThat(target.stunMs).isZero();

        ArenaEntity gravity = new ArenaEntity("gravity", "gravityField", 1, 100, 100, 240, 0, 0, 176, 1000, false);
        AbilityEntitySystem.tick(List.of(gravity), List.of(target), arena, 100, combat);
        assertThat(target.x).isEqualTo(150);
        assertThat(target.y).isEqualTo(100);

        ArenaEntity zone = AbilityEntityFactory.nullZone("zone", 1, 150, 100);
        AbilityEntitySystem.tick(List.of(zone), List.of(target), arena, 100, combat);
        assertThat(target.zoneSilenced).isFalse();

        ArenaEntity mine = new ArenaEntity("mine", "proximityMine", 1, 100, 100, 24, 0, 0, 176, 500, true);
        ArenaEntity orbital = new ArenaEntity("orbital", "orbitalMarker", 1, 150, 100, 260, 0, 0, 0, 100, true);
        AbilityEntitySystem.tick(List.of(mine, orbital), List.of(target), arena, 100, combat);
        assertThat(combat.damage).isZero();
        assertThat(combat.blocks).isEmpty();
        assertThat(combat.drainCalls).isZero();
    }

    private static AbilityEntitySystem.Combat<TestCombatant> noDamageCombat() {
        return new AbilityEntitySystem.Combat<>() {
            @Override public void damage(TestCombatant fighter, int amount) {}
            @Override public void damageFromOwner(List<TestCombatant> fighters, int ownerSlot, TestCombatant target, int amount) {}
            @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> fighters, List<ArenaEntity> entities) { return 0; }
            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> fighters, List<ArenaEntity> entities) { return false; }
        };
    }

    private record BlockRequest(double x, double y, String abilityId) {}

    private static final class RecordingCombat implements AbilityEntitySystem.Combat<TestCombatant> {
        private final boolean entityHit;
        private final List<BlockRequest> blocks = new ArrayList<>();
        private int damage;
        private int drainCalls;

        private RecordingCombat(boolean entityHit) { this.entityHit = entityHit; }
        @Override public void damage(TestCombatant fighter, int amount) { damage += amount; }
        @Override public void damageFromOwner(List<TestCombatant> fighters, int ownerSlot, TestCombatant target, int amount) { damage += amount; }
        @Override public int damageToEntity(ArenaEntity entity, List<TestCombatant> fighters, List<ArenaEntity> entities) { return 0; }
        @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<TestCombatant> fighters, List<ArenaEntity> entities) { return entityHit; }
        @Override public AbilityEntitySystem.ShieldResult shield(TestCombatant fighter, double sourceX, double sourceY, String abilityId) {
            blocks.add(new BlockRequest(sourceX, sourceY, abilityId));
            var policy = com.example.botfight.simulation.combat.AbilityContracts.get(abilityId).shieldInteraction();
            if (policy.mode() == com.example.botfight.simulation.combat.AbilityContracts.ShieldMode.DRAIN_WHILE_ACTIVE) drainCalls += 1;
            return new AbilityEntitySystem.ShieldResult(true, policy.prevents());
        }
    }

    private static final class TestCombatant implements AbilityEntityCombatant {
        private final int slot;
        private double x;
        private double y;
        private final int size;
        private int hp;
        private int silenceMs;
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
        @Override public int entitySize() { return size; }
        @Override public int entityHp() { return hp; }
        @Override public boolean ignoresHostileEffects() { return absoluteGuard; }
        @Override public void setEntityPosition(double x, double y) { this.x = x; this.y = y; }
        @Override public void applySilence(int durationMs) { silenceMs = Math.max(silenceMs, durationMs); }
        @Override public void setZoneSilenced(boolean silenced) { zoneSilenced = silenced; }
        @Override public void applyStun(int durationMs) { stunMs = Math.max(stunMs, durationMs); }
        @Override public void cancelPreparation() {}
    }
}
