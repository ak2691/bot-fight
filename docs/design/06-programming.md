# 06 Programming: The Brain

## Goals

- **Readable as a plan.** "Hunt them; when they're near a wall, pin them; when I'm hurt, back off" should
  look almost exactly like that on screen.
- **A one-minute floor.** A working brain is one mode with two rules.
- **A high ceiling** through modes, timing, situations, opponent-specific starts and sensor reads, without
  ever writing maths or motor control.
- **No wiring.** Rules are lists; the mode diagram draws itself.
- **Deterministic and bounded,** so the server can validate and run it safely.

## The model

```
BRAIN
├─ Start rules        pick the starting mode from what you know before the fight (the opponent's build, the arena)
├─ Situations         named groups of conditions, reusable anywhere ("Close", "They're spun down")
└─ Modes              named states; the bot is in exactly one at a time
   └─ MODE
      ├─ Lanes        one per output; in each lane, the FIRST rule whose conditions hold (and can be done) wins
      │   ├─ Move       a maneuver: Approach, Retreat, Circle, Turn to, Go to, Line up, Brake
      │   ├─ <Weapon>   one lane per weapon: Spin up / Swing / Fire / Grab / Arm / Release / Hold …
      │   └─ Systems    camera on/off (only if the build has a camera)
      └─ Switches     rules that change mode: when conditions hold, or after N seconds in this mode
```

Every 100 ms the brain checks the current mode's switches, then each lane's rules, top to bottom. Lanes are
independent: the bot moves, swings and manages its camera at the same time, each from its own list.

## Brain format

The stored brain is JSON validated by a shared schema and shared rules ([10](10-architecture.md#validation)).
Example (abbreviated):

```json
{
  "schema": "brain/1",
  "initialMode": "hunt",
  "startRules": [
    { "when": [{ "reading": "build.oppWeapon", "weapon": "spinner", "op": "is", "value": true }], "mode": "flank" }
  ],
  "situations": [
    { "id": "close", "name": "Close", "when": [{ "reading": "opp.gap", "op": "<", "value": 1.0 }] }
  ],
  "modes": [
    {
      "id": "hunt", "name": "Hunt",
      "lanes": {
        "move": [
          { "id": "r1", "when": [{ "situation": "close" }],
            "do": { "action": "approach", "target": "opponent", "lead": "front", "throttle": 100, "boost": true } },
          { "id": "r2", "when": [],
            "do": { "action": "approach", "target": "opponent", "lead": "front", "throttle": 75 } }
        ],
        "weapon:w1": [
          { "id": "r3", "when": [], "do": { "action": "arm" } }
        ],
        "systems": []
      },
      "switches": [
        { "id": "s1", "when": [{ "reading": "me.hpPct", "op": "<", "value": 30 }], "to": "retreat" },
        { "id": "s2", "after": 20.0, "to": "linger" }
      ]
    }
  ]
}
```

`"when": []` means **always**. Ids are stable; names are labels the player can rename freely.

## Start rules

Checked once, before the first tick, in order; the first match picks the starting mode, otherwise
`initialMode`. They may only use readings known before the fight: the **opponent's build** (weapons, weight,
frame, drivetrain) and the **arena** (pit present, saws present, ring-out). This is where a single brain
carries counter-plans ("against spinners, start in Flank").

## Modes

- A brain has 1–8 modes. A beginner's brain has one.
- **Entering a mode** resets *time in mode* to 0. Nothing else resets: weapons keep spinning, timers keep
  counting.
- The editor draws the mode diagram automatically: a node per mode, an arrow per switch (labelled with its
  condition or "after 3 s"), a start arrow from each start rule.

## Lanes

| Lane | Exists when | Default when no rule wins |
|---|---|---|
| **Move** | Always | Brake |
| **One per weapon** (named after it, e.g. "Hammer") | For each weapon in the build | Spinner: Coast. Others: Hold (a holding clamp keeps holding) |
| **Systems** | The build has a camera | No change |

The wedge is passive and has no lane.

**First match wins, if it can be done.** A rule wins when all its conditions hold **and** its action is
possible right now. Weapon actions are impossible when the weapon isn't ready or charge is short (the trace
says why); the lane then tries the next rule. Move and Systems actions are always possible, except Camera on at
0 charge.

**Commands persist** until the next brain tick. Move maneuvers are re-applied every physics step with fresh
sensor data. An **Arm** command watches the zone every physics step and fires the instant the opponent is in it;
it's disarmed when the lane picks something else.

## Rules and conditions

