# 07 Arenas, Twists and Content

Variety is what keeps a solved bot from staying solved. This doc covers what arenas are made of, how rules
change from contest to contest, how content rotates, and how most of it is produced and checked automatically.

## Arena format

Arenas are data in `shared/content/arenas/`, validated by a shared schema.

```json
{
  "schema": "arena/1",
  "id": "the-pit", "name": "The Pit", "version": 1,
  "boundary": { "kind": "walls", "polygon": [[-7,-7],[7,-7],[7,7],[-7,7]], "spikedSegments": [] },
  "obstacles": [ { "kind": "pillar", "x": 3, "y": 3, "r": 0.5 } ],
  "crates": [],
  "hazards": [
    { "kind": "pit", "rect": [-1, -1, 1, 1], "opensAt": 60 },
    { "kind": "saw", "rect": [-3, 3.2, 3, 3.8], "schedule": { "firstUp": 20, "upFor": 5, "every": 15 } }
  ],
  "spawns": [
    { "a": { "x": -5, "y": 0, "angle": 0 }, "b": { "x": 5, "y": 0, "angle": 180 } },
    { "a": { "x": -4, "y": -4, "angle": 45 }, "b": { "x": 4, "y": 4, "angle": 225 } }
  ],
  "safeSpot": { "x": 0, "y": -4 },
  "symmetry": "point"
}
```

- **Boundary:** `walls` (a polygon, some segments optionally spiked) or `ringOut` (a platform polygon or circle
  with no walls; leaving it is a KO).
- **Symmetry:** every competitive arena is point-symmetric (a 180° turn about the centre maps it onto itself),
  so the two spawns are equivalent. Cup games also swap spawns.
