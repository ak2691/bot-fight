# Player Coordinates

## Coordinate systems

Player authoring and display use centered, Y-up arena coordinates. The arena is
1200 × 1200 units, with X and Y each spanning −600 through +600. X increases
to the right and Y increases upward. Bot centers are limited to −570 through
+570 on each axis because each bot has a 30-unit radius.

The simulation, ECS, collision geometry, Pixi stage, and replay frames continue
to use the existing top-left, Y-down coordinates from 0 through 1200. Convert
points only at player-facing boundaries:

```text
publicX = internalX - 600
publicY = 600 - internalY
internalX = publicX + 600
internalY = 600 - publicY
```

Offsets and vectors have no origin translation; only their vertical sign
changes:

```text
internalOffsetX = publicOffsetX
internalOffsetY = -publicOffsetY
```

Distances are unchanged. Compass and rotation conventions are also unchanged:
0° is up/north, 90° right/east, 180° down/south, 270° left/west, and positive
angles turn clockwise.

## Brain coordinates

There is one brain format, `bot-logic-tree-v2` (`BOT_LOGIC_TREE_VERSION`; the schema accepts no
other). Absolute condition and action targets use player coordinates in −600…+600
(`COORDINATE_LIMITS` in `botlogic/code/configuration/constants.js`); signed offsets use the same
magnitude and invert Y at runtime. The runtime converts targets and offsets before they reach
movement, rotation, targeting or ability code. Entity X and Entity Y resolve to centered/Y-up values,
including as custom-variable operands. Distances, edge distances and angles are unchanged.

The 2026-10 reset removed the old `bot-logic-tree-v1` format (internal 0…1200 coordinates) and every
migration for it: saved brains, puzzle logic and browser drafts from before the reset are not read.

## Persistence and puzzles

Puzzle builder/API start positions and outcome logic use centered/Y-up coordinates. The API requires
the `centered-y-up-v1` coordinate-system marker; the server validates and converts bot starts before
saving. The `puzzle_bots.start_x`/`start_y` columns hold internal top-left/Y-down values and are
converted to public values when returned to the builder. Puzzle attempts use the stored internal
starts directly.

## Parity obligations

When coordinate-bearing brain fields or state variables change, update the browser and server
conversion paths together. Keep geometry, replay frames and renderer positions internal; convert only
at explicit input and display boundaries.