A rule is `when` (0–3 conditions, **all** must hold) → `do` (one action). For "or", write two rules with the same
action: that's explicit and shows up clearly in the trace.

A condition is one of:

| Form | Example |
|---|---|
| Reading vs. number | `gap to opponent < 1.2 m` |
| Reading vs. weapon reach (+ offset) | `gap to opponent < hammer reach + 0.1 m` |
| Reading vs. reading (same unit) | `damage dealt > damage taken` |
| Boolean reading | `opponent detected is true` |
| Enum reading vs. set | `facing me is one of {bare, light plate}` |
| Situation | `Close` |

Operators: `<  ≤  >  ≥  =  ≠` for numbers (the editor warns against `=` on continuous values), `is / is not`
for booleans, `is one of / is none of` for enums. Values are entered in the reading's unit (m, °, s, %, HP).

**Weapon reach** is the depth of the weapon's zone: spinner 0.30 m, hammer 0.60 m, flipper 0.25 m, clamp 0.20 m.

## Switches

A switch is `when` conditions **or** `after N seconds in this mode`, and a target mode. Switches are checked in
order before the lanes; the first that holds fires; **at most one switch per tick**, and the new mode's rules
apply in the same tick (its switches wait for the next tick). Timed switches are how sequences work: "Wind up →
after 0.5 s → Strike → after 0.3 s → Back off".

## Situations

Named groups of up to 3 conditions (all must hold), used like a condition anywhere: rules, switches, start rules
(when built only from pre-fight readings). They don't nest. They keep brains readable ("When **Spun down** →
Approach") and make one change apply everywhere.

## Readings

`[param]` means the condition picks a face, weapon or type. Ranges are what the editor allows.

### Built-in

| Reading (id) | Shown as | Type / unit |
|---|---|---|
| `me.hp`, `me.hpPct` | My HP, my HP % | HP, % |
| `me.charge`, `me.chargePct` | My charge, my charge % | number, % |
| `me.speed` | My speed | m/s |
| `me.airborne` | I'm airborne | bool |
| `me.held` | I'm being held | bool |
| `me.touching` `[any/face]` | Touching the opponent (on a face) | bool |
| `me.sinceDamaged` | Time since I took damage | s |
| `me.sinceHit` `[any/weapon]` | Time since my weapon hit | s |
| `me.ready` `[weapon]` | Weapon ready | bool |
| `me.spinner` `[weapon]` | My spinner energy | % |
| `me.holding` `[weapon]` | My clamp is holding | bool |
| `arena.wallDist` | Distance to nearest wall | m |
| `arena.wallAhead` `[face]` | Distance to a wall or obstacle ahead of a face | m |
| `arena.hazardDist` | Distance to nearest active hazard | m |
| `arena.pitOpen`, `arena.sawsUp` | Pit open, saws up | bool |
| `time.inMode`, `time.match`, `time.left` | Time in mode, match time, time left | s |
| `score.dealt`, `score.taken` | Damage dealt, damage taken | HP |
| `build.oppWeapon` `[type]` | Opponent has a [spinner/hammer/flipper/clamp/wedge] | bool |
| `build.oppWeight` | Opponent weight | kg |
| `build.oppFrame`, `build.oppDrivetrain` | Opponent frame, drivetrain | enum |

### Rangefinder (needs any rangefinder)

| Reading (id) | Shown as | Type / unit |
|---|---|---|
| `opp.detected` | Opponent detected | bool |
| `opp.sinceDetected` | Time since detected | s |
| `opp.gap` | Gap to opponent (closest distance between bodies; 0 when touching) | m |
| `opp.angleFrom` `[face/weapon]` | Opponent angle from my face (0 = straight out of it; −left/+right) | ° |
| `opp.speed` | Opponent speed | m/s |
| `opp.closing` | Closing speed (+ approaching, − leaving) | m/s |
| `opp.approachAngle` | Opponent approach angle (0 = coming straight at me, 180 = straight away) | ° |
| `opp.wallDist`, `opp.hazardDist` | Opponent's distance to nearest wall / active hazard | m |
| `opp.inZone` `[weapon]` | Opponent in my weapon's zone | bool |

### Camera (needs a camera, switched on; 0.2 s delay)

| Reading (id) | Shown as | Type / unit |
|---|---|---|
| `cam.seen`, `cam.sinceSeen` | Opponent seen, time since seen | bool, s |
| `cam.facingMe` | What's facing me | enum: spinner, flipper, clamp, wedge, heavy plate, light plate, spiked plate, bare (a hammer swings over a face, so it shows in `cam.weaponAtMe`, not here) |
| `cam.weaponAtMe`, `cam.weaponAngle` | Their weapon points at me, its angle off me | bool, ° |
| `cam.attacking` | They're attacking (winding up, striking, closing, firing) | bool |
| `cam.spinner` | Their spinner speed | % |
| `cam.airborne` | They're airborne | bool |

