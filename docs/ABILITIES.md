# Abilities: contracts, runtime and authoring

The one guide for adding, tuning or reasoning about abilities, weapons, Dash and
ability entities. It replaces the older `ABILITY_EFFECT_CONTRACT`,
`MODIFYING_ABILITIES`, `ADDING_AN_ABILITY_OR_MOVE`,
`ADDING_A_BACKEND_ABILITY_OR_MOVE` and `REQUESTING_NEW_ABILITIES` docs (git
history has them). Code and tests win when this disagrees with them.

Gameplay runs twice: the browser (`frontend/src/gameArena/`) previews, the
Spring server (`server/.../simulation/`) decides rated results. Every gameplay
change goes into both, with the same IDs, milliseconds, arena units, rounding
and tick order.

The model in one paragraph: abilities, statuses, channels and movement numbers are
**data** in `shared/gameplay/*.json`, read by both runtimes. An ability is a list of
**verbs** that run when its wind-up ends; anything that lives over time is an
**entity** with phases whose events run the same verbs. Each bot keeps one
**ability state** record per ability, and each ability sits in a **channel** that
decides what can run alongside it. Verbs apply **effects** through one registry,
statuses are built from **presets**, and a tick is seven named stages. An optional
**combat log** records what happened per stage so the two runtimes can be diffed.

## 1. Where an ability lives

Ability IDs are permanent positive integers. Never renumber or reuse one.

| What | Browser | Server |
| --- | --- | --- |
| ID, name, label | `shared/gameplay/abilities.json` (`abilities[]`) | the same file |
| Timing and resources (`windupMs`, `activeMs`, `cooldownMs`, `durationMs`, charges/reload) | `shared/gameplay/abilities.json` (`timing`) | the same file |
| Behavior: trigger verbs, spawned entities, phases, hitboxes, movement, effects, events, visual keys | `shared/gameplay/abilities.json` (`onTrigger`, `entities`) | the same file |
| Status shapes (burn, slow, ...) | `shared/gameplay/statuses.json` | the same file |
| Channel and stamina cost (`channel`, `cost`), the channels' blocking statuses | `shared/gameplay/abilities.json` and `channels.json` | the same files |
| Catalogue text, round/tier, tags, `visualInterpolation`, compact loadout code | `loadout/BotLoadout.js` | `CompactAbilityCode.java`, `service/match/loadout/` pools |
| How it looks | `pixi/botAbilityPresentationDefinitions.js` (bot visuals), `pixi/PixiCanvas.jsx` | none (replay carries state only) |
| Movement and stamina numbers | `shared/gameplay/movement.json` | the same file |

Those files are the one source of ability data. The browser loads them in
`gameconfig/gameplayData.js` (validated by `gameplayValidation.js`, then frozen;
`AbilityRegistry.js`, `Abilities.js`, `MovementConfig.js` and
`ecs/contracts/AbilityContracts.js` read from it). The
server loads them in `simulation/gameconfig/GameplayData.java` (Jackson records
with enums, the same checks; `AbilityRegistry`, `Abilities`, `MovementConfig`
and `AbilityContracts` read from it). Every value is written in the files; a
JSON `null` means "does not apply", and neither runtime fills in a default. A
file that breaks a check stops the browser module from loading and the server
from starting. Maven copies `../shared/gameplay` onto the classpath as
`gameplay/`, and Docker copies it to `/shared` (compose `additional_contexts`).

`Abilities.js`/`.java` also expose a derived `ABILITY_STATS` / `AbilityDefinition`
projection (damage, range, ...) read from the contracts. It exists for the UI
and old consumers; never author values there.

## 2. The ability model: verbs and entities

There is no attached/entity split. An ability is data:

```text
{ id, name, label, channel, cost, timing,
  activation: { targetMode, capture, phaseFacingDefault, teleportOncePerActivation },
  onTrigger: [ verbs ],
  entities:  { <entityType>: { spawn, targeting, lifetime, bindToCast, phases: [ ... ] } } }
```

`onTrigger` runs in order when the wind-up ends. Anything that lives over time is an
entity, created by a `spawn` verb. Whether it stays on the bot or flies is the entity's
movement mode (section 7). `activation` only describes how the ability starts:
`targetMode`, `capture` (fields copied from the bot pose at trigger, so a later move or
teleport cannot shift the hitbox), `phaseFacingDefault`, `teleportOncePerActivation`.

