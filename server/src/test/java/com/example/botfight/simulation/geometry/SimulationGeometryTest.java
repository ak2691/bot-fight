package com.example.botfight.simulation.geometry;

import static org.assertj.core.api.Assertions.assertThat;

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
}
