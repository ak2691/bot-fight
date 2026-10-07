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

## 1. Where an ability lives

Ability IDs are permanent positive integers. Never renumber or reuse one.

| What | Browser | Server |
| --- | --- | --- |
| ID, name, label | `gameconfig/AbilityRegistry.js` | `simulation/gameconfig/AbilityRegistry.java` |
| Timing and resources (`windupMs`, `activeMs`, `cooldownMs`, `durationMs`, charges/reload) | `gameconfig/Abilities.js` (`ABILITY_TIMING_BY_ID`) | `simulation/gameconfig/Abilities.java` (`TIMING_CATALOG`) |
| Behavior: phases, hitboxes, movement, effects, events, visual keys | `ecs/contracts/AbilityContracts.js` | `simulation/ecs/contracts/AbilityContracts.java` |
| Catalogue text, round/tier, tags, `visualInterpolation`, compact loadout code | `loadout/BotLoadout.js` | `CompactAbilityCode.java`, `service/match/loadout/` pools |
| How it looks | `pixi/botAbilityPresentationDefinitions.js` (bot visuals), `pixi/PixiCanvas.jsx` | none (replay carries state only) |
| Movement and stamina numbers | `gameconfig/MovementConfig.js` | `simulation/gameconfig/MovementConfig.java` |

`Abilities.js`/`.java` also expose a derived `ABILITY_STATS` / `AbilityDefinition`
projection (damage, range, ...) read from the contracts. It exists for the UI
and old consumers; never author values there.

`tools/botfight-mcp` holds structured ability specs, generates the paired
browser/Java fragments and reports field-by-field parity. Use it for new IDs.

## 2. Two kinds of contract

Both share one shape (`category`, `spawn`, `activation`, `phases[]`) and one
vocabulary, but run on different engines:

- **Attached** (`category: "botAttached"`): the ability stays on the bot. It has
  exactly one phase, and the runtime only reads `phases[0]`. When the ability
  triggers, its `activation` event (self effects, Dash movement, Lock On
  orientation) or its `collision` event (one hit test against each enemy, using
  the phase hitbox from the captured pose) runs once. Weapons, rays, melee,
  heals, buffs and Dash are attached.
- **Entity** (`projectile`, `zone`, `trap`, `summon`): the activation spawns one
  arena entity, which then runs its own phases until removed. Grenade, Fireball,
  mines, zones and drones are entities.

An ability is an entity ability exactly when `ENTITY_CONTRACTS` has its ID.
Today each activation spawns at most one entity (`abilitySpawn`). Multi-spawn
(`spawn.pattern`) is designed in `TIMED_ROUNDS_IMPLEMENTATION_PLAN.md` section 3c
but not built.

`activation` metadata only describes how the ability starts: `targetMode`,
`capture` (fields copied from the bot pose at trigger, so a later move or
teleport cannot shift the hitbox), `phaseFacingDefault`,
`teleportOncePerActivation`, `ignoresGlobalAbilityLock`.

## 3. One tick

Both runtimes, in this order (browser: `modelPayloads/arenaPreviewSimulation.js`;
server: `DuelSimulationService.simulate`):

1. **Decide.** Each brain reads the start-of-tick snapshot and picks at most one
   action per category: movement, rotation, ability, dash, cancel. A running
   chain claims its categories first; roots fill the rest by priority
   (`botlogic/code/runtime/actionSelector.js`, server `ChainRuntime`).
2. **Act** (`ecs/bots/ActionExecutionSystem.applyBotAction`, server
   `ActionExecutionService.execute`), per bot:
   1. stamina timers advance (regeneration happens here);
   2. stun: interrupt, stop moving, nothing else happens;
   3. Cancel Wind-up, if chosen and affordable;
   4. movement (walk, sprint, a running dash step) and rotation (fast turn);
   5. the ability: continue or start the wind-up; at the end of the wind-up it
      triggers (active time, cooldown, charge, activation state);
   6. Dash, through its own channel, after the ability;
   7. bot timers: resources, statuses, deferred state, lifecycle;
   8. the spawned entity, if any.