Every ability also names its `channel` (`ability` or `dash`) and a `cost` (`null`, or
`{ "stamina": N }`, allowed only in the `dash` channel). `channels.json` lists, per
channel, the statuses that block it (`blockedByStatuses`) and the ones among them that
also report its abilities as not ready (`notReadyWhileStatuses`).

### Verbs

The same verbs appear in `onTrigger` and in entity event `do` lists. **One executor per
runtime** runs them: browser `ecs/abilities/verbs.js` (`executeVerb`), server
`core/combat/AbilityVerbs.java` (`execute`, with a `Host` per place the verbs run).

| Verb | Does | Where |
| --- | --- | --- |
| `hit` | Instant: query `hitbox` once from the source pose (`origin` on the owner or the entity), apply `effects` to each target of `targets` in distance order, emit its `visual`. `nearestOnly` keeps the nearest touched target, `oncePerTarget` skips targets an earlier hit verb of the same trigger affected, `aim: "seekTarget"` limits an entity's shot to the enemy it chases | trigger, entity |
| `applyEffects` | Apply `effects` to the owner (`targets: ["OWNER"]`: heals, buffs, Rewind) or, in an entity event, to the event's targets. `knockbackDirection` / `pullDirection` choose the push origin | trigger (owner only), entity |
| `spawn` | Create entity `entity` (a key of this ability's `entities`), optionally with a `pattern` | trigger, entity |
| `move` | Move the owner (a dash): `distance`, `unitsPerTick`, `trailMs`; direction from the action | trigger |
| `face` | Turn the owner toward the activation target (Lock On) | trigger |
| `transition` | The entity enters phase `to` | entity |
| `remove` | Remove the entity | entity |
| `emitVisual` | Record a semantic visual event (`visualType`, `visibleMs`, `visualSize`) | entity |

A trigger verb runs in the tick stage that owns it: `face` and `move` in act (face, then
the pose capture, then move), `spawn` at the end of act from the bot's final pose (the
spawn stage then adds the entities to the world), `applyEffects` and `hit` in resolveHits.
A `hit` that names `HP_ENTITY`/`SUMMON`/`ENTITY` also reaches arena entities when the
entity ticks, as before.

**Spawn patterns** (`pattern`, count 1-12): `fan` spreads `spreadDeg` across the owner's
heading, `ring` spaces the entities evenly over 360 degrees, `line` puts them side by side
`spacing` units apart. Entity IDs and serials follow index order, and the owner's entity
serial advances by the count. A `spawn` verb inside an entity event spawns from the pose of
the entity that ran it (the bot stays the owner); the new entities join the world after
the tick.

`activation.teleportOncePerActivation` (Phase Strike) makes the trigger's teleport effect
land once, on the nearest valid target.
## 3. One tick

Both runtimes run the same seven named stages in this order (browser:
`modelPayloads/arenaPreviewSimulation.js`, `createFight(setup).step()`, one function per
stage; server: `DuelSimulationService`, one method per stage). The browser fight owns its
bots and entities and changes them in place during a tick; `fight.frame()` hands callers
new plain objects. The combat log tags every entry with the stage that produced it.

1. **`decide`.** Entities age and each bot's one-tick outputs clear. Each brain reads
   the start-of-tick snapshot and picks at most one action per category: movement,
   rotation, ability, dash, cancel. A running chain claims its categories first;
   roots fill the rest by priority (`botlogic/code/runtime/actionSelector.js`, server
   `ChainRuntime`). The server normalizes a submitted brain once, in
   `simulation/bots/BrainNormalizer.java`.
2. **`act`** (`ecs/bots/ActionExecutionSystem.applyBotAction`, server
   `ActionExecutionService.execute`), per bot:
   1. stamina timers advance (regeneration happens here);
   2. stun: interrupt, stop moving, nothing else happens;
   3. Cancel Wind-up, if chosen and affordable;
   4. movement (walk, sprint, a running dash step) and rotation (fast turn);
   5. the ability: continue or start the wind-up; at the end of the wind-up it
      triggers (active time, cooldown, charge, `face` and `move` verbs);
   6. the dash channel, after the ability;
   7. bot timers: resources, statuses, deferred state, lifecycle;
   8. the `spawn` verbs build their entities, in verb and pattern order.
