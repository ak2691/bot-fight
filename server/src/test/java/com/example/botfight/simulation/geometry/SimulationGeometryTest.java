package com.example.botfight.simulation.geometry;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import org.junit.jupiter.api.Test;

class SimulationGeometryTest {
    @Test
    void compassCalculationsUseArenaNorthAndShortestTurns() {
        assertThat(AngleCalculator.compassBearing(0, 0, 10, 0)).isEqualTo(90);
        assertThat(AngleCalculator.shortestDelta(350, 10)).isEqualTo(20);
        assertThat(AngleCalculator.normalizeDegrees(-10)).isEqualTo(350);
    }

    @Test
    void distanceAndIntersectionCalculationsRemainPure() {
        assertThat(DistanceCalculator.between(0, 0, 3, 4)).isEqualTo(5);
        assertThat(DistanceCalculator.segmentIntersectsCircle(0, 0, 10, 0, 5, 1, 1)).isTrue();
        assertThat(DistanceCalculator.rayIntersectsCircle(0, 0, 1, 0, 10, 8, 0, 1)).isTrue();
    }

    @Test
    void sectorCollisionUsesTheTargetCircleNotOnlyItsCenterBearing() {
        assertThat(DistanceCalculator.segmentIntersectsSector(
                0, 0, 0, -10, 0, -10, 180, 80, 15, 30)).isTrue();
        assertThat(DistanceCalculator.segmentIntersectsSector(
                0, 0, 60, 20, 60, 20, 90, 80, 15, 30)).isTrue();
        assertThat(DistanceCalculator.segmentIntersectsSector(
                0, 0, 0, -60, 0, -60, 180, 80, 15, 10)).isFalse();
    }

    @Test
    void rectangleCollisionUsesTheSquareFootprintInsteadOfACircularFootprint() {
        DistanceCalculator.MovingCircleCollision square = DistanceCalculator.movingRectangleCollision(
                0, 0, 0, 0, 20, 20, 0,
                9, 9, 9, 9, 0);
        DistanceCalculator.MovingCircleCollision circle = DistanceCalculator.movingCircleCollision(
                0, 0, 0, 0, 10,
                9, 9, 9, 9, 0);

        assertThat(square.hit()).isTrue();
        assertThat(circle.hit()).isFalse();
    }

    @Test
    void abilityRectangleCollisionUsesIndependentHitboxLengthAndWidth() {
        ArenaEntity silenceWave = new ArenaEntity(
                "silence", "silence_wave", 1, 0, 0, 225,
                1, 0, 0, 1200, true, 0, 0, 1, 15);

        assertThat(EntityHitbox.movingAgainstCircle(
                silenceWave, 0, 0, 0, 0,
                115, 0, 115, 0, 30).hit()).isTrue();
        assertThat(EntityHitbox.movingAgainstCircle(
                silenceWave, 0, 0, 0, 0,
                0, 110, 0, 110, 30).hit()).isFalse();
    }
}