3. **Direct hits.** Each triggered attached ability resolves against enemy bots
   (`gameconfig/BotCombatSystem.resolveTriggeredAbilityCombatForRoster` with
   `ecs/abilities/AbilityEffectSystem`; server `AbilityEffectService`).
4. **Entities** advance (`ecs/abilities/AbilityEntitySystem.tickAbilityEntityWorld`;
   server `AbilityEntitySystem.tick`): traps first, then projectiles, zones and
   summons; collisions dispatch phase events; HP entities take damage from bot
   attacks and other entities.
5. **Closing zone** damage.
6. **Settle:** pending healing, damage-taken counters, Time Since Hit ages, and
   banked stamina refunds (`gameconfig/AbilityHitRecord.settleAbilityHits`;
   server `BotStateService.settleTick`).

Each source reads the latest accumulated bot state of the tick; damage,
healing, DOT and reflection settle as one net HP change.

## 4. Ability lifecycle on the bot

```text
ready -> wind-up (preparingAbility, preparingMs) -> trigger
      -> active (abilityActiveMs) -> cooldown (abilityCooldowns) -> ready
```

- Readiness is judged on the previous tick's state, the same state conditions
  saw. Selection keeps a started wind-up selected until it triggers.
- `cooldownMs` starts when active time ends. While active, the cooldown waits in
  `abilityPendingCooldownMs`; only the unused part of the step in which active
  time ends counts toward it. The ability that triggered this tick does not
  lose time this tick (`justActivatedAbilityId`).
- Charges: only `resourceModel: "reload"` is used (Pistol, 12). With charges
  left, the short cooldown applies; the last charge starts the reload instead,
  never both.
- **Global ability lock:** while a bot winds up or has any active ability,
  another ability cannot start. Abilities with `ignoresGlobalAbilityLock` (Dash)
  neither block nor wait.
- Defensive effects and Overclock get no active lock; their duration is a status.
- **Interrupt** (effect, stun, or `interruptCurrentAbility`): drops the wind-up
  without firing, stops active time, and starts the cooldown or reload. An
  already spawned entity keeps running.
- Silence blocks every ability except Dash. Slow blocks Dash
  (`movement.blockedByStatus`).
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
| Dash (19) | 30 stamina, then a 300 ms gap; no cooldown; 150 units over 2 ticks |
| Cancel Wind-up | 25 stamina; no cooldown, no charge used |
| Hit refund | +10 once per activation that lands an enemy-hit effect on an enemy bot (including through its entity); paid at settle; does not touch the pause |

Dash is an attached ability (`movement` on its phase, `startMovement` on
activation) with its own action category and channel. Its stamina gate, gap and
"cooldown" readout are special-cased by ID (`DASH_ABILITY_ID`).

## 6. Phase contract reference

A phase: `id`, `type`, optional `durationMs`, `movement`, `orientation`,
`hitbox`, `health`, `trigger`, `execution`, `visual`, `effects[]`, `events{}`,
`skipOwner`, `transitionOnly`, `hit: { mode: "nearest" }`.

**Hitboxes** (arena units, origin at the bot or entity center):
`circle { radius }`, `rectangle { length, width }` (extends forward),
`arc { range, arc }` (degrees), `ray { range, width }`. `includeTargetRadius`
lets an edge contact count. Bots are swept along their tick movement. Effective
melee reach = length or range + 30.

**Events:** `activation`, `collision`, `trigger`, `hit`, `killed`,
`lifetimeEnd`. Each handler lists `actions` from `applyEffects`, `transition`
(`transition.to`), `emitVisual` (with `visualType`, `visibleMs`, `visualSize`),
`remove`, `startMovement`, `startOrientation`.

- `schedule.mode`: `once` (checked when the phase starts; later arrivals miss),
  `continuous` (collision every tick, the default for collision), `repeat`
  (`intervalMs`, `count`, `startImmediately`).
- `targetPolicy.mode`: `everyTick` (default), `once` per target per phase,
  `interval`. The ledger resets on transition.
