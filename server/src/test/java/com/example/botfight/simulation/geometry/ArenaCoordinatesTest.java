package com.example.botfight.simulation.geometry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ArenaCoordinatesTest {
    @Test
    void publicAndInternalPointsRoundTripAtCenterAndCorners() {
        for (double x : new double[] {-600, 600}) {
            for (double y : new double[] {-600, 600}) {
                ArenaCoordinates.Point internal = ArenaCoordinates.toInternal(x, y);
                ArenaCoordinates.Point restored = ArenaCoordinates.toPublic(internal.x(), internal.y());
                assertEquals(x, restored.x());
                assertEquals(y, restored.y());
            }
        }
        assertEquals(new ArenaCoordinates.Point(600, 600), ArenaCoordinates.toInternal(0, 0));
        assertEquals(new ArenaCoordinates.Point(600, 150), ArenaCoordinates.toInternal(0, 450));
        assertEquals(new ArenaCoordinates.Point(600, 1050), ArenaCoordinates.toInternal(0, -450));
    }

    @Test
    void offsetsFlipOnlyYAndDistanceIsInvariant() {
        ArenaCoordinates.Offset internal = ArenaCoordinates.offsetToInternal(20, 30);
        assertEquals(new ArenaCoordinates.Offset(20, -30), internal);
        ArenaCoordinates.Offset restored = ArenaCoordinates.offsetToPublic(internal.x(), internal.y());
        assertEquals(new ArenaCoordinates.Offset(20, 30), restored);
        assertEquals(Math.hypot(20, 30), Math.hypot(internal.x(), internal.y()));
    }

    @Test
    void serverCoordinateBoundaryPredicatesRejectInvalidInputs() {
        assertTrue(ArenaCoordinates.isPublicCoordinate(-600));
        assertTrue(ArenaCoordinates.isPublicCoordinate(600));
        assertFalse(ArenaCoordinates.isPublicCoordinate(Double.NaN));
        assertFalse(ArenaCoordinates.isPublicCoordinate(Double.POSITIVE_INFINITY));
        assertFalse(ArenaCoordinates.isPublicCoordinate(600.1));
        assertTrue(ArenaCoordinates.isPublicBotCenterCoordinate(-570));
        assertTrue(ArenaCoordinates.isPublicBotCenterCoordinate(570));
        assertFalse(ArenaCoordinates.isPublicBotCenterCoordinate(-570.1));
    }
}