3. **`resolveHits`.** `applyEffects` (owner) and `hit` of every triggered ability
   resolve against the roster (`ecs/abilities/verbs.js`
   `resolveTriggerVerbsForRoster`; server `AbilityEffectService` through
   `AbilityVerbs`). Every effect is applied by the effect registry
   (`ecs/abilities/effects.js`; server `core/combat/Effects.java`), and every "who does
   this shape touch" question is answered by `findTargets`
   (`ecs/abilities/findTargets.js`; server `core/combat/FindTargets.java`).
4. **`spawn`.** The entities built in `act` join the world.
5. **`entities`** advance (`ecs/abilities/AbilityEntitySystem.tickAbilityEntityWorld`;
   server `AbilityEntitySystem.tick`): first bound entities end and following entities
   take their owner's pose. Then every entity runs the same `tickEntity`: its clocks
   advance, impacts from bot hits and other entities land on it (HP entities), it moves by
   its phase's movement mode (`straight`, `static`, `seek`), and its due events run
   (`collision`, `trigger`, `schedule`) through the verb executor. A `lifetimeEnd` fires
   when the phase duration or the entity's lifetime runs out (an entity with no handler
   is removed), and a phase an event moves the entity into runs its collision once. A trap
   is a phase with a `trigger`, a summon is `seek` movement plus a `schedule` event. Entities
   whose phase has a `trigger` settle first and together, because a chain trigger sets off
   neighbours; the rest settle in order.
6. **`hazards`.** Closing-zone damage.
7. **`settle`.** Pending healing, damage-taken counters, Time Since Hit ages, and
   banked stamina refunds (`gameconfig/AbilityHitRecord.settleAbilityHits`;
   server `BotStateService.settleTick`).

Each source reads the latest accumulated bot state of the tick; damage,
healing, DOT and reflection settle as one net HP change.

### Combat log and golden scenarios

The combat log is an optional list of entries `{ tick, stage, kind, source, target,
abilityId, effect, amount }`. `kind` is `trigger`, `effect` (the final amount applied),
`status`, `spawn`, `phase`, `removal` or `stamina` (spend or refund). `source` and `target`
are `bot<slot>` or `<entityType>:<ownerSlot>:<serial>`, so the same fight reads the same
in both runtimes. It is **off unless asked for** and never changes a result. The browser
takes `createFight(setup, { combatLog })` (`ecs/combatLog.js`); the server takes
`DuelSimulationService.simulateLogged(request, log, observer)` (`core/orchestration/CombatLog.java`,
bound per thread). Rated runs never pass one. A new effect, status, spawn, transition,
removal or stamina path must append through the existing `logCombat` / `CombatLog.record`
funnels so it shows up.

`shared/gameplay-tests/` is the regression net built on it:

- `goldenScenarios.json`: about 20 small fights (two bots, loadouts, `ALWAYS` brains, a
  tick count) covering every ability, Dash, sprint, Cancel, a trap, a summon, reflection
  and DOT.
- `golden.browser.json` and `golden.server.json`: per scenario, the combat log plus a
  state hash for every tick, one file per runtime.
- A browser test (`testing/goldenScenarios.test.js`) and a server test
  (`GoldenScenariosTest`) run every scenario and compare with their own golden, so a
  behavior change shows up as a golden diff. After an **intended** change, regenerate with
  `npm run golden:update` (in `frontend/`) and
  `.\mvnw.cmd test -Dtest=GoldenScenariosTest -Dgolden.update=true` (in `server/`), review
  the diff, and say which lines changed and why.
- `testing/parityReport.test.js` diffs the two goldens per tick and stage and **fails
  when the runtimes disagree**. Server behavior wins: fix the browser mirror, regenerate
  its golden, and never edit a golden by hand. `PARITY_VERBOSE=1` lists every mismatch.

## 4. Ability lifecycle on the bot

The bot holds one record per ability, `abilityState[abilityId] = { stage,
remainingMs, charges, reloadMs, target }` (browser `gameconfig/AbilityState.js`,
server `core/state/AbilityState.java`). `stage` is `windup`, `active`,
`cooldown` or `ready`, and `remainingMs` is the time left in it. While active,
the record also reserves the cooldown that starts when the active stage ends
(`cooldownMs`). A missing record is a ready ability. The old loose fields
(`preparingAbility`, `preparingMs`, `abilityActiveMs`, `abilityCooldowns`,
`abilityCharges`, ...) no longer exist on a bot: replay DTOs carry them
(the browser reads a replay frame back into records with `abilityStateFromLegacy`,
the server writes them with `AbilityState.legacy*`), and the bot-logic conditions
read the records through the `AbilityState` helpers.