- `effectTypes` / `statusTypes` on a handler run only a subset of the phase
  effects.
- `recheckCollisionOnTransition: false` stops the entered phase from running
  its own collision check on the same tick.

**Target kinds:** `BOT`, `HP_ENTITY`, `SUMMON`, `ENTITY`. The event's
`targetKinds` decides who the event reaches; each effect's `targetKinds`
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
apply (`burn`, `bleed`, `shock`, `slow`, `stun`, `silence`) are built in
`AbilityEffectSystem.applyStatusEffect` / `AbilityEffectService`. A new subtype
needs a branch there, plus the summon path in the entity systems.

**Hit stagger:** any hostile damage above zero gives the bot 300 ms of x0.85
movement and rotation. Slow is x0.5. The stronger one applies.

## 7. Entities

- **Clocks:** root `lifetime.duration` (does the entity exist), phase
  `durationMs` (when `lifetimeEnd` fires), event `visibleMs` (renderer only).
  An unhandled `lifetimeEnd` removes the entity.
- The first phase is the initial phase; later phases are reached only through
  `transition`. A transition keeps the entity ID and resets the phase timer,
  schedule state and hit ledger.
- **Spawn:** `spawn.offset` (x right, y forward of the owner),
  `rotation` (-360..360) in `rotationSpace` `owner` or `world`;
  `targeting.position: "target"` places it at the activation target
  (`clampToRadius`, defaults).
- **Traps:** a phase `trigger { radius, botContact, chain, attackHits,
  projectileOverlap }` fires the `trigger` event.
- **Summons:** seek the nearest enemy (`movement.speed`, `turnDegrees`); their
  attack is a contract-owned mini ability (`abilities[]`) fired by
  `execution { abilityId, intervalMs }`. Silence and stun pause it.
- **HP entities:** phase `health { hp, maxHp }`; damage dispatches `hit` or
  `killed`.
- Replay carries `phaseId`, `phaseTimerMs`, `eventType`, `eventSequence`, never
  visual types or sizes.

## 8. Visuals

Rendering never decides hits, damage, readiness or movement.

- Entity visuals: phase `visual { type, state, visualSize }` and event
  `visualType`; Pixi maps the type to a sprite or procedural effect.
- Bot visuals (swings, rays, wind-up telegraphs, shields): keyed by ability ID
  in `pixi/botAbilityPresentationDefinitions.js` (`windupEffect`,
  `directEffect`, `activeEffect`, `marker`, `onVisualStart`, `shapeEffect`),
  drawn in `PixiCanvas.jsx`, driven only by `preparingMs`, `abilityActiveMs` and
  `abilityVisual`. Draw hitbox-shaped effects from the contract numbers. No
  `Math.random`.
- `visualInterpolation` in `BotLoadout.js`: `none` for instant effects and
  teleports, `linear` for physical motion.
- Check practice room (both slots), match testing and replay, and run
  [`ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md).

## 9. Making a change

**Tuning a number:** edit the timing catalog or the phase in both runtimes,
update nearby expectations, run the focused tests.

**Adding an existing effect to an ability:** edit both phase contracts; usually
no system code changes. Add an execution test.

**New ability:** usually touches `AbilityRegistry`, `Abilities`,
`AbilityContracts`, `BotLoadout`/compact code, `MatchLoadoutService` pools,
`BotSubmissionValidationService` allowlists, and a presentation entry. Use the MCP (`add_ability`, then
`check_ability_parity`). A new effect type, status subtype, phase type,
movement kind or targeting mode also needs code in both runtimes' systems.

**Describing an ability to an agent:** name, attached or entity, stats, each
phase (duration, movement, hitbox, effects, which event moves to which phase),
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
server/:   .\mvnw.cmd test   (focused first: -Dtest=AbilitiesTest,AttachedAbilityContractsTest,AbilityEntitySystemTest)
```

A picker-only or browser-only ability is incomplete: rated play needs
normalization, server validation, authoritative activation, replay and tests.