## Actions

### Move maneuvers

| Maneuver | Parameters | What the engine does |
|---|---|---|
| **Approach** | target · lead (front/rear; any face or weapon on mecanum) · throttle 25–100% · boost · lead aim (none/auto) · avoid hazards | Drive at the target with the lead face first |
| **Retreat** | from target · keep (face toward the target) · throttle · boost · avoid hazards | Drive away while keeping that face toward it (skid-steer: front kept means reversing) |
| **Circle** | target · clockwise/counter · distance 0.5–6 m · throttle · avoid hazards · keep (mecanum only) | Orbit at that distance. Skid-steer drives the orbit front-first (the target is to its side); mecanum keeps the chosen face toward the target |
| **Turn to** | target · face or weapon | Rotate in place until that face points at the target |
| **Go to** | place · lead · throttle · boost · avoid hazards | Drive to a place |
| **Line up** | opponent · against (nearest hazard / nearest wall / the pit) · offset (default 0.6 m) · avoid hazards | Move round to the far side of the opponent from the hazard, without touching it, ready to push |
| **Brake** | — | Stop |

- Skid-steer bots (wheels, treads) lead with front or rear only; the editor greys side faces and explains why.
  Mecanum can lead or keep any face.
- **Lead aim auto** aims at where the opponent will be: position + velocity × t, with t = gap ÷ my top speed,
  capped at 1 s. It assumes they keep going straight, so jukes beat it.
- **Avoid hazards** (default on) steers around active hazards (open pit, raised saws) within 1 m of the path.
  It never avoids walls: pushing into walls is a tactic.

### Targets and places

| Target / place | Meaning |
|---|---|
| **Opponent** | Its live position when detected, otherwise its last known position |
| **Opponent's last known position** | Explicitly where it was last detected |
| **Arena centre** | The centre of the arena |
| **Safe spot** | A precomputed point far from hazards and walls (per arena) |
| **Point** | Coordinates picked on the arena map |

### Weapon actions

| Weapon | Actions |
|---|---|
| Spinner | Spin up · Coast · Brake |
| Hammer | Swing · Arm · Hold |
| Flipper | Fire · Arm · Hold |
| Clamp | Grab · Arm · Release · Hold |

### Systems actions

Camera on · Camera off.

## Evaluation

```
on each brain tick (every 100 ms):
    P ← perception snapshot from the start of this step            // never the true opponent state
    if first tick:
        mode ← first start rule that holds, else initialMode
    for each switch s of mode, in order:                           // at most one switch per tick
        if (s.after and timeInMode ≥ s.after) or all(s.when, P):
            mode ← s.to; timeInMode ← 0; break
    for each lane L of the build:
        command[L] ← default(L)
        for each rule r in mode.lanes[L], in order:
            if all(r.when, P) and possible(r.do, P):
                command[L] ← r.do; break
    trace ← { mode, chosen rule per lane, switch fired, readings used }
    timeInMode ← timeInMode + 0.1
```

Situations are evaluated at most once per tick. Both bots' brains run on the same snapshot, in a fixed order, so
neither sees the other's decision.

## Limits

| Item | Limit |
|---|---|
| Modes | 8 |
| Rules per lane per mode | 10 |
| Conditions per rule, switch or situation | 3 |
| Switches per mode | 8 |
| Start rules | 8 |
| Situations | 16 |
| Names | 1–24 characters |
| Total rules (all modes and lanes) | 200 |

Limits keep brains readable, the editor usable on a phone and evaluation cheap.

## Validation

**Blocking** (editor and worker run the same code):

1. Structure matches the schema.
2. Every reference exists: modes, situations, weapons; switch targets differ from their own mode.
3. Lanes match the build exactly: Move, one per weapon, Systems only with a camera.
4. Every reading is available to the build's sensors; parameters (faces, weapons, types) exist in the build.
5. Values are within each reading's range; enums are valid; operators fit the type.
6. Start rules and the situations they use only use pre-fight readings.
7. Limits.

A brain saved against one build can become invalid if the build changes (say, the camera is removed). The editor
marks the broken rules and refuses to save a version until they're fixed.

**Warnings** (lint, non-blocking): rules after an "always" rule in the same lane (unreachable); modes nothing can
reach; switch pairs that bounce back and forth immediately; a weapon with no rules in any mode; camera readings
used while the camera never switches on; thresholds outside realistic values; `=` on continuous numbers.

