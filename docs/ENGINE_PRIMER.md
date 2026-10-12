# How the engine works: a primer

This is a teaching guide for someone new to the gameplay engine. It explains every term from the
ground up, with real examples from `shared/gameplay/abilities.json` and `statuses.json`.
[`ABILITIES.md`](ABILITIES.md) is the full reference. When the two disagree, the reference and the
code are right.

> **This primer describes the engine as of 2026-10-12**, after every prompt in
> [`ENGINE_REFACTOR_PROMPTS.md`](ENGINE_REFACTOR_PROMPTS.md) (1–10). For readers who knew the old engine:
>
> | Old | Now | Prompt |
> | --- | --- | --- |
> | `onTrigger`, "trigger tick" | `onActivate`, "activation tick" | 1 |
> | trap flags `botContact`, `attackHits`, `projectileOverlap` | `contact: [kinds]`; being hit = `health` | 2 |
> | effects `knockback`, `pull`, `teleport`; `teleportOncePerActivation` | one `displace` effect | 3 |
> | the trigger timeline (`atMs`), `oncePerTarget` | `targetPolicy.scope` | 4 |
> | lingering attacks as world entities | `"category": "attached"` | 5 |
> | entity-vs-entity effects re-scanned from the target's side | one collision dispatch from the source's side | 6 |
> | healing's `requiresConfirmedDamage` | `when` conditions and `removeStatus` | 7 |
> | reflection inside `dealDamage` | status reactions `hit` / `hitDealt`, with `charges` | 8 |
> | `seek` only chases enemies | `seek` with `target: "owner"`; `OWNER` collisions | 9 |
> | runtime reading `ABILITY_STATS`; implicit `activeMs` | timing read from the data; `activeMs` required | 10 |

Engine paths are relative to `shared/engine/`.

---

## 0. The big picture in five sentences

1. **Everything an ability does is data**, kept in `shared/gameplay/*.json`. No ability has its own code.
2. An ability is a list of **verbs** ("hit this area", "spawn a fireball", "dash forward") that all run
   at once, on the tick the ability activates.
3. Anything that lasts longer than an instant is an **entity**: a fireball, a mine, a drone, or a
   spinning blade attached to the bot. Its **phases** have **events**, and each event runs the same verbs.
4. Verbs change the world by applying **effects** (damage, heal, displace, status, ...). Every effect
   goes through one **registry**, and every change to a bot or entity goes through a few
   **mutator** functions.
5. A **status** (burn, slow, stun, ...) is a timed record on a bot. It is assembled from a preset, and
   the preset is made of a handful of **building blocks** (modifier, block, stun, ...).

The layers, from data down to state:

```
abilities.json   ── onActivate: [verbs] ────────────┐
                 └─ entities → phases → on: events → do: [verbs]
                                                    │
                     verbs.js  executeVerb()        ← one place that runs a verb
                                                    │
                     effects.js  EFFECTS registry   ← one apply function per effect type
                                                    │
                     effects.js  mutators           ← dealDamage, heal, applyStatus, displace, interrupt
                                                    │
                     bot / entity fields (hp, x, y, statusEffects, ...)
statuses.json  → presets that applyStatus builds into status records
```

**One rule decides where something goes:**

| It happens... | Write it as | Examples |
| --- | --- | --- |
| once, the moment the ability activates | an **activation verb** in `onActivate` | Slash, Pistol, Basic Heal, Dash, Frost Ring |
| over time, in a sequence, or only *if* something happens, as part of the bot's own attack | an **attached entity** | Whirlwind, a three-hit combo, a lunge, a swing that shatters on impact |
| as an object in the arena that others can see, dodge or destroy | a **world entity** | Fireball, Proximity Mine, Hunter Drone, Null Zone |

---

## 1. Verbs

### What a verb is

A verb is one instruction object with a `do` field naming what to do:

```json
{ "do": "hit", "hitbox": { ... }, "targets": ["BOT"], "effects": [ ... ] }
```

Verbs appear in two places:

- **`onActivate`** on the ability. These all run on the tick the ability's wind-up ends (the
  "activation tick").
- **`do` lists** inside an entity's events. These run when that event fires (a collision, a timer, ...).

Both places use **one executor**, `executeVerb` in `ecs/abilities/verbs.js`. A "hit" means the same
thing whether a sword swing or a drone's gun runs it.

> Why `onActivate` and not `onTrigger`? A trap's `trigger` (section 2) is a different thing: the
> moment a mine goes off. The ability side was renamed so "trigger" only ever means a trap.

### The seven verbs

| Verb | One-line meaning | Allowed in |
| --- | --- | --- |
| `hit` | Check a shape once and apply effects to everything it touches | activation, entity |
| `applyEffects` | Apply effects directly: to the owner (activation), or to the event's targets (entity) | activation, entity |
| `spawn` | Create an entity | activation, entity |
| `move` | Move the owner bot (a dash, or a lunge) | activation, **attached** entity |
| `transition` | Switch the entity to another phase | entity only |
| `remove` | Delete the entity | entity only |
| `emitVisual` | Record a visual event for the renderer (no gameplay effect) | entity only |

#### `hit`: instant area check

It asks "what does this shape touch right now?", nearest first, and applies `effects` to each target.

**Slash (id 1):** a 120° arc, 92 units long, 8 damage.

```json
{ "do": "hit",
  "hitbox": { "shape": "arc", "range": 92, "arc": 120, "includeTargetRadius": true },
  "targets": ["BOT", "HP_ENTITY"],
  "effects": [ { "type": "damage", "amount": 8, "targetKinds": ["BOT", "HP_ENTITY"] } ],
  "visual": { "type": "meleeSlash", "visualSize": 207, "visibleMs": 400 } }
```

- `hitbox`: the shape. There are four: `circle {radius}`, `rectangle {length, width}` (extends
  forward), `arc {range, arc}` (a pie slice), and `ray {range, width}` (a thin line, for guns and beams).
- `includeTargetRadius`: whether the target only needs to be *touched*, or its *center* has to be inside
  the shape. Hit detection (`findTargets.js`, `shapeHits`) treats a target as the point at its center.
  Bots are circles 60 units across, so their radius is 30. With `true`, the shape grows by the target's
  radius on every side before the check, so any overlap with the body counts. Slash's 92-unit arc
  reaches centers up to 92 + 30 = **122** units away, so the blade only has to touch the bot. Without
  it, the bot's center would have to be within 92 units, and a bot the blade visibly touches could be
  missed. That's where "effective melee reach = range + 30" comes from. It applies to `circle`,
  `rectangle` and `arc`; a `ray` always includes the target's radius (plus half its own width).
- `targets`: what the shape can touch: `BOT`, `HP_ENTITY` (an entity with health), `SUMMON` or `ENTITY`.
- `effects`: what happens to each thing touched (section 4).
- Optional fields:
  - `nearestOnly`: affect only the closest target.
  - `targetPolicy: { "mode": "once", "scope": "activation" }`: don't hit a target that something else
    from this same cast already hit. A single `hit` touches each target at most once anyway, so this
    only matters when **several** hitboxes are involved (see "Several hitboxes in one cast" below).
  - `aim: "seekTarget"`: for a drone, shoot only at the enemy it is chasing.
  - `origin`: where the shape starts relative to the bot.
  - `visual`: what the renderer draws.

**Disruptive Beam (id 30)** is a `ray` 600 long with three effects in order: 20 damage, a 300 ms stun,
and a 1.5 s slow. One verb can do many things, because the effects list is applied in order.

#### `applyEffects`: no shape, just apply

