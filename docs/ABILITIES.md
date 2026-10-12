# Abilities: contracts, runtime and authoring

The one guide for adding, tuning or reasoning about abilities, weapons, Dash and
ability entities. It replaces the older `ABILITY_EFFECT_CONTRACT`,
`MODIFYING_ABILITIES`, `ADDING_AN_ABILITY_OR_MOVE`,
`ADDING_A_BACKEND_ABILITY_OR_MOVE` and `REQUESTING_NEW_ABILITIES` docs (git
history has them). Code and tests win when this disagrees with them.

Gameplay has one implementation in `shared/engine/`. The browser imports it
for previews; the authenticated Node worker runs it for rated matches and puzzles.
Spring owns submissions, validation, deadlines, persistence, ratings and replay
authorization. It does not execute combat. Engine paths below are relative to
`shared/engine/`; Pixi and testing paths are relative to `frontend/src/gameArena/`.

The model in one paragraph: abilities, statuses, channels and movement numbers are
**data** in `shared/gameplay/*.json`, read by both runtimes. An ability is a list of
**verbs** that run when its wind-up ends; anything that lives over time is an
**entity** with phases whose events run the same verbs. Each bot keeps one
**ability state** record per ability, and each ability sits in a **channel** that
decides what can run alongside it. Verbs apply **effects** through one registry,
statuses are built from **presets**, and a tick is seven named stages. An optional
**combat log** records what happened per stage for deterministic regression tests and replay diagnostics.

## 1. Where an ability lives

Ability IDs are permanent positive integers. Never renumber or reuse one.

| What | Shared engine / browser presentation | Spring metadata |
| --- | --- | --- |
| ID, name, label | `shared/gameplay/abilities.json` (`abilities[]`) | the same file |
| Timing and resources (`windupMs`, `activeMs`, `cooldownMs`, `durationMs`, charges/reload) | `shared/gameplay/abilities.json` (`timing`) | the same file |
| Behavior: activation verbs, spawned entities, phases, hitboxes, movement, effects, events, visual keys | `shared/gameplay/abilities.json` (`onActivate`, `entities`) | the same file |
| Status shapes (burn, slow, ...) | `shared/gameplay/statuses.json` | the same file |
| Channel and stamina cost (`channel`, `cost`), the channels' blocking statuses | `shared/gameplay/abilities.json` and `channels.json` | the same files |
| One-letter loadout `code`, `standard` (every bot has it: Dash) | `shared/gameplay/abilities.json` | the same file (`AbilityCatalog.java`) |
| Catalogue text, tags, `visualInterpolation`. Round/tier and weapon are data: `tier` (1–3) or `weapon: true` in `abilities.json`, which `BotLoadout.js` derives `round` and `category` from | `loadout/BotLoadout.js`, and `shared/gameplay/abilities.json` for tier and weapon | `service/match/loadout/` pools; the same file via `AbilityCatalog.tierOf` and `isWeapon` |
| How it looks | `pixi/botAbilityPresentationDefinitions.js` (bot visuals), `pixi/PixiCanvas.jsx` | none (replay carries state only) |
| Movement and stamina numbers | `shared/gameplay/movement.json` | the same file |

Those files are the one source of ability data. The engine loads them in
`gameconfig/gameplayData.js` (checked by `gameplayValidation.js`, then frozen;
`AbilityRegistry.js`, `Abilities.js`, `MovementConfig.js` and
`ecs/contracts/AbilityContracts.js` read from it). A field that does not apply is left out;
nothing fills values in. A file that breaks a check stops the module from loading, so every
test fails. Spring reads only IDs, `standard`, loadout codes, tiers and weapon flags (`simulation/gameconfig/AbilityCatalog.java`).
After editing a file, run `node tools/format-gameplay-json.mjs` from the repository root: it keeps
short values on one line and drops nulls. Maven copies `../shared/gameplay` onto the classpath as
`gameplay/`, and Docker copies it to `/shared` (compose `additional_contexts`).

`gameconfig/Abilities.js` exposes derived `ABILITY_STATS` (damage, range, ...)
for the catalogue and UI only. The runtime reads an ability's own timing with `abilityTiming` (its contract's
`timing`), so a number authored in `timing` is the one the fight uses. Never author values in `ABILITY_STATS`.
`timing.activeMs` is required on every ability (0 for none): there is no fallback.

## 2. The ability model: verbs and entities

There is no attached/entity split. An ability is data:

```text
{ id, name, label, channel, cost, timing,
  activation: { targetMode, capture, phaseFacingDefault },
  onActivate: [ verbs ],
  entities:  { <entityType>: { spawn, targeting, lifetime, phases: [ ... ] } } }
```

`onActivate` runs in order when the wind-up ends. Anything that lives over time is an
entity, created by a `spawn` verb. Whether it stays on the bot or flies is the entity's
movement mode (section 7). `activation` only describes how the ability starts:
`targetMode`, `capture` (fields copied from the bot pose at activation, so a later move or
displace cannot shift the hitbox), `phaseFacingDefault`.

Every ability also names its `channel` (`ability` or `dash`) and a `cost` (`null`, or
`{ "stamina": N }`, allowed only in the `dash` channel). `channels.json` says, per
channel, whether a block on it also reports its abilities as not ready (`notReadyWhileBlocked`). What
blocks a channel is a status: a `block` effect lists the actions it stops (`ability`, `dash`, `move`,
`sprint`, `fastTurn`), and a stun stops everything.

### Verbs

The same verbs appear in `onActivate` and in entity event `do` lists. **One executor** in `ecs/abilities/verbs.js` (`executeVerb`) runs them in
browser previews and the Node worker.