```text
ready -> windup -> trigger -> active -> cooldown -> ready
```

- Readiness is judged on the previous tick's state, the same state conditions
  saw. Selection keeps a started wind-up selected until it triggers.
- The cooldown starts when active time ends; only the unused part of the step in
  which the active stage ends counts toward it. Every ability that activated this
  tick (an ability and a dash can both start in one) keeps its stage for the tick.
- Charges: only `resourceModel: "reload"` is used (Pistol, 12). With charges
  left, the short cooldown applies; the last charge starts the reload instead,
  never both.
- **Channels:** a channel is busy while one of its abilities is in `windup` or
  `active`; another ability of that channel cannot start. Channels are
  independent, so any ability can wind up, fire or be active while a dash runs,
  and a dash can start during another ability's wind-up and active time.
- `readyInMs` (browser `abilityReadyInMs`) is the longest of an ability's
  cooldown, its reload and the time to afford its stamina cost.
- Defensive effects and Overclock get no active lock; their duration is a status.
- **Interrupt** (effect, stun, or `interruptCurrentAbility`): drops the wind-up
  without firing, stops active time, and starts the cooldown or reload. An
  already spawned entity keeps running.
- A status in a channel's `blockedByStatuses` stops its abilities from starting
  and cancels their wind-up: stun and silence for `ability`, stun and slow for
  `dash`. A slow that expired this tick still blocks the dash.
- Overclock's cooldown multiplier is read when a cooldown or reload is created,
  never applied to running timers. `attackSpeedMultiplier` scales cooldowns,
  `attackDamageMultiplier` scales damage (entities snapshot it at spawn).

## 5. Movement, Dash and stamina

Numbers are in `MovementConfig.js`/`.java`; logic in `gameconfig/StaminaSystem.js`
and `simulation/core/state/StaminaSystem.java`. Every value is per 100 ms tick.

| Rule | Value |
| --- | --- |
| Stamina | integer 0-100, starts full |
| Regeneration | +2 per tick, only after 500 ms with no spend; any spend restarts the pause |
| Sprint (Walk setting) | x1.5 speed, 3 per tick, needs stamina > 0, stopped by movement-lock and stun |
| Fast turn (Rotate setting) | 24 instead of 12 degrees per tick, 2 per tick, only on ticks that turn, needs >= 2 |
| Dash (19) | `cost.stamina` 30, 200 ms active, then a 100 ms cooldown (a 300 ms gap from its start); 150 units over 2 ticks |
| Cancel Wind-up | 25 stamina; no cooldown, no charge used |
| Hit refund | +10 once per activation that lands an enemy-hit effect on an enemy bot (including through its entity); paid at settle; does not touch the pause |

Dash is a `move` verb on the `dash` channel with its own action category. Nothing is
special-cased by ID: its stamina gate is the generic `cost.stamina`, its gap is
the cooldown after its active stage, and its readout is the generic `readyInMs`.

## 6. Entity phase reference

An entity: `runtimeType`, `category` (`projectile`, `zone`, `trap`, `summon`), `spawn`,
`targeting`, `lifetime`, `initialState`, `state`, `bindToCast`, `phases[]`.

A phase: `id`, `type` (`projectile`, `zone`, `summon`), optional `durationMs`, `movement`,
`hitbox`, `health`, `trigger`, `visual`, `skipOwner`, `transitionOnly`, and `on`: events,
each with `targets`, `schedule`, `targetPolicy`, `recheckCollisionOnTransition`,
`nearestOnly`, `waitForHit` and `do` (verbs). Effects are never on the phase; they live in
the `applyEffects` and `hit` verbs that apply them.

**Trigger radius.** `trigger.radius` is the only radius a trigger uses: it decides bot contact,
chain reach and which bots a `trigger` event's `do` list reaches. `hitbox.radius` (and
`radiusMultiplier`) is the entity's body and never widens, narrows or stands in for it. A phase
with a `trigger` or a `trigger` event must set `trigger.radius`, and must not also set
`hitbox.radius` unless a `collision`, `hit` or `killed` event (or `health`) uses the hitbox.
Both validators reject the rest, so a phase that wants a different body keeps its own hitbox.