When it is an activation verb, it targets the owner (`"targets": ["OWNER"]`). This is how heals and
self-buffs work.

**Basic Heal (id 10):**

```json
{ "do": "applyEffects", "targets": ["OWNER"],
  "effects": [ { "type": "healing", "amount": 25, "targetKinds": ["BOT"] } ] }
```

**Overclock (id 33)** is the same verb with a status effect (`"subtype": "overclock"`) instead of a heal.

Inside an entity event, `applyEffects` applies to whatever set off the event, such as the bot a
fireball collided with.

#### `spawn`: create an entity

```json
{ "do": "spawn", "entity": "fireball" }
```

`entity` names a key in the same ability's `entities` object. An optional `pattern` spawns several at
once (1–12): `fan` (spread across an angle), `ring` (evenly around 360°) or `line` (side by side).

A `spawn` inside an entity event spawns from the entity's position. The bot still counts as the owner.

#### `move`: dash

**Dash (id 19):**

```json
{ "do": "move", "distance": 150, "unitsPerTick": 75,
  "visual": { "type": "dash", "visualSize": 114, "visibleMs": 300 } }
```

This moves the bot 150 units over 2 ticks. The **direction comes from the brain**: the Dash block has
its own direction setting, just as Walk does, and the engine turns it into a heading with the same
helpers walking uses. The data only says how far and how fast.

Only one move runs per bot: a new one replaces one still travelling. A move keeps travelling over
later ticks for as long as the ability that started it is active, in any channel. An attached entity
can also run `move` in its events: that is how a lunge in the middle of an attack works (section 2).

A verb's `visual` sets how long its bot effect shows (`visibleMs`).

#### `transition`, `remove`, `emitVisual`: entity housekeeping

- `{ "do": "transition", "to": "armed" }`: the entity switches to its phase named `armed`.
- `{ "do": "remove" }`: the entity disappears (a fireball after it hits).
- `{ "do": "emitVisual", "visualType": "mineExplosion", "visibleMs": 300, "visualSize": 175 }`: tells
  the renderer to draw a one-off flash (an explosion). It has no gameplay effect. Something that should
  stay on screen uses the phase `visual` instead (section 2).

### Activation verbs all happen at once

Every verb in `onActivate` runs on the activation tick. There is no "do this 200 ms later" field.
If you want time in your ability (a combo, a delay, a stream, a lunge), you spawn an **attached
entity** and let its phases keep time (section 2, "Attached entities"). That way there is one system
for anything over time, and it can also branch ("if the swing lands, then...").

> History: the engine used to have a "trigger timeline" (`atMs` on activation verbs, plus
> `oncePerTarget: "step" | "activation"`). It could only run fixed sequences, it couldn't branch, and
> its double-hit rules didn't extend to hitboxes that last more than a tick. Attached entities do all
> of that, so the timeline was removed.

#### Several hitboxes in one cast (the hammer)