| Verb | Does | Where |
| --- | --- | --- |
| `hit` | Instant: query `hitbox` once from the source pose (`origin` on the owner or the entity) against the bots and entities that `targets` names, nearest first, and apply `effects` to each (a bot's effects at once; an entity's on its own tick, see below). Emits its `visual`. A ray has its `width`. `nearestOnly` keeps the nearest touched target, `targetPolicy` (see "targetPolicy" below) skips targets the policy's memory already holds, `aim: "seekTarget"` limits an entity's shot to the enemy it chases (a bot has no chase target, so a bot's hit ignores it) | trigger, entity |
| `applyEffects` | Apply `effects` to the owner (`targets: ["OWNER"]`: heals, statuses such as Rewind) or, in an entity event, to the touched targets its own `targets` names (see "`targets` on a verb in an entity event" below). A `displace` effect names its own origin (`from`) and direction, see section 6 | activate (owner only), entity |
| `spawn` | Create entity `entity` (a key of this ability's `entities`), optionally with a `pattern` | activate, entity |
| `move` | Move the owner (a dash): `distance`, `unitsPerTick`; direction from the action; `visual` sets how long the bot effect shows | activate |
| `transition` | The entity enters phase `to` | entity |
| `remove` | Remove the entity | entity |
| `emitVisual` | Record a semantic visual event (`visualType`, `visibleMs`, `visualSize`) | entity |

A activation verb runs in the tick stage that owns it: `move` in act (after the pose
capture), `spawn` at the end of act from the bot's final pose (the
spawn stage then adds the entities to the world), `applyEffects` and `hit` in resolveHits.
A `hit` that names `HP_ENTITY`/`SUMMON`/`ENTITY` reaches arena entities in resolveHits too. Its effects on the
entity go into the tick's **one impact queue** (`impacts`, keyed by the entity's id), and the entities stage lands
them (section 3). The entity's health goes down then, and a `hit` or `killed` event follows from it.

