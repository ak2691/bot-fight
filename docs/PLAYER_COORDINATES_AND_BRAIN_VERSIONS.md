# Player Coordinates and Brain Versions

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

## Brain coordinate semantics

`bot-logic-tree-v1` absolute coordinate fields use the historical internal
0…1200, top-left/Y-down values. Its Entity X and Entity Y variables also keep
their historical internal values. Its offsets, distances, bearings, and angle
conventions are unchanged.

New brains use `bot-logic-tree-v2`. V2 absolute condition and action targets
use player coordinates in −600…+600; signed offsets use the same public arena
magnitude bounds and invert Y at runtime. The runtime converts those targets
and offsets before they reach movement, rotation, targeting, or ability code.
V2 Entity X and Entity Y resolve to centered/Y-up values, including when read
as custom-variable operands. Distance, edge-distance, and angle/bearing values
retain their existing semantics. The version travels with each brain/runtime
instance; no mutable global coordinate mode is used. Newly authored tutorial
and practice presets use v2.

The server validates each schema version against its own coordinate ranges and
is authoritative for rated and puzzle simulations. Browser preview uses the
same version dispatch and conversions. A v1 brain opened in the editor keeps
v1 semantics and is not automatically relabeled or rewritten as v2; its
coordinate controls show the applicable axes and limits without a separate
legacy-brain notice.

## Persistence and puzzles

Brain submissions store the version in the brain payload and schema-version
column. Match-round bot-code history preserves the submission version and
payload. Existing submissions, historical records, replay/audit payloads, and
internal replay frames are not rewritten. New submissions default to v2 only
when the submitted brain itself is v2; a legacy payload remains v1.

Puzzle builder/API start positions and coordinate-bearing logic authored by
the current UI use centered/Y-up coordinates. The API requires the explicit
`centered-y-up-v1` coordinate-system marker and the server validates and
converts bot starts before saving. The `puzzle_bots.start_x` and `start_y`
database columns remain internal top-left/Y-down values. Existing rows are
therefore unchanged and are converted to public values when returned to the
builder. Puzzle attempts use the stored internal starts directly.

Puzzle outcome logic stores a `version` in `logicConfiguration`: v2 targets
are centered/Y-up, while v1 targets use historical internal coordinates.
Legacy puzzle configurations missing that discriminator are always interpreted
as v1. Flyway migration V56 writes that explicit v1 discriminator to existing
versionless puzzle logic JSON; the editor also defaults any such legacy value
to v1 before saving. Existing opponent brain payloads retain their own brain
version and execute unchanged. The migration does not rewrite stored starts or
outcomes because puzzle start columns remain internal and legacy conditions
keep their v1 interpretation.

Browser practice-room storage moved to revision 3. Older stored starts are
treated as internal coordinates and converted once on load; new revision-3
values are public coordinates. Tutorial storage revision is also bumped so the
updated lesson sequence and presets are applied consistently.

## Parity obligations

When coordinate-bearing brain fields or state variables change, update the
browser and server conversion paths together. Keep the schema version attached
to the brain through normalization, validation, execution, and persistence.
Keep geometry, authoritative replay frames, and renderer positions internal;
convert only at explicit input and display boundaries. Add paired tests for
coordinate helpers, v1/v2 brain behavior, puzzle round trips, and browser/server
agreement before changing this contract.
