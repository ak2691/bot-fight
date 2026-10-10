# 03 Physics and Engine Model

A small, purpose-built 2D rigid-body simulation seen from above. It's written for this game (not a physics
library) so it can be deterministic, fast and easy to reason about. Height exists only as an "airborne"
state used by flips.

## Units and constants

SI units throughout: metres, kilograms, seconds, newtons, joules. Angles are radians internally and degrees
in the editor.

| Constant | Value | Notes |
|---|---|---|
| Gravity `g` | 9.81 m/s² | Used for grip limits |
| Physics step | 20 ms (50 Hz) | Fixed |
| Brain tick | every 5 steps (100 ms, 10 Hz) | Brains decide; the control layer acts every step |
| Replay frame | every 2 steps (25 Hz) | The renderer interpolates |
| Game length | 120 s (6000 steps) | Ruleset value |
| Rolling resistance | 0.04 × m·g | Coasting bots slow down |
| Restitution | bot–bot 0.25, bot–wall 0.35, bot–pillar 0.3 | Bounciness |
| Contact friction | 0.4 | Between touching bodies |
| Solver | 6 iterations; position correction 20% per step, 5 mm slop | |
| Impact threshold | 120 J | Below it, collisions do no damage |
| Impact damage | 0.015 HP per joule above the threshold | |
| Impact cooldown | 0.3 s per pair of bodies | No damage from jitter |
| Boost | force × 1.4, top speed × 1.3, 15 charge/s | |
| Heading gain | 6 per s | Control layer steering |
| Gyro | turn cap × 0.6 while a spinner is above 50% energy | |
| Wedge lift | grip × 0.25 for 0.4 s | Flipper lip: × 0.5 for 0.3 s |
| Hammer pin | drive disabled 0.4 s | |
| Landing damage | 10 HP per second airborne | Ignores plates |
| Floor saw | 15 HP/s in 0.2 s ticks | Ignores plates |
| Spiked wall | wall impact damage × 2 + 4 | |

## Determinism

The same inputs must produce the same game, bit for bit, on every run of the server. Rules (enforced by a
lint rule on the engine package, as today):

- Doubles are fine. Only `+ − × ÷` and `Math.sqrt` are used on them; these are exact IEEE 754 operations in
  every JavaScript engine.
- **No `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log` or `pow` with non-integer exponents**: their precision
  varies between engines. The engine has its own `dsin`, `dcos`, `datan2` built from basic operations
  (range reduction plus polynomial).