- **Spawns:** one or more layouts. A game is an *arena setup*: arena + spawn layout ([08](08-competition.md#match-format)).
- **Schedules** are in seconds from the start, and both bots know them (built-in map knowledge).

## Hazards and obstacles

### MVP

| Element | What it does | Why it's fun |
|---|---|---|
| **Pit** | Opens at a set time; a bot whose centre is inside (and not airborne) is knocked out | Instant stakes; makes flips and pushes deadly; forces late action |
| **Floor saw** | Rises on a schedule; while up, overlapping bots take 15 HP/s, ignoring plates | Timing and pushing; damages any build |
| **Spiked wall** | Wall impacts deal ×2 + 4 | Slams become a weapon |
| **Pillar** | Static circle; blocks movement and sight | Cover, ambushes, hide-and-seek with sensors |
| **Block** | Static rectangle; blocks movement and sight | Lanes and corners |
| **Crate** | 30 kg pushable box; doesn't block sight | Shields, missiles, Academy puzzles |
| **Ring-out edge** | No walls; leaving the platform is a KO | Sumo: pure pushing and positioning |

### Later

Turntable (a spinning floor disc that drags bots), arena hammer (a periodic strike zone that pins), flame jets,
conveyors, bumpers (bouncy walls), moving walls, a king-of-the-hill zone, a ball and goals.

## MVP arenas

| Arena | Layout | Character |
|---|---|---|
| **The Box** | 14 × 14 m, plain walls | The baseline: pure fighting |
| **The Pit** | 14 × 14 m, central 2 × 2 m pit opening at 60 s | Calm first half, deadly second half |
| **Saw Alley** | 14 × 14 m, two saw strips cycling from 20 s; spiked east and west walls | Pushing and timing |
| **Pillars** | 14 × 14 m, four pillars; saws in the corners | Sensors and line of sight matter |
| **Sumo Ring** | 10 m circular platform, ring-out | Weight, grip and positioning |

## Arena generator

Hand-made arenas are few; generated ones are endless, and cheap.

- **Templates** (in `shared/content/arena-templates/`) set ranges: size (10–16 m), boundary shape (square or
  octagon), and how many pillar pairs, block pairs, pits, saw-strip pairs, spiked segments and crate pairs, plus
  schedule ranges.
- **Generation** uses a seeded PRNG (xorshift128+) inside the **content package** (never inside the fight engine,
  which stays randomness-free). It builds half the arena and mirrors it, so symmetry holds by construction, then
  writes an ordinary arena JSON.
- **Checks** (any failure → try the next seed):
  - spawns at least 1.5 m from hazards and obstacles, at least 6 m apart;
  - every open area reachable for the widest frame (grid flood fill with 0.9 m clearance);
  - hazards cover at most 15% of the floor, obstacles at most 10%;
  - no pocket narrower than the widest frame.
- An arena is identified by `template + seed + generator version`. Contest schedules store the generated JSON
  itself, so a result can always be re-simulated even if the generator changes.

## Rulesets

A **ruleset** is one object holding every rule a twist can change. The engine reads these values instead of
constants.

| Field | Default |
|---|---|
| `weightCap` | 100 kg |
| `fightSeconds` | 120 |
| `hpMultiplier` | 1 |
| `chargeCapacityMultiplier`, `rechargeMultiplier` | 1, 1 |
| `damage` multipliers: `spinner`, `hammer`, `flipper`, `clamp`, `ram`, `hazard` | all 1 |
| `gripMultiplier` | 1 |
| `boost`: enabled, force, speed, cost | true, 1.4, 1.3, 15/s |
| `cameraDelay` | 0.2 s |
| `rangefinderRangeMultiplier` | 1 |
| `bannedParts` | none |
| `limits`: `weaponsMax`, `sensorsMax` | frame mounts, 5 |
| `hazardsEnabled` | true |

**Effective ruleset = season base ← Cup rule ← Stage 2 twist.** Later layers replace earlier values field by
field (and key by key inside `damage`). A combination that produces an invalid ruleset is rejected when the
season is planned, never at run time.

## Twists

A twist is a named, described change: a ruleset patch, an arena, or both. Tiers describe development cost:

| Tier | Cost | What |
|---|---|---|
| **A: knobs** | Minutes (data only) | Ruleset patches |
| **B: arenas** | Hours (data, or a generator seed) | A hand-made or generated arena |
| **C: mechanisms** | Days (engine code), built once | A new hazard or rule; afterwards it's just data |

### Catalogue at launch

| Twist | Tier | Change |
|---|---|---|
| Featherweight Night | A | Weight cap 75 kg |
| Heavyweight Night | A | Weight cap 125 kg |
| Glass Cannons | A | HP × 0.6 |
| Overcharged | A | Charge capacity and recharge × 1.5 |
| Brownout | A | Recharge × 0.5 |
| Ice Rink | A | Grip × 0.5 |
| Sticky Floor | A | Grip × 1.4 |
| Ram Week | A | Ram damage × 2 |
| Spinner Spotlight / Spinner Tax | A | Spinner damage × 1.25 / × 0.8 |
| Hammer Time | A | Hammer charge × 0.5, damage × 1.2 |
| No Spinners (or any one weapon) | A | One weapon banned |
| Blind Fight | A | Cameras banned, rangefinder range × 0.6 |
| Lag | A | Camera delay 0.4 s |
| One Weapon | A | Weapons max 1 |
| No Boost | A | Boost disabled |
| Long Fight / Sudden Death | A | 180 s / 75 s with the pit opening at 20 s |
| The Pit, Saw Alley, Pillars, Spiked Walls | B | Hand-made arenas |
| Small Box / Big Box | B | 10 m / 18 m plain arenas |
| Crate Yard | B | Many crates |
| Generated arena | B | A generator seed |
| Sumo Night | C (built for the MVP) | Sumo Ring, ring-out, weapon damage × 0.5 |

### Rules for using twists

- **Cup rule:** any tier. **Stage 2 twist:** Tier A or a Tier B arena only, so it can be handled in one evening.
- At most **two changes active** at once (Cup rule + Stage 2 twist).
- **No twist repeats within 4 weeks.** Reruns after that are fine.
- **A twist changes the best answer; it never stops a valid bot from working.** Bans are the one exception, and a
  banned part is announced on Monday with the brief.
- At most one weapon ban per week, never two weeks running, and never a weapon below 10% usage (pointless).

## Rotation

| Content | How it rotates |
|---|---|
| Frames, drivetrains, batteries, fittings, sensors | The core shelf: always available; numbers adjusted at season patches |
| Weapons | All four plus the wedge at launch. Seasons add vault weapons ([04](04-weapons.md#later-weapons-the-vault)) and may *rest* one weapon for a season (never more than one, never the newest; it returns next season) |
| Arenas | Each season's pool: some hand-made, mostly generated; hazards introduced at season patches |
| Twists | Drawn weekly from the catalogue; new Tier C mechanisms arrive at season patches |
| Balance | Data-only patches between seasons; an emergency fix mid-season only if one part is in over 70% of entries and wins over 58% |

**What to rotate is chosen from data.** After each cup, usage share and win rate per weapon and part are computed
from the game records. A weapon used by over 35% of entries with a win rate over 55% is a candidate for a "tax"
twist or a patch; one under 8% usage is a candidate for a "spotlight".

## Automation

Most content is produced by tools and approved by a person.

```
shared/content/  (twists, arenas, templates, house bots, gauntlet library)
        │
        ▼
tools/plan-season.mjs --season N --seed S      ← previous seasons' schedules, meta stats
   1. pick, for each of 6 weeks: an arena (hand-made or generated), a Cup rule, 3 Stage 2 candidates
   2. pick 42 Daily Gauntlets (see 08)
   3. apply the rules above (no repeats, tier mix, compatible combinations, varied arenas)
   4. vet every week and every gauntlet with the harness
   5. write seasons/season-N.json (arenas inline) and season-N.report.md (vetting tables)
        │
        ▼
human review → edit → pull request → CI re-validates (schemas, generator determinism, vetting thresholds)
        │
        ▼
Spring loads the season file on deploy and creates cups and gauntlets on schedule
```

Past weeks are immutable. To change a future week, edit the season file and redeploy.

## Vetting

The engine is deterministic and fast, so every change can be measured before players see it. The harness lives in
`tools/balance/` and runs the shared engine in Node.

| Check | Method | Pass |
|---|---|---|
| **Twist worth running** | Round-robin of the reference field with and without the twist (each pair: 2 setups × swapped spawns); rank correlation of win rates | Between 0.4 and 0.8 |
| **No dominance** | Win rate of builds containing each weapon or part under the twist | No weapon or part above 65% |
| **Nothing breaks** | Every reference bot still moves and attacks under the twist | All pass |
| **Matchup web** | Weapon-vs-weapon win rates of the archetype presets | Roughly matches [04](04-weapons.md#matchup-web) |
| **Gauntlet solvable** | A reference solution earns Gold; the naive preset brain earns Bronze but not Gold | Both hold |

**The reference field:** the five presets with reference brains, the house bots, and published archive bots. On
the server, an admin job can also include the last cup's top 32 entries (private bots stay on the server; only
aggregate numbers are reported).

**In CI:** any pull request touching parts, weapons or engine numbers gets a balance report posted as a summary.

## Adding content

| To add | Steps |
|---|---|
| A Tier A twist | Add a JSON entry (id, name, description, tier, ruleset patch) → vet → schedule |
| An arena | Write the JSON (or pick a generator seed) → `tools/validate-arena.mjs` → vet → add to the season pool |
| A hazard or mechanism | Engine code in `shared/sim/hazards/`, schema update, golden tests, renderer visuals, then data. Ship at a season patch |
| A weapon or part | Engine state machine (if new behaviour), data entry, camera tells, editor actions and readings, vetting. Ship at a season patch |

A visual arena editor is a post-MVP admin tool; the MVP uses JSON and the generator.