A hammer blow: a narrow rectangle (the hammer head) and a wide circle (the shockwave), both on the
activation tick. A bot right in front is inside both. With `targetPolicy` scoped to the activation, it
takes only the first hitbox that reaches it (verbs run in list order, so the head's 12). A bot at the
edge is only in the circle and takes 6.

```json
"timing": { "cooldownMs": 5000, "windupMs": 400, "activeMs": 300 },
"onActivate": [
  { "do": "hit", "targetPolicy": { "mode": "once", "scope": "activation" },
    "hitbox": { "shape": "rectangle", "length": 90, "width": 50, "includeTargetRadius": true },
    "targets": ["BOT", "HP_ENTITY"],
    "effects": [ { "type": "damage", "amount": 12 }, { "type": "status", "subtype": "stun", "durationMs": 300 } ],
    "visual": { "type": "smash", "visualSize": 120, "visibleMs": 300 } },
  { "do": "hit", "targetPolicy": { "mode": "once", "scope": "activation" },
    "hitbox": { "shape": "circle", "radius": 130, "includeTargetRadius": true },
    "targets": ["BOT", "HP_ENTITY"],
    "effects": [ { "type": "damage", "amount": 6 }, { "type": "displace", "who": "target", "from": "source", "direction": "away", "distance": 60 } ] }
]
```

(The made-up examples in this primer use real field names, but their IDs, numbers and visual types
aren't real abilities. Effects that leave out `targetKinds` use the defaults from section 4.)

This is how several hitboxes combine into one distinctive ability: a sweet spot plus a weaker area,
a cross made of two rectangles, an arc plus a ray, without a bot in the overlap being hit twice.
Phase Strike is built this way too (section 4, `displace`).

### When each verb runs

A verb runs in the tick stage that owns it (section 3):

| Verb | Stage |
| --- | --- |
| `move` | act |
| `spawn` | built at the end of act, added to the world in spawn |
| `hit`, `applyEffects` | resolveHits |
| entity `do` verbs | entities |

---

## 2. Entities

### What an entity is

An entity is anything an ability puts in the world that lives over time. **They all have the same
structure**, which we call the "envelope". There is no separate code for "fireball" versus "mine".
The difference is only in the data.

```text
entity: {
  runtimeType, category,        // name and kind: projectile | zone | trap | summon | attached
  spawn,                        // where it appears relative to the owner
  targeting,                    // who owns it; optionally "place at the target's position"
  lifetime: { duration },       // how long it may exist, at most
  initialState, state,          // starting flags; values snapshotted at spawn (damageMultiplier)
  phases: [ phase, phase, ... ] // its life story, one chapter at a time
}
```

`category` is mostly a label, with one exception: **`attached`** changes the rules (see "Attached
entities" below).

### Phases

A phase is one chapter of an entity's life. The first phase in the list is where it starts. It
reaches later phases only through a `transition` verb.

```text
phase: {
  id, type,            // name; host type projectile | zone | summon
  durationMs,          // when this phase's lifetimeEnd event fires (optional)
  movement,            // how it moves during this phase
  hitbox,              // its body (for collisions, and for being hit)
  health,              // optional: it can be damaged and killed
  trigger,             // optional: makes it a trap
  visual,              // what the renderer draws, the whole time it is in this phase
  skipOwner,           // ignore the owner bot
  on: { event: {...} } // what happens, and when
}
```

**Proximity Mine (id 11)** shows phases well:

```
travel (800 ms, slides forward 22/tick)
   └─ on lifetimeEnd → transition to "armed"
armed (20 s, static, trigger radius 87.5, body radius 12, 1 HP)
   ├─ on trigger (an enemy bot comes close) → transition to "active"
   ├─ on killed  (someone hit the mine)     → transition to "active"
   └─ on lifetimeEnd (nobody came)          → transition to "active"
active (100 ms, static, circle radius 87.5)
   └─ on collision (once) → applyEffects 30 damage, emitVisual "mineExplosion"
   (phase ends, no lifetimeEnd handler → entity removed)
```

A transition keeps the same entity ID, but resets the phase timer, the schedule timers and the record
of who it has already hit.

### Movement modes (`phase.movement.mode`)

| Mode | What it does | Example |
| --- | --- | --- |
| `straight` | Moves forward (or `direction: "backward"`) at `unitsPerTick` | Fireball: 50/tick |
| `static` | Stays put | Mine `armed`, Null Zone |
| `seek` | Turns up to `turnDegrees` per tick toward `target` (`nearestEnemy`, the default: the nearest living enemy; or `owner`), then moves `unitsPerTick` | Hunter Drone: 4.5/tick, 8°/tick; a boomerang's return: `target: "owner"` |
| `followOwner` | Every tick, takes the owner's position and facing plus its spawn offset | Whirlwind, every attached attack |

### Health (`phase.health`)

```json
"health": { "hp": 50, "maxHp": 50 }
```

With this, the entity is an **HP entity**: attacks that target `HP_ENTITY` can damage its body
(`hitbox`). When it takes damage, its `hit` event fires. When its HP reaches 0, its `killed` event
fires. **An HP entity with no `killed` handler is simply removed** when it dies.

- Hunter Drone has 50 HP, and its `killed` handler is `[ { "do": "remove" } ]`.
- Proximity Mine's `armed` phase has **1 HP** and a `killed` handler that transitions to `active`:
  any damage at all blows it up. That is how "shoot the mine to set it off" works.

Damage on an entity is simple: HP goes down by the amount. There is no immunity, no modifiers and no
stagger. Only enemies can damage it, unless `health.allowFriendlyDamage` is true.

### Trigger (`phase.trigger`): this is what makes a trap

```json
"trigger": { "radius": 87.5, "contact": ["BOT"] }
```

A trap has **two separate sensors**, and it helps to keep them apart:

| Sensor | Field | What it notices | Fires |
| --- | --- | --- | --- |
| **Proximity** | `trigger.radius` + `trigger.contact` | An enemy **body** of a listed kind coming inside the radius | the `trigger` event |
| **Body** | `hitbox` + `health` | **Damage** landing on the trap itself | `hit`, then `killed` |

- `contact` lists which enemy bodies count for proximity: `"BOT"` and optionally `"SUMMON"` (an enemy
  drone walking in). Projectiles and attacks never count for proximity: a fireball flying *near* the
  mine does nothing.
- **Being hit is just damage.** Anything that damages the trap's body sets off its `hit`/`killed`
  events, whatever it is: a Slash, a fireball, a drone shot, an attached-entity swing. Who can hit it
  follows the normal rules (the attack's `targets`/`targetKinds` must include `HP_ENTITY`, and only
  enemies, unless friendly damage is allowed).
- A swing that passes inside the radius but misses the body does nothing: it isn't a body, so
  proximity ignores it, and it dealt no damage.
- `chain`: when this trap fires, other traps **from the same ability** within its trigger radius fire
  too.

`trigger.radius` is never the body. The trigger radius decides **"when do I go off by myself?"**; the
hitbox is **what you can shoot**. Validation rejects a trap phase that mixes them up.

> History: there used to be two more flags, `attackHits` (an instant `hit` touched the trap) and
> `projectileOverlap` (any projectile-phase entity overlapped it, including your own). Each counted a
> different subset of attacks. Giving the trap health replaces both with one consistent rule.

### Events (`phase.on`)

An event is **"when X happens, run these verbs"**. The phase holds a map from event name to handler:

| Event | Fires when |
| --- | --- |
| `collision` | The phase's hitbox overlaps a target |
| `trigger` | The trap's proximity sensor (or a chain) set it off |
| `hit` | This entity was damaged |
| `killed` | This entity's HP reached 0 |
| `lifetimeEnd` | The phase's `durationMs` ran out (or the entity's lifetime did) |
| `schedule` | A repeating timer came due |

A handler looks like this. This is Fireball's `collision`:

```json
"collision": {
  "targets": ["BOT", "HP_ENTITY"],
  "schedule": { "mode": "continuous" },
  "do": [
    { "do": "applyEffects", "effects": [
        { "type": "damage", "amount": 20, "targetKinds": ["BOT", "HP_ENTITY"] },
        { "type": "status", "subtype": "burn", "amount": 2, "durationMs": 5000, "targetKinds": ["BOT", "SUMMON"] } ] },
    { "do": "remove" }
  ]
}
```

Read it as: *"Every tick, if I overlap a bot or HP entity, deal 20 damage and apply burn to it, then
delete myself."*

The handler fields:

- `targets`: what can set off this event, and who the `do` verbs reach.
- `schedule.mode`: when the event is checked:
  - `continuous`: every tick (the default for collision).
  - `once`: only when the phase starts. Anything that arrives later misses. Combined with a short
    `durationMs`, this is "one instant hit when this phase begins".
  - `repeat`: every `intervalMs`, optionally `count` times.
- `targetPolicy`: how often the same target can be affected.
  - `mode`: `everyTick` (the default), `once`, or `interval` (with `intervalMs`).
  - A `hit` verb inside an entity event takes `once` or `everyTick`. An activation `hit` takes only
    `{ "mode": "once", "scope": "activation" }`.
  - `scope`: how long the "already hit" memory lasts:

    | `scope` | Memory lasts | Use it for |
    | --- | --- | --- |
    | `phase` (default) | until the entity changes phase | each strike of a combo can hit once |
    | `entity` | the entity's whole life | a projectile that passes through but hits each bot once |
    | `activation` | **everything this cast created**: its activation `hit`s and all its entities | several hitboxes that must not stack on one bot |

- `nearestOnly`: affect only the closest overlapping target. Tether Bolt uses this so it latches onto
  one bot.
- `waitForHit` (for `schedule` events): stay "due" until a `hit` verb in it actually connects. A drone
  doesn't waste its shot when nobody is in range.
- `recheckCollisionOnTransition: false`: after a transition into this phase, skip the new phase's
  collision check on the same tick.

#### Example: `waitForHit` on Hunter Drone (id 17)

The drone's gun is a `schedule` event:

```json
"schedule": {
  "targets": ["BOT"],
  "schedule": { "mode": "repeat", "intervalMs": 1000, "startImmediately": true },
  "waitForHit": true,
  "do": [ { "do": "hit", "aim": "seekTarget",
            "hitbox": { "shape": "ray", "range": 200, "width": 5 },
            "effects": [ { "type": "damage", "amount": 5 } ] } ]
}
```

The entity has one countdown, `intervalTimerMs`. When it reaches 0, the event is **due** and its `do`
list runs. What happens next depends on whether the shot connected:

| Tick | Enemy distance | Shot | Countdown afterwards |
| --- | --- | --- | --- |
| spawn | 350 (out of range) | runs, misses | **not reset**: still due |
| +100 ms | 300 | runs, misses | still due |
| +200 ms | 190 (in range) | runs, **hits** for 5 | reset to 1000 ms |
| +300 … +1100 ms | any | doesn't run | counting down |
| +1200 ms | 180 | runs, hits | reset to 1000 ms |

So with `waitForHit` the drone tries **every tick** until it lands a shot, then waits the full
interval. Without it, the countdown resets after every attempt: the drone fires once a second whether
or not anyone is in range, and a miss wastes that second. That would mean a drone that spawns far
away usually fires its first shot into nothing.

`aim: "seekTarget"` means the ray only counts the enemy the drone is chasing (its `seek` target), so it
can't "connect" on some other bot that wandered across its line.

### `do` lists

A `do` list is just a list of verbs (section 1), run in order. That is the whole trick: **entities
don't have special behaviour, they have events, and events run verbs.**

### Putting it together: entity "kinds" made from the same parts

- **Projectile** (Fireball): `straight` movement + a `collision` event + `remove`.
- **Trap** (Proximity Mine): a phase with `trigger` and 1 HP + `trigger` and `killed` events that
  transition into an exploding phase.
- **Summon** (Hunter Drone): `seek` movement + `health` + a `schedule` event (repeat every 1000 ms,
  `waitForHit`) whose `do` is an aimed `hit` (a 200-unit ray, 5 damage).
- **Zone** (Null Zone): `static` + a `continuous` `collision` that applies a status every tick.
- **Attached** (Whirlwind, combos): `followOwner` + phases that keep time, below.

### Attached entities

An attached entity is **part of the bot's own attack**, not an object in the arena. Use it whenever
an attack needs time, a sequence, or a condition. `"category": "attached"` gives it these rules:

1. **Brains can't select it.** It isn't listed as an ability entity in conditions.
2. **Nothing can target it.** It has no target kinds, so no hit, projectile or zone reaches it, and
   it can't have `health`.
3. **It ends with the attack.** It is removed when the owner's ability is interrupted (stun) or the
   owner dies. Anything it already spawned (shards, fireballs) stays.
4. **It hits like a weapon.** Its collision tests its phase `hitbox` (arc, rectangle, ray or circle,
   with `includeTargetRadius`) exactly like an activation `hit`, from its own pose.
5. **It can move the owner**: `move` is allowed in its event `do` lists (a lunge).
6. Its phase `visual` is drawn the whole time it's in that phase, so a spin looks like one steady
   image, not a flicker.

It almost always uses `followOwner` movement, so it stays on the bot as the bot moves and turns.

The examples below are made up. Only the entity part is shown; the ability's `onActivate` is
`[ { "do": "spawn", "entity": "<name>" } ]`.

#### Example: Whirlwind (a spin that lasts)

The bot spins for 1.5 s, hurting everyone near it at most every 200 ms.

```json
"whirlwind": {
  "category": "attached",
  "spawn": { "offset": { "x": 0, "y": 0 }, "rotation": 0, "rotationSpace": "owner" },
  "targeting": { "owner": "owner" },
  "lifetime": { "timerMode": "remaining", "duration": 1500 },
  "phases": [ {
    "id": "spinning", "type": "zone", "skipOwner": true,
    "movement": { "mode": "followOwner" },
    "hitbox": { "shape": "circle", "radius": 100, "includeTargetRadius": true },
    "visual": { "type": "whirlwind", "visualSize": 200 },
    "on": { "collision": {
      "targets": ["BOT", "HP_ENTITY"],
      "schedule": { "mode": "continuous" },
      "targetPolicy": { "mode": "interval", "intervalMs": 200 },
      "do": [ { "do": "applyEffects", "effects": [ { "type": "damage", "amount": 3 } ] } ] } }
  } ] }
```

- A `continuous` collision checks overlap every tick, and `targetPolicy` says each bot can be hit once
  every 200 ms. It's tracked per target, so a bot that walks in late still gets hit.
- A stun ends the spin at once (rule 3).

#### Example: a three-hit combo (phases as steps)

Three cuts, 200 ms apart, each aimed wherever the bot faces when it swings. Each phase is one step:
its collision is `once` (an instant hit as the phase begins), and when its `durationMs` runs out it
moves on.

```json
"combo": {
  "category": "attached",
  "spawn": { "offset": { "x": 0, "y": 0 }, "rotation": 0, "rotationSpace": "owner" },
  "targeting": { "owner": "owner" },
  "lifetime": { "timerMode": "remaining", "duration": 600 },
  "phases": [
    { "id": "cut1", "type": "zone", "durationMs": 200, "movement": { "mode": "followOwner" },
      "hitbox": { "shape": "arc", "range": 90, "arc": 100, "includeTargetRadius": true },
      "visual": { "type": "meleeSlash", "visualSize": 180 },
      "on": { "collision":   { "targets": ["BOT", "HP_ENTITY"], "schedule": { "mode": "once" },
                               "do": [ { "do": "applyEffects", "effects": [ { "type": "damage", "amount": 5 } ] } ] },
              "lifetimeEnd": { "do": [ { "do": "transition", "to": "cut2" } ] } } },
    { "id": "cut2", "...": "same as cut1, with lifetimeEnd → transition to cut3" },
    { "id": "cut3", "type": "zone", "durationMs": 200, "movement": { "mode": "followOwner" },
      "hitbox": { "shape": "arc", "range": 110, "arc": 140, "includeTargetRadius": true },
      "visual": { "type": "meleeSlash", "visualSize": 220 },
      "on": { "collision": { "targets": ["BOT", "HP_ENTITY"], "schedule": { "mode": "once" },
                             "do": [ { "do": "applyEffects", "effects": [
                               { "type": "damage", "amount": 10 },
                               { "type": "displace", "who": "target", "from": "source", "direction": "away", "distance": 80 } ] } ] } } }
  ] }
```

The "already hit" memory is scoped to the phase by default, and it resets on each transition, so
every cut can land on the same bot. A stun at +300 ms removes the entity: the finisher never happens,
and the first two cuts stay dealt. `cut3` has no `lifetimeEnd` handler, so the entity is removed when
it ends.

#### Example: a swing that shatters only if it lands (a condition)

A heavy swing. If it hits someone, it bursts into three shards that fly onward; if it misses,
nothing more happens.

```json
"phases": [ {
  "id": "swing", "type": "zone", "durationMs": 100, "movement": { "mode": "followOwner" },
  "hitbox": { "shape": "arc", "range": 100, "arc": 90, "includeTargetRadius": true },
  "on": {
    "collision": { "targets": ["BOT", "HP_ENTITY"], "schedule": { "mode": "once" }, "nearestOnly": true,
                   "do": [ { "do": "applyEffects", "effects": [ { "type": "damage", "amount": 14 } ] },
                           { "do": "spawn", "entity": "shard", "pattern": { "type": "fan", "count": 3, "spreadDeg": 40 } },
                           { "do": "remove" } ] },
    "lifetimeEnd": { "do": [ { "do": "remove" } ] } } } ]
```

`shard` is a normal world projectile defined in the same ability's `entities`. `nearestOnly` makes
the swing react to one target, so it spawns one set of shards, not one set per bot it touched.
The timeline could never express this "if", because it had no events.

#### Example: a lunge (moving the owner mid-attack)

A 200 ms crouch, then the bot leaps 150 units and stabs from where it lands.

```json
"phases": [
  { "id": "crouch", "type": "zone", "durationMs": 200, "movement": { "mode": "followOwner" },
    "on": { "lifetimeEnd": { "do": [ { "do": "move", "distance": 150, "unitsPerTick": 150 },
                                     { "do": "transition", "to": "stab" } ] } } },
  { "id": "stab", "type": "zone", "durationMs": 100, "movement": { "mode": "followOwner" },
    "hitbox": { "shape": "rectangle", "length": 120, "width": 40, "includeTargetRadius": true },
    "on": { "collision": { "targets": ["BOT", "HP_ENTITY"], "schedule": { "mode": "once" },
                           "do": [ { "do": "applyEffects", "effects": [ { "type": "damage", "amount": 18 } ] } ] } } } ]
```

The `move` heads where the brain's ability action points, like a dash. `unitsPerTick` equal to
`distance` makes it a one-tick leap. The `stab` phase checks its hit from the bot's **new** position.

#### Example: a beam stream (a repeating hit)

A beam that pulses every 100 ms for half a second and sweeps as the bot turns.

```json
"beam": {
  "category": "attached",
  "lifetime": { "timerMode": "remaining", "duration": 500 },
  "phases": [ { "id": "firing", "type": "zone", "movement": { "mode": "followOwner" },
    "visual": { "type": "beam", "visualSize": 10 },
    "on": { "schedule": { "schedule": { "mode": "repeat", "intervalMs": 100, "count": 5, "startImmediately": true },
                          "do": [ { "do": "hit", "hitbox": { "shape": "ray", "range": 400, "width": 10 },
                                    "targets": ["BOT", "HP_ENTITY"],
                                    "effects": [ { "type": "damage", "amount": 3 } ] } ] } } } ] }
```

The same `schedule` + `hit` pattern as the drone's gun, without `waitForHit`: it fires on every pulse.
A bot that stays in the beam takes 5 × 3 = 15 damage. (`spawn` and `targeting` are left out for brevity;
they're the same as in the other examples.)

A **volley** is the same shape with a `spawn` instead of a `hit`: `repeat` every 200 ms, `count: 3`,
`do: [ { "do": "spawn", "entity": "fireball" } ]`. Each fireball leaves from wherever the bot aims at
that moment, and a stun cancels the shots not yet fired (the flying ones keep going).

#### Example: a lingering hammer (`scope: "activation"` over several ticks)

The hammer from section 1, but both parts linger for 300 ms. Spawn two attached entities, `head`
(the rectangle) then `wave` (the circle), and give both collisions:

```json
"targetPolicy": { "mode": "once", "scope": "activation" }
```

Now the "already hit" memory is shared by **everything this cast created**. A bot the head hits on the
first tick can't be hit by the wave on the third. Entities tick in spawn order, so when both touch a
bot on the same tick, the one spawned first (the head) wins.

#### Example: a boomerang (out, then home to the owner)

A boomerang flies straight out and hits what it touches once, then turns into a phase that homes back to its
owner and is removed when it touches the owner. Two things make this work: `seek` with `"target": "owner"`, and a
collision event that names `OWNER`.

```json
"phases": [
  { "id": "out", "type": "projectile", "durationMs": 400,
    "movement": { "mode": "straight", "unitsPerTick": 20 },
    "on": {
      "collision": { "targets": ["BOT"], "targetPolicy": { "mode": "once", "scope": "phase" },
                     "do": [ { "do": "applyEffects", "targets": ["BOT"], "effects": [ { "type": "damage", "amount": 5 } ] } ] },
      "lifetimeEnd": { "do": [ { "do": "transition", "to": "back" } ] } } },
  { "id": "back", "type": "projectile", "durationMs": 1000,
    "movement": { "mode": "seek", "target": "owner", "unitsPerTick": 20, "turnDegrees": 180 },
    "on": {
      "collision": { "targets": ["BOT", "OWNER"], "targetPolicy": { "mode": "once", "scope": "phase" },
                     "do": [ { "do": "applyEffects", "targets": ["BOT"], "effects": [ { "type": "damage", "amount": 5 } ] },
                             { "do": "remove", "targets": ["OWNER"] } ] },
      "lifetimeEnd": { "do": [ { "do": "remove" } ] } } }
]
```

The `back` phase has no owner to return to (the owner is dead), so it holds still and expires with its duration.
Its one `collision` event names both kinds, and each verb says which target it reaches: the `applyEffects` hits
enemies on the way back (once, in this phase), and the `remove` runs only when the owner is touched, so the owner
is never hurt by its own boomerang. A verb's own `targets` is what makes that possible (ABILITIES.md section 2,
"`targets` on a verb in an entity event").

### Choosing: activation verb, attached entity or world entity

| Question | Activation verb | Attached entity | World entity |
| --- | --- | --- | --- |
| Lasts more than one tick? | no | yes | yes |
| Can branch ("if it lands...")? | no | yes (events) | yes (events) |
| Brains can see it? | no | no | yes |
| Can be hit or destroyed? | no | no | yes, with `health` |
| Ends when the caster is stunned? | (instant) | **yes** | no, it keeps going |
| Example | Slash, Heal, Dash | Whirlwind, combo, lunge | Fireball, Mine, Drone, Null Zone |

A delayed slam on a marked spot is a **world** entity (a zone with a warning phase, then a blast
phase): it's an object the opponent can see and dodge, and it keeps going if you're stunned.

---

## 3. One tick

The game runs in fixed 100 ms ticks. `fight.js` (`createFight(setup).step()`) runs **seven named
stages**, always in this order. Every combat-log entry records which stage produced it.

| # | Stage | What happens |
| --- | --- | --- |
| 1 | **decide** | Entities age, and each bot's one-tick outputs clear. Each brain reads a snapshot of the start of the tick and picks at most one action per category: movement, rotation, ability, dash, cancel. |
| 2 | **act** | Per bot, in order: stamina timers (regeneration) → stun check (a stunned bot does nothing) → Cancel Wind-up → walk, sprint, turn → the ability (continue the wind-up, or **activate** when it ends: active time, cooldown, `move` verbs) → the dash channel → status timers (`schedule` and `lifetimeEnd` events of statuses run here) → `spawn` verbs build their entities. |
| 3 | **resolveHits** | Every activated `hit` and `applyEffects` runs. Bots take effects now. A hit on an HP entity is **queued** in the tick's one impact queue for stage 5. |
| 4 | **spawn** | Entities built in act join the world. |
| 5 | **entities** | First, `followOwner` entities take their owner's pose, and attached entities whose ability was interrupted are removed. Then each entity: clocks advance → the bots' hits queued for it land (it may fire `hit` or `killed`) → it moves by its movement mode → due events run their verbs. An entity hit or collision that applies effects to an HP entity queues them. Traps settle together first, because one explosion can chain into a neighbour. Last, every queued entity impact lands in one pass over the entities (order-independent; a target may fire `hit` or `killed`). |
| 6 | **hazards** | Closing-zone damage. |
| 7 | **settle** | Banked healing is paid, damage-taken counters update, Time Since Hit ages, and banked stamina refunds (+10 for landing a hit) are paid. |

Two things to remember:

- Brains decide on the **start-of-tick snapshot**, so a bot never reacts to something that happens
  later in the same tick.
- Healing is **banked** and paid in settle. A bot that takes lethal damage and a heal in the same
  tick dies; the heal can't revive it.

---

## 4. Effects and the effect registry

### What an effect is

An effect is one change to one target. It is a small object with a `type`:

```json
{ "type": "damage", "amount": 20, "targetKinds": ["BOT", "HP_ENTITY"] }
```

`targetKinds` filters which kinds of target receive this particular effect. In Frost Ring, damage
reaches `BOT` and `HP_ENTITY`, but slow and the knockback (`displace`) reach `BOT` and `SUMMON`. The defaults are
`[BOT, HP_ENTITY]` for damage and `[BOT]` for everything else.

### The registry

`effects.js` has one table:

```js
export const EFFECTS = Object.freeze({
    damage:        { apply: applyDamage },
    healing:       { self: true, apply: applyHealing },
    status:        { apply: applyStatusEffect },
    remove_status: { apply: applyRemoveStatus },
    displace:      { apply: applyDisplace },
    restore_state: { self: true, apply: applyRestoreState },
});
```

And **one loop** that every verb, entity event and status event uses:

```text
applyEffectList(effects, ctx)
  for each effect, in order:
    skip it if its targetKinds don't include this target's kind
    skip it if a `when` check fails (section "Conditions" below)
    EFFECTS[effect.type].apply(ctx)
    if it was damage that landed → mark "damage confirmed" for the effects after it
  return { landedOnEnemy, damageConfirmed, damageConfirmedAmount }
```

`ctx` is the context bag: `source` (what the effect came from), `owner` (the bot that owns the
source), `target`, `distance`, `abilityId`, `damageMultiplier`, and so on.

`self: true` means the effect changes the owner (heal, restore). Self effects are skipped when the
source is an entity, because an entity has no "self" to heal. A `displace` with `"who": "owner"` follows
the same rule: it is allowed only in `onActivate`.

### Why this is "more structured"

Before, effect handling was split: one path for bots, another for entities, and statuses had their
own kinds of tick logic. Now:

- **One table** says which effect types exist. Adding an effect type means adding one row and one
  function.
- **One loop** applies them, so the order of effects, "damage confirmed" tracking and hit-landed
  tracking behave the same everywhere: an ability's swing, a fireball's collision, a drone's shot,
  even a burn tick.
- The same apply function handles a bot and an HP entity. The few rules that only apply to bots are
  steps inside the mutators (below), not separate code paths.

### Each effect type

| Effect | Fields | What happens |
| --- | --- | --- |
| `damage` | `amount`, or `falloff { maxAmount, minAmount, falloffStart, falloffEnd }` | Amount (at distance) × source damage multiplier → `dealDamage`. If an entity dealt it, the entity's owner gets the credit, so reflection hits the owner. |
| `healing` | `amount`, `recipient`, `mirrorsDamage`, `when` | Banks healing (paid in settle). The recipient is the owner unless `recipient` is `"target"`. **Vampiric Beam (32)**: damage 25→15 by distance, then healing with `mirrorsDamage` and `when: [{ measure: "damageConfirmed" }]`, so it heals exactly the damage the beam dealt, and only if it dealt any. |
| `status` | `subtype`, `durationMs`, `amount`, `intervalMs`, `movementLockMs`, `whileInside` | Builds a status from the preset named by `subtype` and puts it on the target (section 6). |
| `remove_status` | `subtype` | Takes the status with that preset name off the target, in every mode. Its `lifetimeEnd` does not run (a cleanse, not an expiry). |
| `displace` | `who`, `from`, `direction`, `distance` | Moves one combatant relative to a point, clamped to the arena. Replaces knockback, pull and teleport; see below. |
| `restore_state` | none | Only used by Rewind's status (section 6). Restores the saved x, y and hp. |

**Falloff:** the value scales linearly from `maxAmount` at `falloffStart` to `minAmount` at
`falloffEnd`, measured center to center. Status durations can fall off in the same way.

### Conditions (`when`): a bonus that applies only sometimes

An effect may carry `when`, a list of checks that must all pass for it to apply (AND only). The check runs in
`applyEffectList`, right before that effect, on the live state. Execute is a base hit plus a bonus that needs the
target under 30% health:

```json
"effects": [
  { "type": "damage", "amount": 10, "targetKinds": ["BOT"] },
  { "type": "damage", "amount": 8, "targetKinds": ["BOT"],
    "when": [ { "of": "target", "measure": "hpRatio", "op": "<", "value": 0.3 } ] }
]
```

A `damageConfirmed` check reads the damage an earlier effect in the list landed, so healing is written as
`"when": [{ "measure": "damageConfirmed" }]`. A `remove_status` effect takes a status off the target (its
`lifetimeEnd` does not run), so a shatter-style bonus can check `hasStatus` and then remove it. The full list
of measures and the validation rules are in [`ABILITIES.md`](ABILITIES.md), "Effects and `when` conditions".

### `displace`: one effect for every push, pull and blink

Knockback, pull and teleport used to be three effect types, each with its own code. They all answer
the same three questions, so they are now one effect:

```json
{ "type": "displace", "who": "target", "from": "source", "direction": "away", "distance": 300 }
```

| Field | Values | Meaning |
| --- | --- | --- |
| `who` | `target`, `owner` | who moves: the thing that was hit, or the bot that owns the ability |
| `from` | `source`, `owner`, `target` | the reference point: what hit it (the bot, or the fireball), the owner bot, or the target |
| `direction` | `away`, `toward`, `mirror` | push away from the point, pull toward it, or land on the far side of it |
| `distance` | units | how far (`away`/`toward`; supports `falloff` like damage). `mirror` takes none: it lands as far past the point as the mover started from it |

The old effects, rewritten:

| Was | Now |
| --- | --- |
| Repelling Blast: `knockback` 300 | `{ "who": "target", "from": "source", "direction": "away", "distance": 300 }` |
| Gravity Grenade: `pull` 6 (every tick while inside) | `{ "who": "target", "from": "source", "direction": "toward", "distance": 6 }` |
| Tether Bolt: `pull` with `pullDirection: "owner"` | `{ "who": "target", "from": "owner", "direction": "toward", ... }` |
| Phase Strike: `teleport` with `center_distance` | `{ "who": "owner", "from": "target", "direction": "mirror" }` |

**Phase Strike (id 25)**, which used to need its own flag (`teleportOncePerActivation`) and special
branches inside the `hit` verb, is now two ordinary hits on the activation tick:

```json
"activation": { "capture": { "hitboxOriginX": "x", "hitboxOriginY": "y", "hitboxRotation": "rotation" } },
"onActivate": [
  { "do": "hit", "nearestOnly": true, "targetPolicy": { "mode": "once", "scope": "activation" },
    "hitbox": { "shape": "rectangle", "width": 60, "length": 100, "includeTargetRadius": true },
    "targets": ["BOT", "HP_ENTITY"],
    "effects": [ { "type": "displace", "who": "owner", "from": "target", "direction": "mirror", "targetKinds": ["BOT"] },
                 { "type": "damage", "amount": 15, "targetKinds": ["BOT", "HP_ENTITY"] } ] },
  { "do": "hit", "targetPolicy": { "mode": "once", "scope": "activation" },
    "hitbox": { "shape": "rectangle", "width": 60, "length": 100, "includeTargetRadius": true },
    "targets": ["BOT", "HP_ENTITY"],
    "effects": [ { "type": "damage", "amount": 15, "targetKinds": ["BOT", "HP_ENTITY"] } ] }
]
```

1. The first hit only takes the **nearest** target: the bot blinks through it and damages it.
2. The second hit damages everyone else in the box. The nearest is skipped, because the shared
   activation memory says it was already hit.
3. `activation.capture` saves the bot's pose before anything moves, so the second box is still where
   the first one was, not where the bot landed.

There is no "relative to facing" option. A blink forward is already a `move` with `unitsPerTick`
equal to its `distance` (one tick), in the direction the brain chooses.

---

## 5. Mutators

A **mutator** is one of the few functions allowed to change a combatant. If anything in the engine
damages, heals, statuses or moves a bot or entity, it goes through one of these:

| Mutator | Job |
| --- | --- |
| `dealDamage(target, amount, source, { log })` | Hurt something |
| `heal(target, amount)` / `settleHealing(target)` | Bank healing / pay it out in settle |
| `applyStatus(target, effect, ...)` | Add or refresh a status |
| `displace(target, move, world, { landing })` | Move a combatant, inside the arena. `move` is `{ dx, dy, distance }` (a push or pull) or `{ across }` (land as far past that point as you stood from it). `landing: true` is for the owner's own blink: velocity stops and the bot turns by its phase facing. Every `displace` effect goes through it |
| `interruptCurrentAbility(bot)` | Cancel a wind-up or active ability and start its cooldown |

They **change the target in place** for speed. But nested values (the status list, the ability
records) are **replaced, not edited**, so a frame copied earlier never changes under the renderer.

### What `dealDamage` does, step by step (for a bot)

1. Dead already? Stop.
2. Does it have **immunity** (Absolute Guard)? Stop.
3. Multiply by the bot's **`incomingDamage` modifier** (section 7).
4. Round (and truncate to tenths if a modifier asks for it).
5. Subtract from HP, update the damage-taken counter, the hit flash and the particle counter.
6. If the damage was above 0 and came from an **enemy** → apply **hit stagger** (a status: 300 ms of
   ×0.85 move and turn speed).
7. If HP is 0 → clear its statuses.
8. Reflection is no longer part of this step: Reactive Armor's reflection is a `hit` reaction, dispatched by
   `applyEffectList` right after the damage (section 6, "Reactions").

For an entity, it is just steps 5 and 7: HP down, never below 0.

This is why there is no "damage path for bots" and "damage path for drones" scattered around the
code. Every source of damage calls this one function, so every rule above is applied in exactly one
place.

---

## 6. Statuses

### What a status is

A status is a **record on a bot (or summon)** in its `statusEffects` list, with a timer:

```text
{ type: "burn",            // which preset it came from
  mode: "duration",        // "duration" (counts down) or "presence" (lasts while you stand in a zone)
  remainingMs: 5000,
  tickMs: 1000, tickElapsedMs: 0,   // for statuses that tick
  sourceSlot: 1,           // who applied it (for statuses that carry it)
  abilityId: 5,
  effects: [ ... ],        // what it does continuously while active  ← building blocks
  on: { schedule: {...}, lifetimeEnd: {...} } | null,  // what it does at moments ← events
  snapshot: { x, y, hp } | null }   // captured values (Rewind)
```

### Presets: where statuses come from

You never write a status record by hand. An ability applies a **`status` effect** that names a
**preset** in `statuses.json`:

```json
{ "type": "status", "subtype": "burn", "amount": 2, "durationMs": 5000 }
```

`applyStatus` looks up `statuses.burn` and builds the record from it.

**Tokens** fill in numbers from the effect that applied it:

- `"$amount"` → the effect's `amount` (2).
- `"$damageMultiplier"` → the attacker's damage multiplier at that moment.
- `"$movementLockMs"` → the effect's `movementLockMs`.

So one `burn` preset serves any ability that wants any burn strength.

**Preset flags:**

| Flag | Meaning |
| --- | --- |
| `presenceWhenInside` | Can be a "presence" status (lasts only while inside a zone) |
| `carriesSourceSlot` | Remembers who applied it (damage over time does) |
| `clearsVelocity` | Stops the bot dead when applied (stun) |
| `interrupts` | Interrupts the target's ability when applied (stun) |
| `captures` | Copies these fields into `snapshot` when applied (Rewind: `["x", "y", "hp"]`) |

**Applying the same status again** refreshes it instead of stacking a second copy. It keeps the
longer remaining time and the larger numbers, and it keeps a ticking status's clock, so re-applying
burn doesn't reset when its next tick lands.

### Building blocks: what a status does *while active*

The preset's `effects` list is made from only a few building blocks (`STATUS_EFFECT_APPLICATIONS` in
`gameconfig/vocabulary.js`):

| Building block | Meaning |
| --- | --- |
| `modifier { stat, multiply }` | Scale a stat (section 7) |
| `block { actions }` | Forbid actions: `ability`, `dash`, `move`, `sprint`, `fastTurn` |
| `stun` | Forbid everything |
| `on.hit` / `on.hitDealt { target, consume, from, effects }` | React when an attack hits the holder (or the holder's attack hits an enemy) |
| `damage_immunity` | Ignore hostile effects |

Every status in the game is a combination of these:

| Preset | Built from |
| --- | --- |
| `silence` | `block ["ability"]` |
| `movement-lock` | `block ["move", "sprint"]` |
| `stun` | `stun` (+ `clearsVelocity`, `interrupts`) |
| `slow` | `modifier moveSpeed ×0.5`, `modifier turnSpeed ×0.5`, `block ["dash", "sprint"]` |
| `hit-stagger` | `modifier moveSpeed ×0.85`, `modifier turnSpeed ×0.85` |
| `overclock` | `modifier cooldown ×0.5` |
| `reactive-armor` | `modifier incomingDamage ×0.5`, and `on.hit` (target: attacker) that deals `$hitAmount` × 0.5 |
| `absolute-guard` | `damage_immunity` |
| `bleed` | `modifier incomingDamage ×1.25` (not counting bleed's own ticks) + a schedule event |
| `burn`, `shock` | no continuous effects, only a schedule event |
| `rewind` | no continuous effects, only a lifetimeEnd event |

### "Code asks what a status does, never its name"

This is the most important idea in this section. Engine code **never** checks
`if (status.type === "silence")`. It asks about the building blocks instead, using the helpers in
`ecs/contracts/StatusContracts.js`:

| Question the code asks | Helper |
| --- | --- |
| "Can this bot use its ability channel?" | `isBlocked(bot, "ability")`: true if any active status has `stun`, or a `block` listing `ability` |
| "Which actions are blocked?" | `blockedActions(bot)` |
| "Is the bot immune?" | `hasActiveEffect(bot, "damage_immunity")` |
| "What's the move-speed multiplier?" | `modifierFor(bot, "moveSpeed")` |

For example, the act stage asks `isBlocked(bot, "sprint")`. It doesn't know or care whether the
answer comes from slow, movement-lock or stun.

**Why this matters:** to add a new status, say "Freeze = can't move or dash", you add one preset to
`statuses.json`:

```json
"freeze": { "presenceWhenInside": false, "carriesSourceSlot": false, "clearsVelocity": true,
            "effects": [ { "type": "block", "mode": "constant", "actions": ["move", "sprint", "dash"] } ] }
```

No engine code changes, because every place that checks movement already asks
`isBlocked(bot, "move")`.

Before this refactor, the presets used one-off types such as `"silence"`, `"movement_modifier"` and
`"incoming_damage_modifier"`, and each needed its own code. They are now expressed as `block` and
`modifier`.

### How "silence while inside" works (Null Zone)

Null Zone's `continuous` collision applies `{ "type": "status", "subtype": "silence", "whileInside": true }`.
Silence has `presenceWhenInside: true`, so this creates a **presence** status. Presence statuses have
no timer. At the start of each entities stage, every bot's presence statuses are cleared, and the
zone re-applies them to whoever is still inside. Step out, and the silence is gone the next tick.

### Status events: what a status does *at moments*

A status can have an `on` map, using the **same event names as entity phases**. Four exist today:

#### `schedule`: repeat every interval while held

**Burn:**

```json
"on": { "schedule": { "intervalMs": 1000,
          "effects": [ { "type": "damage", "amount": "$amount", "multiplier": "$damageMultiplier" } ] } }
```

Read it as: *"Every 1000 ms while the bot has burn, apply this damage."* Fireball's 5 s burn with
`amount: 2` deals 2 × (the attacker's damage multiplier) every second, 5 times.

**Shock** shows an event applying *another status*: every second it deals damage **and** applies the
`movement-lock` preset for `$movementLockMs`. A shocked summon gets the same movement lock, so it
stops moving but keeps shooting.

The applying effect's `intervalMs` can override the preset's interval.

#### `lifetimeEnd`: run once when the timer hits 0

**Rewind:**

```json
"captures": ["x", "y", "hp"],
"on": { "lifetimeEnd": { "effects": [ { "type": "restore_state" } ] } }
```

1. Rewind (id 21) applies the `rewind` status for 3000 ms. `captures` saves the bot's x, y and hp into
   `snapshot` at that moment.
2. 3 s later the timer reaches 0, `lifetimeEnd` fires, and `restore_state` puts the bot back at the
   saved spot and HP (capped at max).
3. If the bot dies first, its statuses are cleared **without** running `lifetimeEnd`, so a dead bot
   can't rewind.

#### `hit` and `hitDealt`: reacting to an attack

A reaction runs when an attack damages a bot. `hit` is on the **holder**: it fires when the damage reaches the holder,
even if the holder's immunity blocks it. `hitDealt` is on the **attacker's** statuses: it fires when the attack damages an
enemy bot. Both run right after that damage, so the order in the combat log is the order of the effects. The attacker is the
bot that owns the attack (a projectile's or a summon's owner).

Parry-style, as a preset (a test preset; Parry is not in the roster yet). It makes the holder immune, lets one hit through
the immunity, stuns whoever hit it, and ends after that one hit:

```json
"parry": {
  "charges": 1,
  "effects": [ { "type": "damage_immunity", "mode": "constant", "amount": 1 } ],
  "on": { "hit": { "target": "attacker", "consume": 1,
                   "effects": [ { "type": "status", "subtype": "stun", "durationMs": 500 } ] } }
}
```

The attack's damage is blocked by the immunity, yet the `hit` still runs: the stun lands on the attacker (for a projectile,
its shooter), and the one charge is spent, so the parry ends. Each entry is `{ effects, target?, consume?, from? }`:

- `target`: `"holder"` (default) or `"attacker"`.
- `consume`: charges to spend before the effects run. With no live status or no charges, the entry does nothing.
- `from: ["weapon"]`: the entry runs only for an attack by a `weapon: true` ability. Overcharge uses it:
  `{ "stat": "outgoingDamage", "multiply": 2 }` with `charges: 3` and `hitDealt { from: ["weapon"], consume: 1 }`.
  The attack reads its outgoing multiplier before it lands, so the hit that spends the last charge is still doubled.
- `$hitAmount`: the raw damage of the triggering attack (before the holder's modifiers). Reactive Armor's reflection uses it.

Rules: a reaction's effects run through the same effect registry but never start another reaction (depth 1); when a
holder's reaction removes a status, its `lifetimeEnd` does not run; a status with `charges` ends at 0 charges, when the tick settles (`settleSpentStatuses`): until then its effects still apply
and its `consume` entries do nothing.

#### How status events run

Schedule effects can read their source's position: the status's source bot, while it lives, is the source (a tether pulls
its holder toward it with `displace from: "source"` under a `distance` check). A reaction's source is the holder.


`tickStatuses` in `ecs/bots/BotStatusSystem.js` runs in the act stage. For each status it counts down
`remainingMs`, adds the elapsed time to `tickElapsedMs`, runs `schedule` each time a full interval
has passed, and runs `lifetimeEnd` when the timer reaches 0. The event's effects go through the
**same `applyEffect` registry** as everything else, with:

- **target** = the holder of the status.
- **owner** = none. A status has no owner, so status damage is **never reflected**.
- **source** = `{ damageSourceKind: "status", damageSourceType: "burn", ownerSlot }`. Because burn,
  bleed and shock carry the slot of whoever applied them, their ticks count as hostile damage and
  **do** cause hit stagger. Bleed's `incomingDamage` modifier reads this source's type to skip its
  own ticks.

---

## 7. Modifiers in detail (how damage modifiers work)

A modifier is one building block scaling one stat:

```json
{ "type": "modifier", "mode": "constant", "stat": "incomingDamage", "multiply": 0.5 }
```

`multiply` of 1 changes nothing, 0.5 halves the stat and 1.25 adds 25%.

### The six stats and who reads them

| Stat | Read by | How several combine |
| --- | --- | --- |
| `incomingDamage` | `dealDamage` (damage a bot takes) | **multiply** all together |
| `outgoingDamage` | `outgoingDamageMultiplier` (damage a bot deals) | multiply |
| `staminaCost` | `staminaCostFor` (rounded up) | multiply |
| `moveSpeed` | movement speed | **strongest** (smallest) wins |
| `turnSpeed` | rotation speed | strongest wins |
| `cooldown` | read **when a cooldown or reload starts**, never applied to one already running | strongest wins |

The stacking rules live in `MODIFIER_STACKING` (`vocabulary.js`). **One function reads all of them:**
`modifierFor(shape, stat, source)` in `StatusContracts.js`. It gathers every active `modifier` for
that stat across all statuses, then multiplies them or takes the smallest.

### Worked examples

**Slow + hit stagger** on move speed: 0.5 and 0.85 → "strongest" → **0.5**. They don't compound to
0.425.

**Reactive Armor + Bleed** on incoming damage: 0.5 and 1.25 → "multiply" → **0.625**. A 20-damage
hit becomes 12.5.

**Bleed's own ticks:** bleed's modifier has `excludedDamageSourceTypes: ["bleed"]`. When the damage
source is the bleed status itself (`damageSourceKind: "status"`, `damageSourceType: "bleed"`), that
modifier is skipped. So bleed amplifies other damage but not its own ticks. Its
`rounding: "truncate_tenths"` makes the result truncate to one decimal place.

**Overclock:** while active, any cooldown that **starts** is halved. A cooldown that started before
Overclock keeps its length.

---

## 8. Other on-bot structure you'll meet

- **Ability state:** each bot has `abilityState[abilityId] = { stage, remainingMs, charges, reloadMs, target }`.
  `stage` is `windup` → (activation) → `active` → `cooldown` → `ready`. A missing record means ready.
- **Channels:** every ability is in a channel (`ability` or `dash`, from `channels.json`). Only one
  ability per channel can be winding up or active at a time, but channels are independent, so you can
  dash during a wind-up. A `block` on a channel name (`"ability"`, `"dash"`) stops that channel.
- **Cost:** `{ "stamina": 30 }` (dash channel only). The `staminaCost` modifier scales it.

---

## 9. Cheat sheet: "I want to make X"

| I want... | Write |
| --- | --- |
| An instant melee or gun hit | an activation `hit` with a hitbox and effects (Slash, Pistol) |
| Several hitboxes at once that don't stack | several activation `hit`s with `targetPolicy` scope `activation` |
| A self heal or buff | an activation `applyEffects` with `"targets": ["OWNER"]` (Basic Heal, Overclock) |
| A push, pull or blink | a `displace` effect |
| A combo, spin, beam, lunge, or "if it lands then..." | `spawn` an **attached** entity with phases |
| A projectile | `spawn` + an entity: `straight` movement, `collision` → `applyEffects` + `remove` (Fireball) |
| A trap | `spawn` + an entity: phase with `trigger` (proximity) and `health` (shootable) → `transition` to an exploding phase (Proximity Mine) |
| A lingering zone | `spawn` + a `static` entity with a `continuous` `collision` (Null Zone, Gravity Grenade) |
| A summon | `spawn` + `seek` movement + `health` + a `schedule` event doing an aimed `hit` (Hunter Drone) |
| A new debuff | a new preset in `statuses.json` from existing building blocks, applied by a `status` effect |
| Damage over time | a preset with `on.schedule` damage using `"$amount"` |
| Something that happens when a status ends | a preset with `on.lifetimeEnd` |

You only need **engine code** when you add new *vocabulary*: a new verb, effect type, building block,
movement mode, event or modifier stat. Everything in the table above is data only.

## Where to look in the code

| Concept | File |
| --- | --- |
| Tick stages | `fight.js` |
| Verb executor | `ecs/abilities/verbs.js` |
| Effect registry and mutators | `ecs/abilities/effects.js` |
| "What does this shape touch?" | `ecs/abilities/findTargets.js` |
| Entity ticking, movement, events | `ecs/abilities/AbilityEntitySystem.js`, `EntityEventSystem.js` |
| Status questions (`isBlocked`, `modifierFor`, ...) | `ecs/contracts/StatusContracts.js` |
| Status timers and events | `ecs/bots/BotStatusSystem.js` |
| Bot actions in act | `ecs/bots/ActionExecutionSystem.js` |
| All the allowed names (verbs, events, stats, ...) | `gameconfig/vocabulary.js` |
| Data checks | `gameconfig/gameplayValidation.js` |
