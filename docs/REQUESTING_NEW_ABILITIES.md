# Requesting a New Ability

Use this guide when asking Codex to add an ability. You do not need to describe
the implementation files—describe the gameplay contract and Codex will keep the
browser and authoritative server implementations in parity.

## Concise request template

```text
Create an ability named [name] with [attached/entity] phase behavior.

Stats:
- [stat]: [value and unit]

Phases:
1. [phase ID] for [duration]: [movement, hitbox, effects, and events].
   Visual: [sprite/animation and size].
   On [event], [actions and destination phase].
2. [phase ID] for [duration]: [...].

Targeting: [target rules].
Charges/cooldown: [values].
Special rules: [anything not covered above].
```

Only include lines that matter. Missing cosmetic details can be left to Codex,
but ambiguous gameplay behavior should be stated explicitly.

## Minimum information

Provide:

- **Name**: the player-facing ability name.
- **Ability phase ownership**: projectile, zone, trap, summon, or bot-attached
  hitbox. Melee, arc, ray, and radial may be useful catalogue labels; actual
  collision behavior comes from each phase's hitbox shape and event.
- **Stats**: damage, range, speed, size, durations, cooldown, charges, status
  strength/duration, and similar values that apply.
- **Initial phase**: list it first. Phase IDs may be any clear stable names such
  as `travel`, `armed`, `active`, or `explosion`.
- **Later phases**: state which event transitions to each phase. Array position
  does not cause transitions.
- **Visuals**: identify the sprite or animation for each phase, including its
  display size and visual duration when relevant.

## Phase vocabulary

Describe each phase using whichever fields it needs:

```text
Phase ID: travel
Type: projectile
Duration: 800 ms
Movement: forward at the ability's speed
Hitbox: circle with radius 12
Effects: none
Visual: mine.png at 24 units
On lifetime_end: transition to armed
On collision: transition to explosion
```

`durationMs` is a phase timer. When it expires, it sends `lifetime_end`.

- If `lifetime_end` transitions to another phase, name that destination.
- If it has special actions, list them.
- If it has no handler, the runtime object is removed automatically. Do not ask
  for `lifetime_end: remove` unless removal itself needs additional behavior.

Common events and actions are:

- Events: `collision`, `interval`, `lifetime_end`, `enter`, `exit`, and
  `destroyed`.
- Actions: apply effects, transition to a named phase, emit a visual, or remove
  the runtime object.

For collision effects, say how often each target can be affected:

- `once`: once per target during that phase.
- `every_tick`: every simulation tick while overlapping.
- `interval`: once per target after the specified interval has elapsed.

For scheduled events, provide the interval and whether they start immediately:

```text
Repeat the interval event every 500 ms, startImmediately: false.
```

This waits 500 ms before the first event. `startImmediately: true` fires once
when the phase begins and then follows the interval.

## Example request

```text
Create an ability named Arc Mine of type trap.

Stats:
- Travel speed: 20 units per 100 ms tick
- Damage: 30
- Explosion radius: 110 units
- Cooldown: 8 seconds

Phases:
1. travel for 800 ms: move forward with a 12-unit circular hitbox.
   Visual: arc_mine_flying.png at 24 units.
   On lifetime_end, transition to armed.
   On collision, transition to explosion.
2. armed for 10 seconds: remain stationary and trigger when an enemy enters
   110 units.
   Visual: arc_mine_armed.png at 24 units.
   On collision, transition to explosion.
   On lifetime_end, transition to explosion.
3. explosion for 300 ms: use a 110-unit circular hitbox and deal 30 damage to
   each enemy once.
   Visual: arc_mine_explosion.png at 220 units for 300 ms.
   It should disappear automatically when this phase expires.

Use one runtime object throughout all phases. It must behave identically in
browser training and authoritative server simulation, include replay visuals,
and have lifecycle, collision, boundary-timing, and parity tests.
```

## Very short form

Once the behavior is unambiguous, a compact request is enough:

```text
Create Arc Mine, a trap: travel forward at 20/tick for 800 ms, then transition
on lifetime_end to a stationary 10-second armed phase. Enemy proximity or armed
expiry transitions to a 300 ms explosion. The explosion is a 110-radius circle,
deals 30 damage once per target, and then expires normally. Use
arc_mine_flying.png, arc_mine_armed.png, and arc_mine_explosion.png for the three
phases. Cooldown: 8 seconds. Add browser/server parity and replay tests.
```

If sprite files already exist, include their exact repository paths. If they do
not exist, say whether Codex should create placeholders, reuse existing art, or
leave the visual references ready for assets to be added later.
