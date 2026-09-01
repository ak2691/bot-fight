package com.example.botfight.simulation.geometry;

/** Shared virtual arena dimensions. Gameplay coordinates are not browser pixels. */
public final class ArenaUnits {

    public static final int WIDTH = 1_200;
    public static final int HEIGHT = 1_200;
    /** Fixed world-unit inset used for the opposing team spawn rows. */
    public static final int SPAWN_EDGE_MARGIN = 150;

    private ArenaUnits() {
    }
}
