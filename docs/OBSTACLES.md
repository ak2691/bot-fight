# Obstacles: arena layouts, physics and movement

Status: **shelved 2026-10-11.** Obstacles add a decision about the map rather
than about combat. Kept for reference. The part still wanted is the sight
vocabulary: `In View [from → to, arc]` replacing Angle To and Direction To
(section 5), with Approach Angle kept. Without obstacles, In View reduces to
the arc check.

## 1. Why obstacles exist

Matches differ only by loadout today, so a matchup can be solved once and copied
("round 1, Tether Bolt + Hammer vs Thrust + Windblast"). The fix is to **vary
the situation, never the tools**. Ability values and bot stats stay fixed, so
what an ability does never changes. What changes is the space the fight happens
in: a few seeded, symmetric obstacles per match, shown to both players before
they choose their loadout.

A brain that hard-codes coordinates or timings breaks on a new layout. A brain
written in terms of the opponent, line of sight and distance keeps working.
That moves the skill from remembering a solution to understanding one.

### Failure modes this design must avoid

| Failure | What it looks like | Guard in this design |
| --- | --- | --- |
| Nuisance | Obstacles add rules to work around but no decisions | Obstacles block attacks, so cover, peeking and ambushes are real decisions (section 4) |
| Expert-only | Valuable, but only usable with heavy geometry code | Walk finds its own path; one condition (`In View`) captures most of the value (section 7) |
| Attention hog | Players must think about walls more than the fight | 5 pieces at most, ≤ 8% of the arena, open lanes everywhere, measured targets (section 8) |

### Principles

- **Fixed tools.** No obstacle changes a number on an ability or a bot.
- **Minimal vocabulary.** Obstacles add one sensor and one distance, and remove
  two angle sensors. No new actions, movement modes, selectables or regions.
- **Zero code still works.** A brain with no obstacle logic paths around walls
  and fights. It just plays worse than one that uses cover.
- **One rule per question.** "Can they see me?" and "can they hit me?" are the
  same test (section 4.3). Movement against walls is one function (section 9).

## 2. Layout

### Shapes

Obstacles are **convex polygons (3–8 vertices, integer coordinates) and
circles**. Rotated rectangles, hexagons, wedges and slabs all fit. Concave
shapes (L, U) are left out: pockets trap bots and complicate pathing. If they're
wanted later, an L is two convex pieces that touch, and every rule here still
applies piece by piece.

### Constraints

Arena 1200 × 1200, bot radius 30, spawns at (600, 150) and (600, 1050).

| Rule | Value | Why |
| --- | --- | --- |
| Pieces | 1–5 (an optional centre piece plus up to 2 mirrored pairs) | Places to fight around, not a maze |
| Total area | ≤ 8% of the arena (≈ 115,000 units²) | Most of the arena stays open |
| Thinnest width | ≥ 90 | A bot (60 wide) can fully hide; melee reach through a wall stays out of range (see 4.4) |
| Largest dimension | ≤ 300 | No arena-splitting walls |
| Gap between pieces, and to the arena edge | ≥ 120 | Two bot widths: no corridors that jam pathing, no dead-end pockets |
| Spawn clearance | No piece within 150 of a spawn | Fair, readable openings |
| Final zone | At least one piece overlaps the 300-radius centre circle (the last zone size) | Cover still matters in the late rounds, when HP is lowest |

### Symmetry

Every layout has **point symmetry about the arena centre**: a piece at `p`
always has a twin at `(1200, 1200) − p`, rotated 180°. The 180° rotation maps
each spawn onto the other, so both players face the same map from their own
side. A centre piece must itself be point-symmetric (a circle, rectangle or
hexagon centred on the middle).

### Families and seeds