**One hit path.** A bot's activation `hit` and an entity's own `hit` both run `fireHit` in `verbs.js`: the shape
fires from a source pose at the candidates its `targets` name, `nearestOnly`, `once` (the policy's memory) and `aim`
apply the same way to both, and each target it reaches takes the verb's effects. A bot takes them through
`applyEffectsToBot` in `effects.js`, the one place the "immune but holds a hit reaction" rule lives.

**`targets` on a verb in an entity event.** A verb in an entity event's `do` list may carry its own `targets`.
It then runs only when the event touched a target of those kinds, and an `applyEffects` in it reaches only the
touched targets of those kinds. A `hit` is the exception: its `targets` name the kinds its own shape may touch,
and it always runs. The kinds are those of the touched target: `BOT` is an enemy bot, `HP_ENTITY`, `SUMMON` and
`ENTITY` are arena entities, and `OWNER` is the owner bot alone, which is never `BOT`. So one collision can damage
enemies and also be caught by its owner:

```json
{ "targets": ["BOT", "HP_ENTITY", "OWNER"], "do": [
  { "do": "applyEffects", "targets": ["BOT", "HP_ENTITY"], "effects": [ { "type": "damage", "amount": 5 } ] },
  { "do": "remove", "targets": ["OWNER"] }
] }
```

A verb without `targets` runs for every touched target, as it always has.

**Spawn patterns** (`pattern`, count 1-12): `fan` spreads `spreadDeg` across the owner's
heading, `ring` spaces the entities evenly over 360 degrees, `line` puts them side by side
`spacing` units apart. Entity IDs and serials follow index order, and the owner's entity
serial advances by the count. A `spawn` verb inside an entity event spawns from the pose of
the entity that ran it (the bot stays the owner); the new entities join the world after
the tick.

**Phase Strike (25)** is one ordinary hit on the activation tick, with
`targetPolicy: { "mode": "once", "scope": "activation" }`. It takes only the nearest target
(`nearestOnly`): a `displace` with `who: "owner"`, `direction: "mirror"` blinks the owner through it, then
it is damaged. It also spawns the attached entity `backstab`: 200 ms later its `strike` phase (a 70-unit
circle round the owner, `includeTargetRadius`) hits the bots it touches for 10, plus 15 when the owner is
behind them (`when: [{ "measure": "fromBehind" }]`). The stats projection keeps the activation hit's box
(the blink box) for this ability, as it does for any ability with both.

**Every activation verb runs on the activation tick**, in list order. There is no delay field: an
activation verb carries no `atMs`, and no verb carries `pose`. Anything that has to last, wait, run in a
sequence or branch is an entity (see section 7).

**A move** keeps travelling over later ticks for as long as the ability that started it is active, in any
channel (a dash is one such ability). A new move replaces one still travelling. Stun and death stop it; an
interrupted ability stops its travelling move.

**`targetPolicy`** says how often a target can be affected, on a `hit` verb and on an entity event:

```text
"targetPolicy": { "mode": "everyTick" | "once" | "interval", "intervalMs": N?, "scope": "phase" | "entity" | "activation"? }
```

- `mode`: `everyTick` (the default: no memory), `once` (a target is affected once while the memory holds),
  or `interval` (again after `intervalMs`, a whole number of ticks; entity events only, since a hit verb takes
  `once` or `everyTick`).
- `scope`: how long the memory lasts. Left out means `phase`.

  | `scope` | Memory lasts | Use it for |
  | --- | --- | --- |
  | `phase` | until the entity changes phase (kept in the entity's `hitLedger`) | each strike of a combo hits once |
  | `entity` | the entity's whole life, across phase changes (`entityHitLedger`) | a projectile that lodges in a new phase still hits each bot once |
  | `activation` | the cast: one memory shared by the cast's activation hits and by every entity the cast made, and what they spawn | several hitboxes of one cast that must not stack on one bot (the hammer) |

- An **activation hit** (an `onActivate` `hit`) takes only `{ "mode": "once", "scope": "activation" }`, or no
  `targetPolicy` at all (no memory). Phase Strike's hit uses it.
- The **activation memory** lives on the bot's ability record as `activationLedger: { serial, hit }`. The
  `serial` is the activation serial the cast was given, the same one its entities carry (`entityActivations`).
  Activating the ability again replaces the memory (an edit never happens in place). An entity whose cast was
  replaced falls back to its own `entity` memory.

The +10 stamina hit refund stays once per activation; Time Since Hit updates on every hit that connects.
### Effects and `when` conditions

Every verb and status event applies its `effects` through one loop (`applyEffectList`, or the status
event runner, which runs the same checks). The effect types are `damage`, `healing`, `status`, `displace`,
`remove_status` and `restore_state` (see the table in [`ENGINE_PRIMER.md`](ENGINE_PRIMER.md), section 4).

**`when`** is an effect's list of checks. The effect applies only when every check passes (AND only; there is
no `not` and no OR). Each check is read on the live state, right before its effect, so a check sees the
effects before it in the same list (a damage that lands confirms the damage that a later `damageConfirmed`
check reads). Verbs take no `when`: put the checks on the effect.

```text
{ "of": "target" | "owner", "measure": ..., "op": "<" | "<=" | ">" | ">=", "value": ... }
```

| `measure` | Reads | Fields |
| --- | --- | --- |
| `hpRatio` | hp / maxHp of `of` | `of`, `op`, `value` (a number, 0..1 for a fraction) |
| `distance` | from the effect's source to the target | `op`, `value` (in units); no `of` |
| `hasStatus` | an active status of `of`, by preset name | `of`, `value` (a preset name in `statuses.json`); no `op` |
| `windingUp` | any ability of `of` is in its wind-up | `of`; no `op` or `value` |
| `fromBehind` | the source is more than 90 degrees off the target's facing | no `of`, `op` or `value` |
| `damageConfirmed` | an earlier damage in this list landed | no `of`, `op` or `value` |

The true-or-false measures must be true, so they take neither `op` nor `value`. The validator rejects an
unknown measure, a numeric check without `op` or `value`, `op` or `value` on a true-or-false check, `of` on a
measure that does not read it, and a `hasStatus` name with no preset. The brain's own helpers do the work
(`isWindingUp`, `statusIsActive`, the compass angle), so a condition uses the same arithmetic as a brain
condition.

**Execute** (a bonus below 30% health): the hit's first effect is the base damage, the second is the bonus:

```json
{ "type": "damage", "amount": 8, "targetKinds": ["BOT"], "when": [{ "of": "target", "measure": "hpRatio", "op": "<", "value": 0.3 }] }
```

A conditional effect is a bonus on some hits, not the ability's base numbers. The catalogue and the derived
stats (`ABILITY_STATS`, the loadout's effect list) skip any effect that has `when`.

**Failed checks are no hit.** An effect whose checks fail is skipped before it runs, so it does not count as a
hit for Time Since Hit or for `landedOnEnemy`.

**`remove_status`** takes a status off the target by its preset name, `{ "type": "remove_status", "subtype": "slow" }`,
in every mode (duration or presence). It is a cleanse, not an expiry: the status's `lifetimeEnd` does not run.
Shatter-style abilities use it with a `hasStatus` check on the bonus before it.

**Healing needs confirmed damage through a check.** There is no `requiresConfirmedDamage` field. Vampiric Beam (32)
heals with `"when": [{ "measure": "damageConfirmed" }]`, so it heals exactly the damage it dealt, and only if it dealt any.

## 3. One tick

`shared/engine/fight.js` runs seven named stages in this order through
`createFight(setup).step()`, one function per stage. The fight owns its
bots and entities and changes them in place during a tick; `fight.frame()` hands callers
new plain objects. The combat log tags every entry with the stage that produced it.

1. **`decide`.** Entities age and each bot's one-tick outputs clear. Each brain reads
   the start-of-tick snapshot and picks at most one action per category: movement,
   rotation, ability, dash, cancel. A running chain claims its categories first;
   roots fill the rest by priority (`botlogic/code/runtime/actionSelector.js`).
   The shared engine normalizes each brain once at fight setup or a segment boundary.
2. **`act`** (`ecs/bots/ActionExecutionSystem.applyBotAction`), per bot:
   1. stamina timers advance (regeneration happens here);
   2. stun: interrupt, stop moving, nothing else happens;
   3. Cancel Wind-up, if chosen and affordable;
   4. movement (walk, sprint, a running dash step) and rotation (fast turn);
   5. the ability: continue or start the wind-up; at the end of the wind-up it
      activations (active time, cooldown, charge, `move` verbs);
   6. the dash channel, after the ability;
   7. bot timers: resources, then statuses (their `schedule` and `lifetimeEnd` events run here, see section 6), then lifecycle;
   8. the `spawn` verbs build their entities, in verb and pattern order.
3. **`resolveHits`.** `applyEffects` (owner) and `hit` of every activated ability
   resolve against the roster and the entities (`ecs/abilities/verbs.js`
   `resolveActivationVerbsForRoster`). A `hit` reaches bots and objects here: a bot takes its
   effects now, an object (an HP entity) queues them in the tick's impact queue for the entities stage. Every effect is
   applied by the effect registry (`ecs/abilities/effects.js`, through `applyEffectList`), and
   every "who does this shape touch" question is answered by `findTargets` (through `collectHitTargets`)
   (`ecs/abilities/findTargets.js`).
4. **`spawn`.** The entities built in `act` join the world.
5. **`entities`** advance (`ecs/abilities/AbilityEntitySystem.tickAbilityEntityWorld`): first bound entities end and following entities
   take their owner's pose. Then every entity runs the same `tickEntity`: its clocks
   advance, the bots' hits queued for it in resolveHits land on it (HP entities; a bot's hit takes effect
   in the tick it is made, before the entity's own events), it moves by
   its phase's movement mode (`straight`, `static`, `seek`), and its due events run
   (`collision`, `trigger`, `schedule`) through the verb executor. An entity collision or hit that
   applies effects to an HP entity queues them on it (see section 6, "Collisions"). A `lifetimeEnd` fires
   when the phase duration or the entity's lifetime runs out (an entity with no handler
   is removed), and a phase an event moves the entity into runs its collision once. A trap
   is a phase with a `trigger`, a summon is `seek` movement plus a `schedule` event. Entities
   whose phase has a `trigger` settle first and together, because a chain trigger sets off
   neighbours; the rest settle in order. Then the entity impacts (queued by hits and collisions
   of entities) land, in one pass over the entities, whatever order they settled in
   (`applyCollisionImpacts`). A target hurt there raises its `hit` or `killed` event as it does
   anywhere else. A bot's hit queued for an entity that did not advance this tick is dropped, as before.
6. **`hazards`.** Closing-zone damage.
7. **`settle`.** Pending healing, damage-taken counters, Time Since Hit ages, and
   banked stamina refunds (`gameconfig/AbilityHitRecord.settleAbilityHits`).

Each source reads the latest accumulated bot state of the tick; damage,
healing, DOT and reflection settle as one net HP change.

### Combat log and golden scenarios

The combat log is an optional list of entries `{ tick, stage, kind, source, target,
abilityId, effect, amount }`. `kind` is `activate`, `effect` (the final amount applied),
`status`, `spawn`, `phase`, `removal` or `stamina` (spend or refund). `source` and `target`
are `bot<slot>` or `<entityType>:<ownerSlot>:<serial>`. Logging is optional and
does not change results. Use `createFight(setup, { combatLog })` or the
`simulateFight` combat-log hook; append effects through the existing `logCombat` funnel.

`shared/gameplay-tests/` is the regression net:

- `goldenScenarios.json` contains small fights covering every ability, Dash,
  sprint, Cancel, traps, summons, reflection and DOT.
- `golden.browser.json` is the single committed combat-log and per-tick state-hash golden.
  Frontend tests exercise `createFight` and `simulateFight`; worker HTTP tests
  run the same scenarios through the deployed transport.
- After an intended behavior change, run `npm run golden:update` in `frontend/`,
  review the diff and explain it. Never edit a golden by hand.

## 4. Ability lifecycle on the bot

The bot holds one record per ability, `abilityState[abilityId] = { stage,
remainingMs, charges, reloadMs, target }` in `gameconfig/AbilityState.js`. `stage` is `windup`, `active`,
`cooldown` or `ready`, and `remainingMs` is the time left in it. While active,
the record also reserves the cooldown that starts when the active stage ends
(`cooldownMs`). A missing record is a ready ability. The old loose fields
(`preparingAbility`, `abilityCooldowns`, ...) are gone. Worker render frames
carry the engine's native `abilityState` records; Spring passes their raw JSON
through without rebuilding ability visuals or mapping legacy fields.

```text
ready -> windup -> activate -> active -> cooldown -> ready
```

- Readiness is judged on the previous tick's state, the same state conditions
  saw. Selection keeps a started wind-up selected until it activates.
- The cooldown starts when active time ends; only the unused part of the step in
  which the active stage ends counts toward it. Every ability that activated this
  tick (an ability and a dash can both start in one) keeps its stage for the tick.
- Charges: only `resourceModel: "reload"` is supported (no shipped ability uses charges since the Pistol was cut). With charges
  left, the short cooldown applies; the last charge starts the reload instead,
  never both.
- **Channels:** a channel is busy while one of its abilities is in `windup` or
  `active`; another ability of that channel cannot start. Channels are
  independent, so any ability can wind up, fire or be active while a dash runs,
  and a dash can start during another ability's wind-up and active time.
- `readyInMs` (browser `abilityReadyInMs`) is the longest of an ability's
  cooldown, its reload and the time to afford its stamina cost.
- Defensive effects get no active lock; their duration is a status.
- **Interrupt** (a status whose preset sets `interrupts: true`, which is stun, or `interruptCurrentAbility`):
  drops the wind-up without firing, stops active time, and starts the cooldown or reload. An
  already spawned entity keeps running.
- A `block` effect stops a channel's abilities from starting and cancels their
  wind-up: silence blocks `ability`, slow blocks `dash` (and sprint), and stun
  blocks everything. A block that was active at the start of the tick still stops
  its channel if it expired during the tick. A dash held by a block reads as not
  ready (`notReadyWhileBlocked`); a stun does not.
- A cooldown multiplier (a `modifier` on `cooldown`) is read when a cooldown or reload is created,
  never applied to running timers. `attackSpeedMultiplier` scales cooldowns,
  `attackDamageMultiplier` scales damage (entities snapshot it at spawn).

## 5. Movement, Dash and stamina

Numbers come from `shared/gameplay/movement.json`; execution is in
`gameconfig/StaminaSystem.js`. Every value is per 100 ms tick.

| Rule | Value |
| --- | --- |
| Stamina | integer 0-100, starts full |
| Regeneration | +2 per tick, only after 500 ms with no spend; any spend restarts the pause |
| Sprint (Walk setting) | x1.5 speed, 3 per tick, needs stamina > 0, stopped by stun, movement lock and slow |
| Fast turn (Rotate setting) | 24 instead of 12 degrees per tick, 2 per tick, only on ticks that turn, needs >= 2 |
| Dash (19) | `cost.stamina` 30, 200 ms active, then a 100 ms cooldown (a 300 ms gap from its start); 150 units over 2 ticks |
| Cancel Wind-up | 25 stamina; no cooldown, no charge used |
| Hit refund | +10 once per activation that lands an enemy-hit effect on an enemy bot (including through its entity); paid at settle; does not touch the pause |

Dash is a `move` verb on the `dash` channel with its own action category. Nothing is
special-cased by ID: its stamina gate is the generic `cost.stamina`, its gap is
the cooldown after its active stage, and its readout is the generic `readyInMs`.

## 6. Entity phase reference

An entity: `runtimeType`, `category` (`projectile`, `zone`, `trap`, `summon`, `attached`), `spawn`,
`targeting`, `lifetime`, `initialState`, `state`, `phases[]`.

A phase: `id`, `type` (`projectile`, `zone`, `summon`), optional `durationMs`, `movement`,
`hitbox`, `health`, `trigger`, `visual`, `skipOwner`, `transitionOnly`, and `on`: events,
each with `targets`, `schedule`, `targetPolicy`, `recheckCollisionOnTransition`,
`nearestOnly`, `waitForHit` and `do` (verbs). Effects are never on the phase; they live in
the `applyEffects` and `hit` verbs that apply them.

**Trigger radius.** `trigger.radius` is the only radius a trigger uses: it decides which enemies
in `trigger.contact` set the trap off, chain reach and which bots a `trigger` event's `do` list reaches. `hitbox.radius` (and
`radiusMultiplier`) is the entity's body and never widens, narrows or stands in for it. A phase
with a `trigger` or a `trigger` event must set `trigger.radius`, and must not also set
`hitbox.radius` unless a `collision`, `hit` or `killed` event (or `health`) uses the hitbox.
Engine and Java data validators reject the rest, so a phase that wants a different body keeps its own hitbox.

