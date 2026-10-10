# 02 Building

A build is a short list of understandable choices. A beginner can make a working bot in a minute (or start
from a preset); an expert spends evenings tuning weight, faces and sensors.

## Anatomy of a build

```
            FRONT
       ┌─────────────┐        Frame       size, HP, weapon mounts
  LEFT │  ┌───────┐  │ RIGHT  Drivetrain  speed, push, turning, sideways or not
       │  │ roof  │  │        Battery     charge capacity and recharge
       │  └───────┘  │        4 faces     one fitting each: bare, plate, wedge, or a face weapon
       └─────────────┘        Weapons     use mounts; face weapons occupy a face, a hammer swings over one
             REAR             Sensors     one per face, plus one on the roof
```

| Slot | Choose | Count |
|---|---|---|
| Frame | Light, Medium, Heavy | exactly 1 |
| Drivetrain | Wheels, Treads, Mecanum | exactly 1 |
| Battery | Small, Standard, Large, Fast-charge | exactly 1 |
| Faces | Front, rear, left, right: one fitting each | 4 |
| Weapons | Spinner, Hammer, Flipper, Clamp | up to the frame's mounts |
| Sensors | Rangefinder (wide, long, 360), Camera | up to 1 per face + 1 roof |
| Looks | Name, paint, decal | cosmetic |

**Weight cap: 100 kg** (a ruleset value; twists change it). The bot's mass in the physics is the total weight
of every part, so weight is both the budget and a gameplay stat.

## Parts

### Frames

| Frame | Weight | Size (L × W) | HP | Weapon mounts | Identity |
|---|---|---|---|---|---|
| **Light** | 18 kg | 0.70 × 0.60 m | 180 | 1 | Small target, quick to turn, frees weight |
| **Medium** | 26 kg | 0.85 × 0.75 m | 240 | 2 | The all-rounder |
| **Heavy** | 34 kg | 1.00 × 0.85 m | 300 | 2 | Lasts longest; heavy, so it needs good drive |

HP lives on the frame (how long you last); plates live on faces (which hits hurt). They answer different
questions, so both exist.

### Drivetrains

One pick. Each is a bundle with a clear strength and weakness; physics does the rest.

| Drivetrain | Weight | Motor force | Top speed | Grip | Max turn | Sideways | In plain words |
|---|---|---|---|---|---|---|---|
| **Wheels** | 12 kg | 500 N | 4.5 m/s | 0.7 | 300°/s | No | Fast, but slides when shoved |
| **Treads** | 18 kg | 800 N | 3.0 m/s | 1.1 | 180°/s | No | Slow and stubborn; wins pushing wars |
| **Mecanum** | 14 kg | 450 N | 3.8 m/s | 0.45 | 330°/s | **Yes** | Can drive sideways like a crab; easy to bully |

- **Push** = min(motor force, grip × weight × 9.81). A light bot on wheels spins its wheels before it uses its
  full motor; a heavy bot on treads pushes with everything it has.
- Wheels and Treads are **skid-steer**: like a car or a tank, they go where they point (or straight back).
  Mecanum moves in any direction regardless of facing, which makes circling and retreating-while-facing
  easy, at the cost of grip.