A layout is a **family** (hand-designed) plus **seeded parameters** (position,
size, rotation and count within the family's limits). Families keep maps
readable ("this is a lanes map"), and seeds keep exact layouts from being
memorised.

| Family | Shape of the fight |
| --- | --- |
| Pillar | One centre piece, optionally one small mirrored pair. Ring-around and corner ambushes |
| Lanes | One mirrored pair of slabs left and right of centre. Long sightlines down the middle, cover at the sides |
| Scatter | Two mirrored pairs of small rocks. Short breaks in sight everywhere, no single hiding place |
| Broken ring | Two mirrored pairs placed around the centre with gaps. A contested middle |

Generation: pick the family from the seed, draw parameters with a seeded integer
generator, round every vertex to integers, check the constraints, and redraw on
failure (a fixed number of attempts, then the family's hand-made default). The
same seed always gives the same layout.

The map is shown before loadout selection, so players counter-pick: open lanes
favour ranged, a dense middle favours melee. Saved brains are written without
knowing the map, which rewards brains built on sensors over brains built on
coordinates.

## 3. Bodies

Bots are circles. Obstacles are solid: **a bot's body never overlaps an
obstacle.**

All movement is tested along its whole path (swept), never just at the end
point. That stops fast movers from passing through walls: a dash covers 75
units per tick and some projectiles 150.

| Movement | On contact with an obstacle |
| --- | --- |
| Your own movement (Walk, Sprint, Dash) | **Slides**: the part going into the wall is removed and the rest carries on along the surface |
| Being moved (knockback, pull) | **Stops** at the wall |
| Placements (blink and mirror landings, entities spawned into a wall) | Lands at the **last free point** on the line it came along |

Walking slides so movement stays smooth and a glancing wall never wastes a dash.
Knockback stops so "pushed into a wall" reads as an impact. A future ability can
add a wall-slam effect on that contact. The arena edge follows the same rules,
so it stops being a separate clamp.

Bots still pass through each other (unchanged). The closing zone ignores
obstacles.

## 4. Attacks and sight

### 4.1 Things that travel stop at walls

- **Projectiles** end on touching an obstacle and run their `lifetimeEnd`
  event, so an explode-on-end projectile bursts at the wall. This reuses an
  existing event; there's no new wall event.
- **Seeking projectiles** don't path around walls. Putting a wall between you
  and a seeker is the counterplay.
- **Rays** are cut at the first obstacle on their centre line.
- **Links between two things** (tethers) snap when their line is blocked. This
  is the default rule; review it per ability.

### 4.2 Areas need line of sight from their origin

Circles, arcs and rectangles from a `hit` verb, and area effects from entities,
reach a target only if the hit's origin can **see** it (4.3). The origin is the
bot's or entity's centre. An explosion at a wall face doesn't reach the far
side.

### 4.3 The sight test (the answer to "half the hitbox is covered")

Hitboxes are **not cut** geometrically. Clipping an arc by a wall's shadow is
expensive, and players can't predict it from the screen. Instead, each target
is tested:

> Two circles can **see** each other if a clear straight line runs between any
> sample point of one and any sample point of the other. A circle's sample
> points are its centre and two points 15 units either side of the centre,
> across the line between them. A point (a radius-0 entity) has one sample
> point: itself.

So a bot showing more than a sliver of its middle is visible and hittable, and
a bot hidden apart from the very edge is safe. **Half-covered means hit**:
hiding requires the whole body. The 15-unit offset is the one tuning knob for
how forgiving peeking is.

The test is **symmetric**: if I can see you, you can see me. There's no
"peeker's advantage" to explain. It uses the raw obstacle shapes, and costs 9
segment checks against at most 5 pieces.

**The same test drives the `In View` sensor and every area hit.** If `In View`
says they can see you, they can hit you (when in range). That one sentence is
the whole rule a player needs.

### 4.4 Timing: hits are checked on release

`onActivate` verbs already run when the wind-up ends, so sight is checked at
release, not at the start of the wind-up. **Breaking line of sight during an
opponent's wind-up dodges it.** They spend the cooldown and stamina, and you
don't. This is where melee-vs-melee depth comes from: bait a wind-up, step
behind the wall, punish the whiff.

Because walls are at least 90 thick and bots 60 wide, two bots on opposite faces
of a wall are at least 150 apart. Melee reach is length or range plus 30: about
145 for a 115-long box, so straight `Distance` rarely puts ordinary melee "in
range" through a wall. Long reaches (Thrust's 190-long box, about 220) can be,
and will whiff without an `In View` check. A naive brain mostly whiffs at
corners and with long reaches, which are the lessons worth learning.

## 5. Brain vocabulary

### Added

| Sensor | Meaning |
| --- | --- |
| **In View** `[from] → [to]`, arc (default 360°) | Nothing blocks the line between them (4.3), and `to` is within the arc centred on `from`'s facing. 360° asks "can they see me at all?", and a small arc asks "are they aiming at me?" An arc on something with no facing is ignored |
| **Path Distance** `[from] → [to]` | Walking distance around obstacles; equals `Distance` when nothing is in the way |

Use `Distance` for attack ranges (hitboxes are straight-line) and `Path
Distance` for "when do they arrive" (ambush timing).

### Removed

`Angle To` (`selectable.relativeBearing`) and `Direction To`
(`selectable.absoluteBearing`). In View with an arc covers their uses:

| Old | New |
| --- | --- |
| Am I facing them? | In View me → opponent, 30° |
| Are they aiming at me? | In View opponent → me, 30° |
| Are they behind me? | NOT In View me → opponent, 180° |

`Approach Angle` stays: "are they moving at me?" isn't a sight question, and
advanced obstacle play needs it (appendix). Removing fields from
`brain.schema.json` needs a migration for saved brains.

### Deliberately not added

No obstacle selectable, cover region, hiding spot, circling mode or
left/right path option. Each was considered and dropped: they add concepts
without adding decisions that the parts above can't already express.

## 6. Movement

Walk is unchanged in shape: target, coordinates or absolute mode, a direction
setting and Sprint. Obstacles change two things.

**Walk toward a target or coordinates at 0° uses pathfinding.** Every tick the
bot follows the shortest path to where the target is now. No obstacle in the
way means a straight line. When one is in the way, the path bends around
whichever side is shorter at that moment, and switches as soon as the other side
becomes shorter. On an exact tie it keeps its current side. There is no hidden
commitment margin. A target wiggling on the tie line can make a chaser
hesitate; sprinting or dashing through is the answer, and it's a skill rather
than a rule.

**Any other direction, and absolute mode, is plain steering.** Move in that
relative or compass direction and slide along walls you touch. Strafing stays
predictable and fully under the player's control, and Dash stays a straight
line.

Nothing else is automatic. Hugging, circling and hiding come from combining
plain steering, wall sliding and `In View` (appendix). They're possible but
optional, which is where obstacle play should sit.

### Pathfinder

- **Visibility graph:** grow each obstacle by the bot radius plus 2. Circles
  become 16-sided polygons. The graph's nodes are the grown corners.
- Corner-to-corner visibility is **computed once per match**, since obstacles
  never move. Each tick only adds the bot and its goal: about 2 × 40 nodes ×
  40 edges in the worst case.
- A* with a straight-line heuristic, ties broken by node index. The bot keeps
  its last first waypoint for the exact-tie rule.
- A goal inside a grown obstacle (a bot hugging a wall) is moved to the
  nearest free point.
- The path length is `Path Distance`, so there's no second calculation.

## 7. Usability: low floor, high ceiling

| Level | What the player writes | What they get |
| --- | --- | --- |
| 0 | Nothing new | Walk paths around walls; attacks sometimes hit walls |
| 1 | Add `In View` to attack rules | No wasted wind-ups. **Most of the value, from one condition** |
| 2 | `Path Distance` for corner ambushes; sprint when spotted | Timing advantages |
| 3 | Bait wind-ups and break sight; ring-around (appendix) | Expert play |

Supporting tools:

- **Preview and replay overlays:** draw the bot's current path as a faint line,
  and the sight line between bots (solid when In View, hidden when not). Players
  see exactly when the path switches sides and why a hit missed.
- **Combat log `blocked` event** when a wall stops a hit or projectile, naming
  the obstacle. Replays explain whiffs.
- **Training against several map seeds:** run the same brain on N layouts and
  report results per layout. Robustness becomes a visible, improvable skill.
- **Tutorial preset:** the default attack rule includes `In View`.

## 8. Balance and fun targets

Measure these with `engineBenchmark.js` over many seeds per family before
shipping. Adjust the sizes, counts and the 15-unit sight offset, not the rules.

| Metric | Target | If missed |
| --- | --- | --- |
| Obstacle-aware brain vs the same brain without obstacle logic, same loadout | 60–70% wins for aware | Under: obstacles too small or sparse. Over: too punishing for casual players |
| Share of match time the bots can't see each other | 15–35% | Over 40%: too much hiding, not enough fighting |
| One loadout's win rate across families | Within ±10 points of its overall rate | One family decides matchups; reshape or drop it |
| Rounds with no hits while one bot hides | Rare | Stalling; tighten the zone or the final-zone cover rule |

Expected shifts to watch:

- **Melee gains** from cover and corners; ranged loses free chip damage. The
  map reveal before loadout is the release valve.
- **Seekers and explosions lose value** against cover; walls are their
  counterplay.
- **Stalling:** a bot ahead on HP can hide, but sprint, dash and the zone
  (900 at 60 s, 600 at 75 s) force the issue, and the final-zone rule keeps the
  cover inside the fight.

Future ability hooks (not part of this proposal) come from the new vocabulary:
wall-slam on knockback contact, shots that ignore sight (lobbed), rays that
bounce, temporary walls.

## 9. Engine shape (DRY)

One module, e.g. `shared/engine/arena/obstacles.js`, owns all obstacle
geometry:

| Function | Used by |
| --- | --- |
| `generateLayout(seed)` | The match setup; the browser for the map reveal and previews |
| `moveBody(body, dx, dy, world, { slide })` | Walk and Sprint (`ActionExecutionSystem.js`), Dash (`ActionExecutionSystem.js`, `verbs.js` `move`), `displace` in `effects.js`. **It replaces the three separate arena clamps** |
| `placeBody(from, to, world)` | Blink and mirror landings, entity spawns (last free point) |
| `canSee(circleA, circleB, world)` | The `In View` sensor, `findTargets.js` area hits, summon aiming |
| `segmentHit(a, b, radius, world)` | Projectile movement, ray cutting, tether snapping |
| `findPath(from, to, world, memory)` | The Walk planner (`movementVector` in `ArenaActionPlanner.js`) and `Path Distance` |

**Authority and determinism.** `simulateFight` already validates a `seed` it
doesn't use; the layout is generated from it inside the shared engine, so
browser previews and the worker build the same map. The client never sends a
layout. Spring passes the seed it chose, and Java implements no geometry. The
replay stores the **generated layout** as well as the seed, so audits never
depend on the generator version. Vertices are integers; add golden scenarios
with a fixed layout so any change to collision or pathing shows up in the diff.

## 10. Rollout

1. **Physics on one hand-made Pillar layout:** `moveBody`, `canSee`, projectile
   and ray blocking, `In View`, removing the two angle sensors, the `blocked` log
   event, golden scenarios. Then run the first benchmark: is this fun before
   anything else is built?
2. **Pathfinding:** Walk at 0°, `Path Distance`, the path and sight overlays.
3. **Generation:** the families, seeds and constraint checks, the map shown
   before loadout, training across seeds.
4. **Tuning** against section 8, then the ability hooks.

## Appendix: advanced techniques with the base vocabulary

These show the vocabulary is enough. None of it is required to play.

**Corner ambush.** Wind up so the swing releases as they round the corner:

```text
IF NOT In View (opponent → me, 360°) AND Path Distance (opponent → me) < [wind-up time × their speed + reach]
    → Hammer
```

**Ring-around a pillar.** Walk at about 60° relative to the opponent while the
pillar is between you. The "toward" part presses into the pillar, and sliding
carries you along its face. Being seen has two causes needing opposite
responses, so tell them apart:

```text
IF In View (opponent → me, 360°) AND Approach Angle (opponent → me) < 45°
    → caught from behind: don't reverse. Sprint away (Walk relative to opponent, ~180°) or turn and fight
IF In View (opponent → me, 360°) AND custom.seen = 0 AND NOT the case above
    → overran the edge: custom.side add 1, modulo 2; custom.seen set 1
IF NOT In View (opponent → me, 360°)  → custom.seen set 0
IF custom.side = 0                    → Walk relative to opponent, 60°
IF custom.side = 1                    → Walk relative to opponent, 300°
```

It's reactive: each reversal leaks a moment of exposure that a sharp opponent
can punish. A perfect loop shouldn't be free.