**Hitboxes** (arena units, origin at the bot or entity center):
`circle { radius }`, `rectangle { length, width }` (extends forward),
`arc { range, arc }` (degrees), `ray { range, width }`. `includeTargetRadius`
lets an edge contact count. Bots are swept along their tick movement. Effective
melee reach = length or range + 30.

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
`[BOT, HP_ENTITY]`, other effects `[BOT]`. HP entities accept damage, knockback
and pull; summons also accept status and interrupt. Friendly damage only when
the target phase's `health.allowFriendlyDamage` is true.

**Effects** (applied in declared order):

| Type | Fields |
| --- | --- |
| `damage` | `amount` or `falloff { maxAmount, minAmount, falloffStart, falloffEnd }` |
| `healing` | `amount`, `recipient: "source"`, `requiresConfirmedDamage`, `mirrorsDamage` |
| `knockback`, `pull` | `amount` (units); entity events may set `knockbackDirection`/`pullDirection` |
| `status` | `subtype`, `durationMs`, `amount`, `intervalMs`, `movementLockMs`, `whileInside`, optional duration falloff |
| `buff` | `buff: "overclock"`, `multiplier`, `durationMs` |
| `interrupt` | `durationMs` (a short stun) |
| `teleport` | `distanceMode: "center_distance"` |
| `restore_state` | `delayMs` (Rewind) |
| `damage_reduction`, `damage_reflection`, `damage_immunity` | `amount`/`multiplier`, `durationMs` |

Falloff is linear from `falloffStart` to `falloffEnd`, clamped to the hitbox
range; distance is center to center.

**Statuses** are generic records on the bot (`statusEffects[]`): `type`, `mode`
(`duration` or `presence`), `remainingMs`, optional `tickMs`, `sourceSlot`,
`abilityId`, and `effects[]` from `damage`, `movement_modifier`,
`incoming_damage_modifier`, `damage_reflection`, `damage_immunity`, `stun`,
`silence`, `movement_lock`, `cooldown_modifier`. The subtypes an ability can
apply (`burn`, `bleed`, `shock`, `slow`, `stun`, `silence`) are presets in
`shared/gameplay/statuses.json`, built for bots and summons alike by the effect
registry (`effects.js` `applyStatus`; server `Effects.buildStatus`). A new
subtype is a new preset there; nothing else needs a branch.

**Hit stagger:** any hostile damage above zero gives the bot 300 ms of x0.85
movement and rotation. Slow is x0.5. The stronger one applies.

## 7. Entities

- **Clocks:** root `lifetime.duration` (does the entity exist), phase
  `durationMs` (when `lifetimeEnd` fires), event `visibleMs` (renderer only).
  An unhandled `lifetimeEnd` removes the entity.
- The first phase is the initial phase; later phases are reached only through
  `transition`. A transition keeps the entity ID and resets the phase timer,
  schedule state and hit ledger.
- **Movement modes** (`phase.movement.mode`): `straight` (forward, or `direction:
  "backward"`, `unitsPerTick`), `static`, `seek` (turn up to `turnDegrees` toward the
  nearest living enemy and move `unitsPerTick`; summons use it), `followOwner` (the
  entity's pose is the owner's pose plus the entity's `spawn` offset and rotation, every
  tick).
- **`bindToCast: true`:** the entity is removed as soon as the owner's ability that spawned
  it leaves its active stage, because it finished or was interrupted. Use it for swings,
  channelled beams and multi-hit melee; it needs an ability with an active stage.
- **Spawn:** `spawn.offset` (x right, y forward of the owner),
  `rotation` (-360..360) in `rotationSpace` `owner` or `world`;
  `targeting.position: "target"` places it at the activation target
  (`clampToRadius`, defaults). A pattern adds its angle to the heading and rotation (and
  its sideways offset to the position).
- **Traps:** a phase `trigger { radius, botContact, chain, attackHits,
  projectileOverlap }` fires the `trigger` event.
- **Summons:** `seek` movement plus a `schedule` event whose `do` is a `hit`. Silence and
  stun pause it.
- **HP entities:** phase `health { hp, maxHp }`; damage dispatches `hit` or
  `killed`.
- Replay carries `phaseId`, `phaseTimerMs`, `eventType`, `eventSequence`, never
  visual types or sizes. A summon's shot reports `eventType: "schedule"`.

## 8. Visuals

Rendering never decides hits, damage, readiness or movement.

- Entity visuals: phase `visual { type, state, visualSize }`, an `emitVisual` verb's
  `visualType`, or the `visual` of a `hit` verb; Pixi maps the type to a sprite or
  procedural effect. A trigger verb's `visual` drives the bot-room effect
  (`abilityVisual`).