**Hitboxes** (arena units, origin at the bot or entity center):
`circle { radius }`, `rectangle { length, width }` (extends forward),
`arc { range, arc }` (degrees), `ray { range, width }`. `includeTargetRadius`
lets an edge contact count. Bots are swept along their tick movement. Effective
melee reach = length or range + 30.

**Collisions.** An entity's `collision` event runs once per touched target, bots and entities alike, from the
source's side. The source's geometry decides the touch, the same for every target: an attached entity tests its
exact phase hitbox from its current pose, and a world entity sweeps its collider along its tick movement. Its
`targetPolicy` and `nearestOnly` apply to bots and entities alike. An `applyEffects` verb reaches an HP entity by
queuing its effects on it; they land at the end of the entities stage (section 3). The entity's own `remove`
does not cancel them. No entity re-checks another entity's collisions on its own side.

**Events:** `collision`, `trigger`, `hit` (the entity was hurt), `killed`,
`lifetimeEnd`, `schedule`. The `do` list holds verbs: `applyEffects`, `hit`, `spawn`,
`transition`, `emitVisual`, `remove`.

- `schedule.mode`: `once` (checked when the phase starts; later arrivals miss),
  `continuous` (collision every tick, the default for collision), `repeat`
  (`intervalMs`, `count`, `startImmediately`).
