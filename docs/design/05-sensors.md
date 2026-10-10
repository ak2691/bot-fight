# 05 Sensors

## Principles

1. **Observable only.** Sensors report what could physically be seen or felt: positions, motion, the side of
   the opponent facing you, what its weapon is visibly doing. Never internal state: the opponent's charge,
   cooldowns, mode or code.
2. **The pipeline.** Like a self-driving car: *Sense* (sensor parts) → *Perceive* (the engine turns raw sensing
   into readings) → *Predict and Plan* (the player's brain) → *Control* (the engine drives). Players never code
   perception or motor control.
3. **No blanks.** When something isn't currently sensed, readings hold the **last known** value, and a
   "time since" reading says how old it is. At the start, the opponent's last known position is its spawn
   point (the arena is known before the fight).
4. **Sensors decide the picker.** The brain editor only offers readings the build can produce
   ([06](06-programming.md#readings)).

## Built-in sensing (every bot)

| Sense | Real-world basis | Gives |
|---|---|---|
| Self state | Battery meter, wheel encoders, IMU | My HP, charge, speed, airborne, being held, weapon states |
| Arena map | The arena is surveyed before the fight | Distances from me to walls and hazards; hazard schedules (pit open, saws up) |
| Bump | Contact switches on each face | Touching the opponent, and on which face |
| Scoreboard | The judges' display | Damage I've dealt, damage I've taken |
| Opponent build | You see their robot before the fight | Their weapons, weight, frame, drivetrain (constant for the game) |
| Clock | | Time in mode, match time, time left |

Built-in sensing knows nothing about where the opponent is *right now* unless they're touching you. Every real
build carries at least one rangefinder.

## Rangefinders

A lidar-style sensor: precise position and motion of whatever it detects.

| Variant | Weight | Slot | Cone | Range |
|---|---|---|---|---|
| **Wide** | 2 kg | a face | 120° centred on the face's outward normal | 7 m |
| **Long** | 2 kg | a face | 40° | 20 m (the whole arena) |
| **360** | 5 kg | the roof | all around | 5 m |

**Detection** (every physics step): the opponent is **detected** if at least one of its five sample points (centre
and four corners) is within range, inside a rangefinder's cone, and has a clear line of sight. Pillars and blocks
block line of sight; crates and other bots don't. Multiple rangefinders combine: detected if any detects.

**While detected**, the engine updates the opponent's position, velocity and heading of travel exactly. **When not**,
those readings freeze at their last values, "time since detected" counts up, and Move targets aim at the last known
position ([06](06-programming.md#targets-and-places)).

## Camera

A vision sensor: it recognizes the opponent's visible parts and what they're doing.

| Property | Value |
|---|---|
| Weight / slot | 3 kg, a face; that face can't carry a Heavy plate or a Wedge |
| Cone / range | 70°, 10 m, line of sight required (pillars and blocks block it) |
| Delay | 0.2 s: readings describe the scene as it was 10 physics steps ago (recognition takes time) |
| Power | Draws 2 charge per second while **on**; switched by the brain's Systems lane; shuts off at 0 charge |
| Starts | On (the build can set it to start off) |

**What it reports** (when the opponent is in view, after the delay):

| Reading | How it's worked out |
|---|---|
| **Facing me** | The opponent's face whose outward normal points most toward the camera, reported as what's on it: weapon (and which type), wedge, heavy plate, light plate, spiked plate, or bare |
| **Weapon points at me** | Whether any of its weapon zones' directions is within 30° of the line to me, plus the smallest such angle (0–180°) |
| **Attacking** | Any weapon visibly acting: a hammer winding up or striking, a clamp closing, a flipper firing |
| **Spinner speed** | Its spinner's energy as a percentage (0 if it has none or it's stopped) |
| **Airborne** | Whether it's in the air |

The camera never reports the opponent's "front": it reports what's actually facing you. A rear-mounted hammer
driving at you reads as "plate facing me, weapon not pointing at me", which is the truth that matters.

**The camera's costs** make it a choice, not a tax:

1. It takes a face, which can then carry at most a Light plate: a visible weak spot.
2. Its 70° cone means pointing that weak face at the opponent to read them.
3. Its readings are 0.2 s late: bots can't react perfectly to a wind-up, they must anticipate.
4. It weighs 3 kg and draws charge while on.

Builds that skip it: the brute (a wedge pusher that only needs to know where you are), the shell of plates (no weak
window), the spinner that just needs to reach you.

## Readings at a glance

The full catalogue with types and units is in [06](06-programming.md#readings). By source:

| Source | Readings |
|---|---|
| Built-in | My HP and %, charge and %, speed, airborne, being held, touching (any face / a face), time since I took damage, time since my weapon hit, weapon ready, spinner energy, clamp holding, distance to nearest wall / hazard, wall distance ahead of a face, pit open, saws up, time in mode, match time, time left, damage dealt / taken, opponent build card |
| Rangefinder | Opponent detected, time since detected, gap to opponent, opponent angle from a face of mine, opponent speed, closing speed, approach angle, opponent's distance to nearest wall / hazard, opponent in my weapon's zone |
| Camera | Opponent seen, time since seen, facing me, weapon points at me (and angle), attacking, spinner speed, airborne |

## Design notes

- **Why the build card is free.** In BattleBots you see the opponent before the fight. Letting brains read it (and
  pick a starting mode) brings counter-play into the code without any pre-match menus.
- **Why no "facing" reading.** Bots are built differently, so "front" means nothing to an observer. What's facing
  you and where its weapon points are observable and are what matter.
- **Why last-known values.** Real perception keeps tracking objects that are briefly hidden. Stale information still
  counts but ages, and predicting where a hidden opponent went becomes a skill (pillars make this matter).
- **Later sensors:** a hazard-aware proximity ring, a microphone that hears weapons spin up through walls, sensor
  damage (a hit on the camera face blinds it briefly).
