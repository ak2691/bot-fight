package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.geometry.AngleCalculator;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Mirrors frontend WeaponParity.test.js; keep both weapon tables identical. */
class WeaponHitboxParityTest {
    private static final double TARGET_RADIUS = 30;

    private record Weapon(int id, String name, String shape, double range, double arc,
                          double length, double width) {
        double reach() {
            return ("arc".equals(shape) ? range : length) + TARGET_RADIUS;
        }
    }

    private static final List<Weapon> WEAPONS = List.of(
            new Weapon(1, "Slash", "arc", 92, 120, 0, 0),
            new Weapon(35, "Thrust", "rectangle", 0, 0, 190, 30),
            new Weapon(36, "Cleave", "arc", 112, 160, 0, 0),
            new Weapon(37, "Smash", "rectangle", 0, 0, 125, 100));

    private final AbilityHitDetectionService detection = new AbilityHitDetectionService();

    private static Bot bot(double x, double y, double rotation, int size) {
        Bot bot = new Bot();
        bot.x = x;
        bot.y = y;
        bot.movementStartX = x;
        bot.movementStartY = y;
        bot.rotation = rotation;
        bot.size = size;
        return bot;
    }

    private boolean hits(Weapon weapon, Bot defender) {
        return detection.abilityHitsTarget(bot(100, 100, 90, 60), defender,
                AbilityExecutionPayload.forAbility(weapon.id()));
    }

    private static Bot atBearing(double distance, double bearing, int size) {
        double radians = AngleCalculator.compassRadians(bearing);
        return bot(100 + Math.cos(radians) * distance, 100 + Math.sin(radians) * distance, 270, size);
    }

    @Test
    void contractsMatchTheWeaponTable() {
        for (Weapon weapon : WEAPONS) {
            AbilityContracts.Hitbox hitbox = AbilityContracts.forAbility(weapon.id())
                    .phases().getFirst().hitbox();
            assertThat(hitbox.shape()).as(weapon.name()).isEqualTo(weapon.shape());
            assertThat(hitbox.includeTargetRadius()).as(weapon.name()).isTrue();
            if ("arc".equals(weapon.shape())) {
                assertThat(hitbox.range()).as(weapon.name()).isEqualTo(weapon.range());
                assertThat(hitbox.arc()).as(weapon.name()).isEqualTo(weapon.arc());
            } else {
                assertThat(hitbox.length()).as(weapon.name()).isEqualTo(weapon.length());
                assertThat(hitbox.width()).as(weapon.name()).isEqualTo(weapon.width());
            }
        }
    }

    @Test
    void targetJustInsideAndJustOutsideEffectiveReach() {
        for (Weapon weapon : WEAPONS) {
            double edge = weapon.reach();
            assertThat(hits(weapon, bot(100 + edge, 100, 270, 60))).as(weapon.name() + " at reach").isTrue();
            assertThat(hits(weapon, bot(100 + edge - 1, 100, 270, 60))).as(weapon.name() + " inside").isTrue();
            assertThat(hits(weapon, bot(100 + edge + 1, 100, 270, 60))).as(weapon.name() + " outside").isFalse();
            assertThat(hits(weapon, bot(100 - edge, 100, 270, 60))).as(weapon.name() + " behind").isFalse();
        }
    }

    @Test
    void sideEdgesFollowTheHitboxGeometry() {
        for (Weapon weapon : WEAPONS) {
            if ("rectangle".equals(weapon.shape())) {
                double side = weapon.width() / 2 + TARGET_RADIUS;
                double forward = 100 + weapon.length() / 2;
                for (int sign : new int[] {-1, 1}) {
                    assertThat(hits(weapon, bot(forward, 100 + sign * (side - 1), 270, 60)))
                            .as(weapon.name() + " side inside " + sign).isTrue();
                    assertThat(hits(weapon, bot(forward, 100 + sign * (side + 1), 270, 60)))
                            .as(weapon.name() + " side outside " + sign).isFalse();
                }
            } else {
                double half = weapon.arc() / 2;
                for (int sign : new int[] {-1, 1}) {
                    assertThat(hits(weapon, atBearing(80, 90 + sign * half, 20)))
                            .as(weapon.name() + " arc edge " + sign).isTrue();
                    assertThat(hits(weapon, atBearing(80, 90 + sign * (half + 12), 20)))
                            .as(weapon.name() + " arc outside " + sign).isFalse();
                }
            }
        }
    }
}