- A phase with a `schedule` event has no phase clock: its timer is the schedule's.
- The `schedule` event is a timer: its countdown runs every tick, and when it is due (and
  the entity is not stunned, interrupted or silenced) its verbs run and it waits
  `schedule.intervalMs`. With `waitForHit` it stays due until a `hit` verb in it connects,
  then waits. A summon's shot is a `schedule` event with an aimed `hit`.
- `targetPolicy.mode`: `everyTick` (default), `once` per target per phase,
  `interval`. The ledger resets on transition.
- `nearestOnly` on a collision event keeps the nearest touched target.
- `recheckCollisionOnTransition: false` stops the entered phase from running
  its own collision check on the same tick.

**Target kinds:** `BOT`, `HP_ENTITY`, `SUMMON`, `ENTITY`. The event's (or hit
verb's) `targets` decides who it reaches; each effect's `targetKinds`
decides who receives that effect. Defaults: event `[BOT]`; damage
`[BOT, HP_ENTITY]`, other effects `[BOT]`. HP entities accept damage and displace;
summons accept damage, status and displace. An attached entity has no target kinds, so no
hit, collision or effect reaches it (see section 7). Friendly damage only when
the target phase's `health.allowFriendlyDamage` is true.

**Effects** (applied in declared order):

| Type | Fields |
| --- | --- |
| `damage` | `amount` or `falloff { maxAmount, minAmount, falloffStart, falloffEnd }` |
| `healing` | `amount`, `recipient: "source"`, `requiresConfirmedDamage`, `mirrorsDamage` |
| `displace` | `who` (`target` or `owner`), `from` (`source`, `owner` or `target`), `direction` (`away` pushes the mover from `from`, `toward` pulls it to `from`, `mirror` lands it as far past `from` as it stood from it), `distance` (units, or a `falloff` like damage's; none for `mirror`). `who: "owner"` is a self move and is allowed only in `onActivate`. It counts as an enemy hit only when `who` is `target` |
| `status` | `subtype`, `durationMs`, `amount`, `intervalMs`, `movementLockMs`, `whileInside`, optional duration falloff |
| `restore_state` | no fields; runs from a status's `lifetimeEnd` event (Rewind's snap-back, see below) |

Falloff is linear from `falloffStart` to `falloffEnd`, clamped to the hitbox
range; distance is center to center.