## The editor

**Desktop:** the mode list and auto-drawn diagram on the left; the selected mode in the centre, with its lanes as
columns of rule cards and its switches along the bottom; the inspector on the right.
**Phone:** mode tabs, lanes stacked, a full-screen editor for one rule at a time.

- **Rule cards read as sentences**, with every chip clickable:
  `When [gap to opponent] [<] [hammer reach + 0.1 m] → Swing hammer`. No conditions reads "Always".
- **The reading picker** is grouped by source (Me, Arena & time, Score, Opponent build, Rangefinder, Camera).
  Readings the build can't produce are shown greyed with the reason ("needs a Camera"), which teaches what parts
  are for.
- **Priority is order:** drag cards within a lane. Copy and paste rules between lanes and modes; duplicate modes.
- **Situations and start rules** have their own panels.
- Undo/redo, autosaved drafts, and "Save version" (validates, then snapshots build and brain together).
- Lint warnings appear inline on the card, with a suggested fix.

## Debugging and testing

The replay is the teacher, so it must answer "why did my bot do that?":

- **Trace timeline:** a coloured band of modes over the fight, and the chosen rule per lane over time.
- **Why panel:** click any moment to see the mode, every rule in every lane with ✓/✗ per condition and the reading
  values, which rule won, and why higher rules lost ("Hammer not ready: recovering, 0.4 s left").
- **Overlays:** sensor cones, detection lines, the last-known "ghost" of the opponent, weapon zones, the planned
  path.
- **Watch list:** graph chosen readings over time.
- **Sandbox:** pick opponent, arena, ruleset and spawn; play, pause, step by brain tick or physics step, speed
  0.25×–4×, rewind (deterministic re-simulation to any step).
- **Scenario capture:** save any moment (positions, velocities, states) as a sandbox start, to test a rule against
  exactly that situation.
- **Test drive:** drive the build by hand to feel its handling ([02](02-building.md#the-garage)).

## Examples

### Beginner: Anvil starter (1 mode, 2 rules)

| Lane | Rule |
|---|---|
| Move | Always → Approach opponent, lead front, 100% |
| Hammer | Always → Arm |

It drives at the opponent with its wedge and swings whenever they're in range.

### Intermediate: Buzzsaw (3 modes)

**Start rules:** opponent has a wedge → **Flank**; otherwise **Charge**.

| Mode | Lanes | Switches |
|---|---|---|
| **Charge** | Move: gap < 2 m → Approach opponent, lead front, 100%, boost · Always → Approach, 75% · Spinner: Always → Spin up | My spinner hit < 0.2 s ago → **Recover** |
| **Recover** | Move: Always → Retreat from opponent, keep front, 75% · Spinner: Always → Spin up | My spinner > 90% and opponent has a wedge → **Flank** · My spinner > 90% → **Charge** |
| **Flank** | Move: facing me is one of {bare, light plate} → Approach opponent, lead front, 100%, boost · Always → Circle opponent clockwise at 1.5 m · Spinner: Always → Spin up · Systems: Always → Camera on | My spinner hit < 0.2 s ago → **Recover** |

### Advanced: Anvil, tournament version (5 modes)

- **Start:** opponent has a spinner → **Bait**; otherwise **Hunt**.
- **Hunt:** Approach front-first; Hammer armed. Switches: opponent's distance to a hazard < 1.5 m → **Line up**;
  my HP < 25% and damage taken > damage dealt → **Turtle**.
- **Line up:** Line up opponent against the nearest hazard. Switch: after 1.5 s, or touching opponent → **Shove**.
- **Shove:** Approach front-first, 100%, boost; Hammer: Always → Swing. Switches: opponent's distance to a hazard
  > 2.5 m → **Hunt**; after 3 s → **Hunt**.
- **Bait** (against spinners): Circle at 2 m until their spinner reads below 40% on the camera, then Approach;
  Hammer armed. Switch: my HP < 25% → **Turtle**.
- **Turtle:** Retreat keeping front (the wedge) toward the opponent; Hammer armed; switch after 10 s → **Hunt**.

## Engine notes

- The brain is compiled once per game into flat arrays: situations become condition indices, readings become
  numeric slots in the perception struct. Each tick evaluates only the current mode.
- Brain evaluation receives only the perception struct for its bot: it has no access to the true opponent state,
  so the observable-only rule ([05](05-sensors.md#principles)) is enforced by the API, not by convention.
- Evaluation is pure and deterministic; the trace is a by-product.