- No `Math.random`, `Date`, timers or I/O. All variety comes from inputs (arena, spawn layout).
- Fixed iteration order: bodies in id order, contacts in a defined order, arrays rather than `Map` iteration.
- An integer step counter drives everything; time is `step × 0.02`.
- Golden tests hash the state every N steps; the worker and the browser test run must match
  ([10](10-architecture.md#testing)).

The browser sandbox uses the same engine. Rated results only ever come from the server.

## Coordinates and angles

x to the right, y up, angle 0 along +x, counter-clockwise positive. A body's **forward** axis is
(cos θ, sin θ) and its **left** axis is (−sin θ, cos θ). Readings shown to players use degrees from
−180 to 180, **negative to the left, positive to the right**, and the editor always labels the side
("30° right").

## Step order

At step `n`:

1. **Brains** (when `n % 5 == 0`): both brains read the *same* start-of-step perception, in a fixed order, and
   set their lane commands ([06](06-programming.md#evaluation)). Commands persist until the next brain tick.
2. **Control and forces:** each Move command becomes drive forces and a steering torque (below).
3. **Integrate velocities** (semi-implicit Euler).
4. **Collisions:** detect contacts, record approach speeds (for impact damage), solve velocity impulses.
5. **Integrate positions,** then position correction.
6. **Weapons:** state machines advance; zone checks, armed triggers, spinner contacts, hammer strikes,
   flipper launches, clamp grabs ([04](04-weapons.md)).
7. **Hazards and airborne:** pit, saws, ring-out checks; airborne timers and landings.
8. **Damage and statuses:** apply all damage from this step (impacts, weapons, hazards) through the damage
   pipeline; tick pin and lift timers; recharge and drain charge.
9. **Perception:** update rangefinder detections, last-known values and the camera's delay buffer
   ([05](05-sensors.md)).
10. **End check** (KO, pit, ring-out, time), then **record** a replay frame (every 2nd step) and events.

## Bodies and shapes

Each bot is an **oriented rectangle** (its frame's length × width) with mass `m` (total build weight) and
moment of inertia `I = m (L² + W²) / 12`. Its four edges are its **faces**. Weapon zones are attached to faces
but are **not solid**: they detect overlap and never push anything ([04](04-weapons.md#zones)).

Per-bot state: position, angle, velocity, angular velocity, HP, charge, weapon states, sensor states,
status timers (pinned, lifted with its factor), airborne timer, held-by, and per-pair impact cooldowns.

Other bodies: **walls** (the arena boundary, infinite mass), **pillars** (circles) and **blocks** (rectangles),
both static, and **crates** (dynamic 30 kg, 0.5 × 0.5 m boxes with no HP, used by the Academy, gauntlets and
some arenas).

## Drive and acceleration

The brain chooses a **maneuver** ([06](06-programming.md#move-maneuvers)); every step the **control layer**
turns it into a desired direction `d̂`, a desired speed `s*` (top speed × throttle), and a desired facing for
the chosen face. Then the drivetrain produces forces.

### Available force

```
F_motor' = F_motor × (1.4 if boosting else 1)
v_top'   = v_top   × (1.3 if boosting else 1)
grip'    = grip × lift factor (1 normally; 0.25 lifted by a wedge; 0.5 by a flipper lip)
traction = grip' × m × g

accelerating (force along the current motion): F_avail = min(F_motor' × max(0, 1 − |s| / v_top'), traction)
braking      (force against the motion):       F_avail = min(F_motor', traction)
```

The `(1 − |s|/v_top)` term is a motor's torque–speed curve: full force from standstill, none at top speed.
This gives natural acceleration curves with no extra rules:

- Time to ~90% of top speed is about `2.3 × m × v_top / F_motor` when the motor is the limit. Buzzsaw
  (92 kg, wheels): about 1.9 s. Dart (61 kg, wheels): about 1.3 s. Anvil (96 kg, treads, lower top
  speed): about 0.8 s.
- When traction is the limit (light bots on low grip), acceleration is `grip × g` regardless of mass, exactly
  as in reality.

### Skid-steer (Wheels, Treads)

The bot can only push along its forward axis (forwards or backwards).

```
lead = front or rear (skid-steer bots drive front- or rear-first)
θ*   = direction of d̂ (front lead) or d̂ + 180° (rear lead)
e    = wrap(θ* − θ)                                   heading error
ω_cmd = clamp(6 × e, ±ω_cap)                          ω_cap = max turn × (0.6 if gyro) 
s_cmd = ±s* × max(0, cos e)                           slow down while turning; + front, − rear lead
s    = v · forward
F_long = clamp(m × (s_cmd − s) / 0.1, ±F_avail)       along forward
v_lat = v · left
F_lat  = −clamp(m × v_lat / dt, ±traction)            tyres/treads resist sliding sideways
F_roll = −0.04 × m × g × sign(s)                      when |s| > 0.01 m/s
τ      = clamp(I × (ω_cmd − ω) / 0.05, ±τ_max)        τ_max = k_turn × F_motor' × W / 2
```

`k_turn` is 1.0 for wheels and 0.6 for treads (treads scrub when turning). Lighter and smaller bots have less
inertia, so they reach their turn cap faster.

### Mecanum

The rollers let the drive push in any direction, independent of facing.

```
v*    = d̂ × s*                                          desired velocity (world)
F     = clampLength(m × (v* − v) / 0.1, F_avail)        F_avail uses |v| in the speed curve
facing: ω_cmd = clamp(6 × e_face, ±ω_cap)               e_face = error of the chosen face toward its target
τ     = clamp(I × (ω_cmd − ω) / 0.05, ±τ_max)           k_turn = 1.2
```

Mecanum has no separate sideways grip: anything pushing it harder than its traction (0.45 × m × g) slides it.

### Status effects on driving

| Status | Effect |
|---|---|
| Pinned (hammer) | No drive force and no steering torque for 0.4 s; friction still applies |
| Lifted (wedge, flipper lip) | Grip multiplied by the lift factor |
| Airborne | No drive, no friction, no bot–bot contact |
| Held (clamp) | No drive, no friction; moves with the holder |
| Charge 0 | Boost unavailable; driving still works (driving is free) |

**Brake** sets `s* = 0` and `ω_cmd = 0`. A bot with no Move command brakes.

## Collisions

### Detection

- Bot–bot and bot–block: separating axis test on the two rectangles. The axis of least overlap gives the
  contact normal `n` (from A to B) and depth; edge clipping gives up to two contact points.
- Bot–wall: the arena boundary is a polygon; each corner of the bot is tested against each wall segment.
- Bot–pillar: the closest point on the rectangle to the circle's centre.
- Airborne bots skip bot–bot and bot–crate contacts (they're above them) but still hit walls and pillars.
- Everything is tested every step. With two bots and a few dozen static shapes there's no need for a
  broad phase.

### Which face was hit

For body A, the face hit is the face whose outward normal points most along `n`; for B, along `−n`. Faces
decide plates, wedges, spikes and the camera's view. Contacts that land exactly on a corner use the face
with the larger dot product, with ties broken front > rear > left > right.

### Response

Standard sequential impulses. For each contact point, with `r` the offsets from each centre:

```
v_rel = (v_B + ω_B × r_B) − (v_A + ω_A × r_A)
v_n   = v_rel · n                                       approach speed (negative = closing)
j     = −(1 + e) × v_n / (1/m_A + 1/m_B + (r_A × n)²/I_A + (r_B × n)²/I_B)
apply ±j·n; then friction impulse along the tangent, |j_t| ≤ 0.4 × j
```

Six iterations with accumulated, clamped impulses. Walls and static obstacles have infinite mass. After
positions are integrated, overlapping bodies are pushed apart by 20% of the depth beyond 5 mm, split by
inverse mass.

## Pushing

Nothing special is needed: when two bots press together, contact impulses transmit force, and each bot's
drive pushes up to its available force while friction resists sliding up to its traction. The bot with more
push (motor force, limited by grip × weight) moves the other. A wedge's lift cuts the loser's traction, which
is why wedges win shoving matches.

## Damage

### Pipeline

Every damage source goes through the same steps:

1. **Raw damage** from the source (impact energy, weapon, hazard).
2. **Face modifiers:** a spiked plate on the attacking face multiplies ram damage by 1.5; a wedge on the
   defending face halves spinner damage.
3. **Ruleset multiplier** for the source type (twists such as "Ram Week").
4. **Minus the plate** on the face that was hit, unless the source ignores plates (floor hazards and landings
   hit the underside; a clamp crushes the frame).
5. **Floor:** weapon hits do at least 1; rams and hazards can do 0.
6. Subtract from HP (doubles; displays round). A bot at 0 HP or below is knocked out.

### Impact damage (rams and slams)

```
E = ½ × μ × v_n²          μ = m_A m_B / (m_A + m_B)   (against a wall or static obstacle: μ = m_A)
if E > 120 J and the pair's cooldown has passed:
    base = (E − 120) × 0.015
    each body takes: base × (1.5 if the other body's contacting face is spiked) − its own plate (min 0)
```

Both bodies take damage, so rams are a trade: ram with a plated or spiked face into a bare side. Spiked arena
walls deal `base × 2 + 4`.

| Situation | Energy | Damage before plates |
|---|---|---|
| 90 kg bot drives into a wall at 4.5 m/s | 911 J | 11.9 |
| Same bot boosting (5.85 m/s) | 1540 J | 21.3 |
| Two 90 kg bots head-on at 4.5 m/s each | 1822 J | 25.5 each |
| Same, but A's front is spiked and B's front is bare | 1822 J | B takes 38.3; A takes 25.5 |
| 60 kg bot rams a stopped 90 kg bot at 4.5 m/s | 365 J | 3.7 each |

### Weight and speed behind attacks

- **Rams** scale with the reduced mass and the square of closing speed. Heavy and fast both matter; boosting
  into a hit adds a lot.
- **Spinners** store energy in the weapon, and the bodies also collide, so driving into a spinner hit adds a
  ram on top. Recoil sends the spinner's own bot back by the same impulse, so light spinner bots bounce more
  ([04](04-weapons.md#spinner)).
- **Hammers** strike from above with a fixed force, independent of driving speed; their value is the pin.
- **Flippers** launch with a fixed impulse, so light targets fly farther and longer (throw speed = impulse ÷
  target mass).
- **Clamps** carry the target; the combined mass slows the holder.

## Airborne

Started by a flipper launch ([04](04-weapons.md#flipper)). The body keeps its horizontal velocity, has no drive
or friction, skips bot–bot contact, still hits walls and pillars, can't use weapons or be grabbed, and ignores
floor hazards. Its rendered height is a parabola over the airtime `T`.

**Landing:** `10 × T` damage, ignoring plates. If the landing point is inside an open pit, it's a pit KO; inside
a saw, the saw applies from then on; outside a ring-out platform, it's a ring-out. Bots always land upright in
the MVP (upside-down states and self-righting are a later feature).

## Grabs

While a clamp holds a target ([04](04-weapons.md#clamp)), the two bots form one compound body: the target's pose
is fixed relative to the holder. The holder drives the combined mass `m_h + m_t`, with inertia
`I_h + I_t + m_t × d²` (d = distance between centres). The compound still collides with walls, pillars and
hazards, so a held bot can be dragged into a saw or shoved into a wall. On release, both continue with the
compound's velocity.

## Arena elements

| Element | Physics |
|---|---|
| **Wall** | Static segment; spiked walls apply the spiked rule |
| **Pillar, block** | Static solid; blocks sensor line of sight ([05](05-sensors.md)) |
| **Crate** | Dynamic 30 kg box; doesn't block sight |
| **Pit** | A zone. Once open, a bot whose centre is inside (and not airborne) is knocked out |
| **Floor saw** | A zone that rises on a schedule; while up, overlapping bots take 15 HP/s, ignoring plates |
| **Ring-out edge** | Instead of walls: a bot whose centre leaves the platform (and isn't airborne) is knocked out |

Arena data format and the full hazard catalogue: [07](07-arenas-and-twists.md).

## How a game ends

| Result | Condition |
|---|---|
| **KO** | HP reaches 0 |
| **Pit KO** | Centre inside an open pit |
| **Ring-out** | Centre outside the platform (ring-out arenas) |
| **Draw** | Both bots are knocked out on the same step |
| **Judges' decision** | At the time limit: the bot that **took less damage** wins; if equal, more weapon hits landed; if still equal, a draw |

"Took less damage" is used rather than HP percentage, so a Heavy frame's extra HP helps only against a KO, as
it should.

## Replay output

| Part | Contents |
|---|---|
| **Frames** (25 Hz) | Per bot: x, y, angle, airborne height, HP, charge, weapon visual state (spinner angle and energy, hammer/flipper/clamp phase), status flags (pinned, lifted, held, boosting, camera on). Crates; hazard states (pit open, saws up). |
| **Events** (exact step) | Impact (bodies, faces, energy, damage each), weapon hit (weapon, faces, damage, impulse), launch, landing, grab, release, hazard damage, KO (type), judges' result |
| **Brain trace** (10 Hz, per bot) | Mode, the rule chosen in each lane, switches fired, and a snapshot of the readings it used. Only its owner may see it ([10](10-architecture.md#replays-and-visibility)). |

A 120 s game is about 3000 frames; compressed, well under 100 KB. Replays are re-simulated on demand, never
stored.

## Performance target

Two bots, a few dozen static shapes, 6000 steps and 1200 brain ticks: target **under 30 ms per game** in Node.
At that speed a 1000-entrant cup (about 24,000 games) takes about 12 CPU-minutes.

## Rendering

The simulation is 2D plus an airborne height, so any renderer can draw it from the frames: Pixi top-down now,
and a three.js view later that extrudes the same shapes, without touching the engine.