**Statuses** are generic records on the bot (`statusEffects[]`): `type`, `mode`
(`duration` or `presence`), `remainingMs`, optional `tickMs`, `sourceSlot`,
`abilityId`, `on` (resolved events, or null), `snapshot` (captured fields, or null), and `effects[]` from `damage`, `modifier`,
`damage_immunity`, `stun`, `block`, `movement_lock`. Every subtype an ability applies is a
preset in `shared/gameplay/statuses.json` (burn, bleed, shock, slow, stun, silence,
hit-stagger, movement-lock, rewind), built for bots
and summons alike by the effect registry (`effects.js` `applyStatus`). A preset says
what it does through its effects: silence blocks `ability`, slow blocks `dash` and
`sprint`, movement-lock blocks `move` and `sprint`, stun stops everything, and
`interrupts: true` (stun) interrupts the target's abilities.

**Status events** use the same event names as entity phases. A preset's `on` may hold
`schedule` (`intervalMs`, a whole number of ticks, and `effects`), which runs its effects every
interval while the status is held (the applying effect's `intervalMs` overrides the interval), and
`lifetimeEnd` (`effects`), which runs once when the status's clock counts down to 0. A death clears the
statuses without running `lifetimeEnd`. Four exist: `schedule` and `lifetimeEnd` above, and the reactions `hit` and `hitDealt` (below). Burn, bleed and shock damage are
`schedule` effects. Each effect goes through the effect registry with the holder as target and no owner, so
status damage is never reflected. On a summon it stays out of the combat log. Shock's movement lock is a
`status` effect, the same `movement-lock` preset a bot gets, so a shocked summon stops moving and keeps
shooting. `captures` (`x`, `y` and `hp` only) copies those fields from the holder into `snapshot` when the
status is applied. Rewind is the status `rewind`: its `lifetimeEnd` runs `restore_state`, which puts the bot
back at the captured x, y and hp (hp capped at its maximum, velocities zeroed) and sets `rewindPulseMs`, a
presentation-only countdown for the pulse after the snap-back. Owner statuses (Rewind is one) are a `status` effect on an `OWNER` verb. Code asks a
status what it does (`hasActiveEffect`, `isBlocked`, `blockedActions` in
`StatusContracts.js`), never by its name. A new subtype is a new preset there;
nothing else needs a branch.

**Reactions** (`on.hit`, `on.hitDealt`) run when an attack lands. `hit` fires on the holder when an attack damages it,
even if the holder's immunity blocks the damage; `hitDealt` fires on the attacker's statuses when the attack damages an enemy
bot. Both fire right after each such damage, and the attacker is the bot that owns the attack (a projectile's or a summon's owner).
An entry is `{ effects, target?, consume?, from? }`: `target` is `"holder"` (the default) or `"attacker"`; `consume` spends
that many charges, and a status with `charges` (a preset field, a whole number of 1 or more) ends when they run out, without
running its `lifetimeEnd`. A spent status still applies its effects for the rest of that tick, so every hit landing in the
same tick meets it (a Parry blocks a whole Shotgun Blast), but its `consume` entries don't fire again; it ends when the tick settles; `from: ["weapon"]` limits the entry to attacks by a `weapon: true` ability. `$hitAmount` is the raw damage
of the triggering attack, before the holder's modifiers. A reaction's effects never start another reaction, and the holder's
statuses run in the order they were applied. A reflecting status (a test preset in the suite; Parry will use the same shape) reflects half the raw hit this way: `modifier incomingDamage ×0.5`,
and `on.hit` with `target: "attacker"` and a damage of `$hitAmount` × 0.5. Its `damage_reflection` effect is gone.

**Schedule sources.** A `schedule` effect's source is the status's source bot while that bot is alive: its position is what a
`displace from: "source"` or a `distance` `when` check reads. A dead source has no position, so those effects are skipped.

**Modifiers** are one `modifier` effect per stat: `{ type: "modifier", mode: "constant",
stat, multiply }`, where `multiply` is 0 or more and 1 changes nothing. `MODIFIER_STATS`
and `MODIFIER_STACKING` (`vocabulary.js`) name the stats and how active ones combine.
`modifierFor(shape, stat, source)` (`StatusContracts.js`) is the only reader. Only an
`incomingDamage` modifier may carry `excludedDamageSourceTypes` and `rounding`.

| Stat | Read by | Stacking |
| --- | --- | --- |
| `incomingDamage` | `damageBot`; bleed 1.25 (not on bleed ticks, rounded to tenths) | multiply |
| `outgoingDamage` | `outgoingDamageMultiplier` = attack damage multiplier × modifier | multiply |
| `moveSpeed` | `effectiveMovementSpeedMultiplier` (slow, hit-stagger) | strongest (smallest) |
| `turnSpeed` | `effectiveRotationSpeedMultiplier` (slow, hit-stagger) | strongest (smallest) |
| `cooldown` | `cooldownStartMultiplier` for new cooldowns and reloads | strongest (smallest) |
| `staminaCost` | `staminaCostFor`, rounded up, on every stamina cost | multiply |

**Hit stagger:** any hostile damage above zero gives the bot 300 ms of `moveSpeed` and
`turnSpeed` modifiers at 0.85 (the `hit-stagger` preset). Slow is 0.5 on both. Stacked,
the strongest applies, so slow and stagger together give 0.5. Two `incomingDamage`
modifiers multiply, where they used to add.

## 7. Entities

- **Clocks:** root `lifetime.duration` (does the entity exist), phase
  `durationMs` (when `lifetimeEnd` fires), event `visibleMs` (renderer only).
  An unhandled `lifetimeEnd` removes the entity.
- The first phase is the initial phase; later phases are reached only through
  `transition`. A transition keeps the entity ID and resets the phase timer,
  schedule state and hit ledger.
- **Movement modes** (`phase.movement.mode`): `straight` (forward, or `direction:
  "backward"`, `unitsPerTick`), `static`, `seek` (turn up to `turnDegrees` toward `target`
  and move `unitsPerTick`: `nearestEnemy`, the default, which summons use; or `owner`, which
  homes a boomerang back to its owner, and holds still once the owner is dead), `followOwner`
  (the entity's pose is the owner's pose plus the entity's `spawn` offset and rotation, every
  tick).
- **Naming the owner:** a collision event may list `OWNER` in `targets`. It matches only the owner
  bot, and only while the owner is alive. Only a collision event may name it, and an attached entity
  cannot (it moves with its owner). Its verbs may be `remove`, `transition`, `spawn` and `emitVisual`
  (with or without `targets` naming `OWNER`). `applyEffects` and `hit` may run there only when their own
  `targets` leave `OWNER` out, so the owner is never hurt by its own collision. A `remove` with
  `"targets": ["OWNER"]` runs only when the owner is touched (see section 2).
- **Spawn:** `spawn.offset` (x right, y forward of the owner),
  `rotation` (-360..360) in `rotationSpace` `owner` or `world`;
  `targeting.position: "target"` places it at the activation target
  (`clampToRadius`, defaults). A pattern adds its angle to the heading and rotation (and
  its sideways offset to the position).
- **Traps** have two sensors. *Proximity*: `trigger { radius, contact, chain }` (any other field is rejected), where `contact`
  is a non-empty list of enemy kinds, `"BOT"` and/or `"SUMMON"`; one inside the radius fires the
  `trigger` event. *Body*: `hitbox` + `health`; damage that reaches the body (a Slash, a
  projectile, an attached entity's swing) fires `hit`, then `killed`. A `killed` handler
  transitions the trap (the Snare Bomb's `killed` handler moves it to `destroyed`), and an
  HP entity with no `killed` handler is removed. A killed trap still counts as fired for `chain`.
  Projectiles and attacks never count for proximity, and a swing that misses the body does
  nothing. `botContact`, `attackHits` and `projectileOverlap` are rejected.
- **Summons:** `seek` movement plus a `schedule` event whose `do` is a `hit`. Silence and
  stun pause it.
- **HP entities:** phase `health { hp, maxHp }`; damage dispatches `hit` or
  `killed`. An entity takes its HP from the first phase with `health` it enters, so a trap whose
  first phase has none (the mine's `travel`) gets its HP when it arms.
- **Attached entities** (`category: "attached"`) are part of the bot's own attack: a timed,
  sequenced or conditional attack that is not an object in the arena. Their rules are below, in
  section 7.
- A timer event (`schedule`) with `count` fires that many times and then stops; `intervalMs`
  spaces the shots.
- Replay carries `phaseId`, `phaseTimerMs`, `eventType`, `eventSequence`, never
  visual types or sizes. A summon's shot reports `eventType: "schedule"`.

### Attached entities

An attached entity (`category: "attached"`) is part of its owner's attack. Use it for anything
over time, in sequence, or conditional. The engine enforces these rules:

1. **Brains don't see it.** It is left out of a brain's entity list, and it has no selectable
   identities.
2. **Nothing targets it.** It has no target kinds, so no hit, collision or effect reaches it. Its
   phases may not set `health` or `trigger` (the validator rejects both).
3. **It ends with its cast.** It is removed on the tick its owner is stunned (or otherwise
   interrupted) during that cast, or when the owner dies. A cast that ended normally does not end
   it: a Whirlwind can outlive a 300 ms active time. Entities it spawned stay. Each cast is
   matched by its activation serial: an interrupt stamps the owner's ability record with the serial
   of the cast it stopped (`interruptedSerial`), and the entity checks its own serial against it.
4. **It hits like a weapon.** Its collision tests its phase `hitbox` (arc, rectangle, ray or circle,
   with `includeTargetRadius`) exactly as an activation `hit` does, from its current pose.
5. **It can move its owner.** `move` is allowed in its event `do` lists. It moves the owner like an
   activation move, heading by the action the cast captured when the entity spawned. A phase entered
   on the tick its owner moved takes the owner's new pose before its collision runs.

A hit verb in any entity event reaches the entities its `targets` name, as a bot's hit does. The
impact is queued on the target and lands when the target advances later in the same tick; a target
that already settled this tick drops it (a known gap, not yet fixed). Hunter Drone targets
only `BOT`, so it is unchanged.
Hits from an attached entity count toward its cast's once-per-activation stamina refund, as any
entity hit does.

## 8. Visuals

Rendering never decides hits, damage, readiness or movement.

- Entity visuals: phase `visual { type, state, visualSize }`, an `emitVisual` verb's
  `visualType`, or the `visual` of a `hit` verb; Pixi maps the type to a sprite or
  procedural effect. A activation verb's `visual` drives the bot-room effect
  (`abilityVisual`).
- Bot visuals (swings, rays, wind-up telegraphs, shields): keyed by the activation
  verb's visual `type`. `pixi/botAbilityPresentationDefinitions.js` maps each type
  to renderer settings (colours, sizes, precedence); `pixi/renderers/<type>.js`
  exports `{ create, update, destroy }` (plus an optional `sync`) and is listed in
  `pixi/renderers/index.js`. `PixiCanvas.jsx` only dispatches. Renderers are driven
  by the ability's wind-up and active stages (`abilityState`) and `abilityVisual`,
  draw hitbox-shaped effects from the contract numbers, and never use
  `Math.random`. A new visual is one renderer file, one settings entry and the
  type name in `abilities.json`; abilities that need different art need different
  type names (Thrust, Cleave and Smash are not `meleeSlash`).
- `visualInterpolation` in `BotLoadout.js`: `none` for instant effects and
  teleports, `linear` for physical motion.
- Check practice room (both slots), match testing and replay, and run
  [`ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md).

## 9. Making a change

**Tuning a number:** edit `shared/gameplay/abilities.json` (or `movement.json` /
`statuses.json`), update nearby expectations, run the focused tests and review the
golden diff.

**Adding an existing effect to an ability:** edit the verb in
`shared/gameplay/abilities.json`; usually no system code changes. Add an execution test.

### How to add an ability

1. **Write the data.** Take the next free ID (never reuse or renumber) and add the entry to
   `shared/gameplay/abilities.json`. Copy a neighbour of the same shape instead of writing
   from scratch: Slash `1` for a melee `hit`, Fireball `5` for a projectile entity, Dash
   `19` for `move`. Leave out any field that does not apply. A minimal instant melee ability
   (this one passes `validateGameplayData`):

   ```json
   { "id": 38, "name": "jab", "label": "Jab", "code": "j", "type": "ability", "channel": "ability",
     "timing": { "cooldownMs": 600, "windupMs": 100, "activeMs": 200 },
     "activation": {},
     "onActivate": [ { "do": "hit",
                      "hitbox": { "shape": "rectangle", "width": 40, "length": 80, "radiusMultiplier": 1, "includeTargetRadius": true },
                      "targets": ["BOT", "HP_ENTITY"],
                      "effects": [ { "type": "damage", "amount": 9, "targetKinds": ["BOT", "HP_ENTITY"] } ],
                      "visual": { "type": "meleeSlash", "visualSize": 120, "visibleMs": 300 } } ] }
   ```

   Anything that lives over time is an entry in `entities` plus a `spawn` verb; heals and
   buffs are `applyEffects` with `"targets": ["OWNER"]`; a new status is a preset in
   `statuses.json` applied by a `status` effect; a stamina-costed or independently locked
   action goes in the `dash` channel.
2. **Make it pickable.** Give it a one-letter `code` in the data (the compact loadout string);
   catalogue text, round/tier and `visualInterpolation` in `shared/engine/loadout/BotLoadout.js`;
   and add it to the server's `service/match/loadout/` pools. Without these it cannot be picked.
3. **Give it a look.** Reuse a visual `type`, or add one to
   `pixi/botAbilityPresentationDefinitions.js` with a `pixi/renderers/<type>.js` module
   (section 8).
4. **Add code only for new vocabulary.** A new effect type, status subtype, verb, phase type,
   movement mode or targeting mode needs execution code once in the shared engine
   (`ecs/abilities/effects.js`, `verbs.js` and the owning system), plus vocabulary
   support in `gameplayValidation.js`. An ability that uses only existing vocabulary needs none.
5. **Test it.** Loading data runs the engine's data checks. Add
   an `ALWAYS` brain execution test in the shared engine's frontend suite
   (`withTestAbilities` in `AbilityContracts.js`; see `VerbModel.test.js`).
   Add an interaction to `goldenScenarios.json` when needed, regenerate the
   single golden and run worker HTTP tests against it. Run Java tests for
   schema, loadout and worker transport changes; do not add Java combat tests.
6. **Look at it** in the practice room, match testing and replay, and run the
   [regression checklist](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md).

**Describing an ability to an agent:** name, activation verbs, entities, stats, each
phase (duration, movement mode, hitbox, effects, which event moves to which phase),
targeting, cooldown/charges, visuals. Example: "Snare Bomb, a trap: a stationary armed phase; a bot in its
trigger radius moves it to a 100 ms triggered phase (slow and stun), and a kill moves it to a
destroyed phase with a bigger radius and effects. Cooldown set by its data. Shared engine
execution and worker replay tests."

**Tests** for any gameplay change: an `ALWAYS` brain reaching the real executor
in the shared engine; both slots when symmetry matters; missing-target
fallthrough; timing (wind-up, active, cooldown, charges); effect order and
rounding; entity lifecycle and collision; deterministic repeat runs; replay
fields.

```text
frontend/: npm test, npm run lint, npm run build
sim-worker/: npm test
server/:   .\mvnw.cmd test (metadata, validation and authenticated worker boundary)
```

A picker-only or browser-only ability is incomplete: rated play needs
normalization, server validation, authoritative activation, replay and tests.

## 10. What Spring keeps

Spring executes no gameplay and holds no copy of the ability model. It keeps:

- `simulation/gameconfig/AbilityCatalog`: ability IDs, standard abilities and loadout codes, read
  from `abilities.json`; the `service/match/loadout/` pools build on it.
- `ArenaUnits`, `ArenaCoordinates`, `ClosingZoneConfig` and the `HpDecision` presentation summary:
  request dimensions, puzzle coordinate conversion and socket zone-warning presentation.
- Brain checks: the JSON nesting cap, `brain.schema.json`, then the worker's `POST /validate`, which
  runs the shared engine's `botlogic/code/configuration/brainRules.js` (references, sibling order,
  depth, totals). The editor runs the same two checks before it submits.
- `MatchReplayDTO`: socket authorization/result/rating envelope carrying raw worker JSON.

Spring consumes worker batches without cutting or mapping render frames. It
still authorizes reconnect lookahead and schedules result/rating reveals. Calls
require `SIM_WORKER_SECRET`, use timeouts and bounded concurrency, and report
engine version plus success/failure metrics. Match failures enter the existing
retry/cancel path; puzzle failures never record a solve. There is no mode flag
or fallback engine. Run `npm run version:write --prefix sim-worker` before
`docker compose build`; deploy server, worker and frontend with matching schemas.