- Exact force, acceleration and turning formulas: [03](03-physics.md#drive-and-acceleration).

### Batteries

Charge is spent by weapons, boost and the camera. Driving normally is free.

| Battery | Weight | Capacity | Recharge |
|---|---|---|---|
| **Small** | 4 kg | 60 | 5 per s |
| **Standard** | 7 kg | 100 | 7 per s |
| **Large** | 12 kg | 160 | 7 per s |
| **Fast-charge** | 9 kg | 80 | 12 per s |

Recharge is continuous. At 0 charge, nothing that costs charge works until it refills.

### Face fittings

Each face carries exactly one.

| Fitting | Weight | Effect |
|---|---|---|
| **Bare** | 0 | Nothing |
| **Light plate** | 4 kg | −3 damage per hit on this face |
| **Heavy plate** | 9 kg | −7 damage per hit on this face |
| **Spiked plate** | 6 kg | −2 per hit; rams with this face deal ×1.5 damage |
| **Wedge** | 8 kg | −4 per hit; lifts opponents on head-on contact; halves spinner hits on this face |
| **Face weapon** | (weapon) | A spinner, flipper or clamp occupies the face |

Plates reduce each hit by a flat amount (so they matter most against many small hits). Floor hazards hit
the underside and ignore plates; a clamp's crush ignores plates. Details: [03](03-physics.md#damage),
[04](04-weapons.md).

### Weapons (summary)

| Weapon | Weight | Mount | Where | Charge |
|---|---|---|---|---|
| **Spinner** | 20 kg | 1 | Occupies a face | 10/s spinning up, 1/s holding |
| **Hammer** | 15 kg | 1 | On the roof, strikes over a face | 12 per swing |
| **Flipper** | 13 kg | 1 | Occupies a face | 18 per flip |
| **Clamp** | 14 kg | 1 | Occupies a face | 10 per grab + 4/s holding |

The **wedge** is a fitting, not a weapon: it needs no mount. Mechanics, numbers and counters:
[04](04-weapons.md).

### Sensors (summary)

| Sensor | Weight | Slot | Sees | Range | Charge |
|---|---|---|---|---|---|
| **Built-in** | 0 | (always) | Yourself, the arena map, bumps, the scoreboard, the opponent's build | — | 0 |
| **Rangefinder, wide** | 2 kg | Face | Opponent position and motion, 120° cone | 7 m | 0 |
| **Rangefinder, long** | 2 kg | Face | Same, 40° cone | 20 m | 0 |
| **Rangefinder, 360** | 5 kg | Roof | Same, all around | 5 m | 0 |
| **Camera** | 3 kg | Face | The opponent's facing side and weapon state, 70° cone, 0.2 s delay | 10 m | 2/s while on |

A camera's face can't carry a Heavy plate or a Wedge (you can't armour over a lens). Details:
[05](05-sensors.md).

## Build rules

The editor and the worker run the same rules ([10](10-architecture.md#validation)):

1. Exactly one frame, drivetrain and battery.
2. Exactly one fitting per face. A face weapon's face has that weapon as its fitting.
3. Weapons ≤ the frame's mounts. A hammer swings over a face that has no face weapon.
4. At most one sensor per face, at most one roof sensor. A camera's face is not Heavy plate or Wedge.
5. Total weight ≤ the ruleset's weight cap. No banned parts (twists can ban parts).
6. Name 3–24 characters from an allowed set; paint from the palette.

## Derived stats and bars

`deriveStats(build, ruleset)` is the only place parts become numbers ([10](10-architecture.md)). The garage
shows six bars (1–10, scaled across the catalogue), with exact numbers on hover:

| Bar | From |
|---|---|
| **Speed** | Drivetrain top speed (boost shown as an extension) |
| **Agility** | Turn rate and acceleration (lighter and smaller turns faster; see [03](03-physics.md)) |
| **Push** | min(motor force, grip × weight × 9.81) |
| **Toughness** | Frame HP plus average plate reduction |
| **Charge** | Battery capacity and recharge |
| **Awareness** | Sensor coverage: which directions and what information |

The bars move as parts change, and the top-down preview updates (plates, weapons and sensor cones drawn on
the bot).

## Presets

Each preset comes with a starter brain ([06](06-programming.md#examples)) and is a starting point, not a
recommended final build.

| Preset | Parts | Weight | Speed | Push | HP | Plan |
|---|---|---|---|---|---|---|
| **Buzzsaw** | Medium, Wheels, Large battery; Spinner front; Heavy plate rear; Light plates sides; wide rangefinder + camera front | 92 kg | 4.5 | 500 N | 240 | Spin up, hit, back off while spinning up, hit again |
| **Anvil** | Heavy, Treads, Standard battery; Wedge front; Hammer over front; Light plates sides and rear; wide rangefinder front | 96 kg | 3.0 | 800 N | 300 | Wedge under, pin with the hammer, push into hazards |
| **Catapult** | Medium, Wheels, Fast-charge; Flipper front; Heavy plate rear; Light plates sides; wide rangefinder + camera front | 82 kg | 4.5 | 500 N | 240 | Get under, throw into walls and the pit |
| **Lockjaw** | Medium, Treads, Standard battery; Clamp front; Heavy plates sides; Light plate rear; 360 rangefinder | 92 kg | 3.0 | 800 N | 240 | Grab and carry to the saws |
| **Dart** | Light, Wheels, Small battery; Spiked plate front; Hammer over front; Light plate rear; sides bare; wide rangefinder front | 61 kg | 4.5 | 419 N | 180 | Hit and run: ram, hammer, escape |

## The garage

1. **Pick or start:** a preset, a copy of one of your bots, or a blank frame.
2. **Assemble:** frame → drivetrain → battery → click each face on the top-down bot to choose its fitting →
   place weapons → place sensors → paint and name. The weight bar fills and turns red over the cap; illegal
   choices are greyed out with the reason ("Camera can't go behind a heavy plate").
3. **Test drive:** drive your build with the keyboard (W/S throttle, A/D turn, Q/E strafe on mecanum,
   Space and F for weapons 1 and 2, Shift to boost, C to toggle the camera) in an arena with dummies, crates
   and hazards. Never available in competition.
4. **Program:** the brain editor ([06](06-programming.md)).
5. **Sandbox:** fight house bots, your own bots or published bots in any arena and ruleset, with replay and
   trace.
6. **Save a version:** validation runs (editor and server); versions are immutable and numbered; contests
   lock versions.

Account limits: 3 bots at first, more garage slots from Builder level ([09](09-social-and-progression.md));
50 versions kept per bot (older ones archived unless entered in a contest).

## Why it's built this way

- **Faces make everything concrete.** Armour, weapons and sensors all sit on a visible side, so "hit their
  bare side" and "don't show them your camera" are things anyone understands.
- **Weight is one bar.** Every choice trades against every other through a single number players can see.
- **Physics instead of rules.** There is no "carrying rating" or speed penalty table: mass does it. Heavier
  bots turn and accelerate more slowly and push harder; rams scale with mass and speed.
- **Small catalogue.** 3 frames, 3 drivetrains, 4 batteries, 5 fittings, 4 weapons, 4 sensors. Players can
  learn the whole shelf; seasons add or rotate parts ([07](07-arenas-and-twists.md#rotation)).