- Bot visuals (swings, rays, wind-up telegraphs, shields): keyed by the trigger
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
   `19` for `move`. Every field is written out and `null` means "does not apply"; the
   validators name anything missing. A minimal instant melee ability (this one passes
   `validateGameplayData`):

   ```json
   { "id": 38, "name": "jab", "label": "Jab", "type": "ability", "channel": "ability", "cost": null,
     "timing": { "cooldownMs": 600, "windupMs": 100, "activeMs": 200, "durationMs": null,
                 "maxCharges": null, "resourceModel": null, "chargeType": null, "reloadMs": null },
     "activation": { "targetMode": null, "capture": null, "phaseFacingDefault": null,
                     "teleportOncePerActivation": null },
     "onTrigger": [ { "do": "hit",
                      "hitbox": { "shape": "rectangle", "radius": null, "range": null, "arc": null,
                                  "width": 40, "length": 80, "radiusMultiplier": 1, "includeTargetRadius": true },
                      "targets": ["BOT", "HP_ENTITY"], "nearestOnly": false, "oncePerTarget": false, "aim": null,
                      "effects": [ { "type": "damage", "amount": 9, "targetKinds": ["BOT", "HP_ENTITY"] } ],
                      "visual": { "type": "meleeSlash", "state": null, "visualSize": 120, "visibleMs": 300 } } ],
     "entities": {} }
   ```

   Anything that lives over time is an entry in `entities` plus a `spawn` verb; heals and
   buffs are `applyEffects` with `"targets": ["OWNER"]`; a new status is a preset in
   `statuses.json` applied by a `status` effect; a stamina-costed or independently locked
   action goes in the `dash` channel.
2. **Make it pickable.** Catalogue text, round/tier, `visualInterpolation` and the compact
   code letter in `frontend/src/gameArena/loadout/BotLoadout.js`; on the server
   `simulation/gameconfig/CompactAbilityCode.java`, the `service/match/loadout/` pools and the
   `BotSubmissionValidationService` allowlists. Without these the ability cannot be picked,
   submitted or validated in rated play.
3. **Give it a look.** Reuse a visual `type`, or add one to
   `pixi/botAbilityPresentationDefinitions.js` with a `pixi/renderers/<type>.js` module
   (section 8).
4. **Add code only for new vocabulary.** A new effect type, status subtype, verb, phase type,
   movement mode or targeting mode needs code in both runtimes (`effects.js` /
   `Effects.java`, `verbs.js` / `AbilityVerbs.java`) and in both validators
   (`gameplayValidation.js` / `GameplayData.java`). An ability that uses only existing
   vocabulary needs none.
5. **Test it.** Loading the data runs both validators, so a bad file fails fast. Add an
   execution test with an `ALWAYS` brain in both runtimes (tests can define small abilities
   in the same schema with `withTestAbilities` in `AbilityContracts.js` and
   `AbilityContracts.withTestAbilities` in Java; see `VerbModel.test.js` / `VerbModelTest`).
   If the ability adds a new interaction, add a scenario to `goldenScenarios.json`,
   regenerate both goldens and confirm the parity report is clean.
6. **Look at it** in the practice room, match testing and replay, and run the
   [regression checklist](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md).

**Describing an ability to an agent:** name, trigger verbs, entities, stats, each
phase (duration, movement mode, hitbox, effects, which event moves to which phase),
targeting, cooldown/charges, visuals. Example: "Arc Mine, a trap: travel
forward at 20/tick for 800 ms, then a stationary 10 s armed phase; enemy
proximity or expiry moves to a 300 ms explosion (110 radius, 30 damage once per
target). Cooldown 8 s. Browser/server parity and replay tests."

**Tests** for any gameplay change: an `ALWAYS` brain reaching the real executor
in both runtimes; both slots when symmetry matters; missing-target
fallthrough; timing (wind-up, active, cooldown, charges); effect order and
rounding; entity lifecycle and collision; deterministic repeat runs; replay
fields.

```text
frontend/: npm test, npm run lint, npm run build
server/:   .\mvnw.cmd test   (focused first: -Dtest=GameplayDataTest,AbilityContractsTest,VerbModelTest,GoldenScenariosTest)
```

A picker-only or browser-only ability is incomplete: rated play needs
normalization, server validation, authoritative activation, replay and tests.
