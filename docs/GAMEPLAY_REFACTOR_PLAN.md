# Gameplay refactor plan

Status: planned 2026-10-07, not started. Goal: one ability model, one effect
path, one entity tick, ability data written once for both runtimes, and a
combat log for debugging. Owner decisions are in section 1. Run the stages in
section 3 in order; each has a Sonnet prompt in section 4. Delete this file
when the last stage lands (git history keeps it).

Rules for every stage:

- Both runtimes in the same stage (browser `frontend/src/gameArena/`, server
  `server/src/main/java/com/example/botfight/simulation/`).
- Behavior must not change unless the stage says so. The golden logs (R1)
  prove it; when a stage changes behavior on purpose, regenerate the goldens
  and say which lines changed and why.
- Replay DTOs and bot-condition values keep their current shape. Internal
  state may change; the replay mapper and the state-variable resolver derive
  the old fields.
- No ability-ID branches in systems. Behavior comes from data.

## 1. Decisions

| Topic | Decision |
| --- | --- |
| Ability model | Full verb model. No attached/entity split: an ability runs verbs; anything that lives over time is an entity. Attached vs free-flying is the entity's movement mode |
| Data | One shared JSON source in `shared/gameplay/`, loaded by both runtimes |
| Ability state | One `abilityState[abilityId]` record per bot replaces the loose wind-up/active/cooldown fields |
| Stamina | Physical actions only: sprint, fast turn, Dash, Cancel Wind-up. Only the `dash` channel may declare a stamina cost |
| Dash | Its own channel. Channels lock independently, so any ability can wind up, fire or be active while a dash runs, and the reverse |
| Slow | x0.5 movement and rotation for bots and summons (summons are x0.85 today: a bug) |
| Removed | Resource models `regenerate`, `fixed`, `hp` (only Pistol's `reload` stays); `effectOverrides`; other dead code listed in R0 |

## 2. Target design

### 2.1 Shared data

```text
shared/gameplay/
  abilities.json   one entry per ability ID: identity, channel, timing, cost, charges, onTrigger verbs, entities
  statuses.json    status presets (slow, burn, bleed, shock, stun, silence, ...)
  channels.json    lock and blocking rules per channel
  movement.json    MovementConfig numbers (stamina, sprint, fast turn, dash gap)
```

- **No implicit defaults.** Every field the runtimes read is written in the
  JSON. Each runtime may only check it, never fill it in. That is what keeps
  the two runtimes from drifting.
- **Browser:** `gameconfig/gameplayData.js` imports the files
  (`import abilities from ".../abilities.json" with { type: "json" }`, which
  works in Vite and Node 20 tests), runs `validateGameplayData`, freezes the
  result and exports it. Everything else imports from that module.
- **Server:** Maven copies `../shared/gameplay` onto the classpath as
  `gameplay/` (a `<resource>` entry in `pom.xml`). `simulation/gameconfig/GameplayData.java`
  reads it once with Jackson 3 `JsonMapper` (unknown properties fail) into
  immutable records with enums for every closed vocabulary, then runs the same
  semantic checks as the browser. Any error throws, so the app does not start
  and tests fail.
- **Semantic checks (both runtimes, same list):** unique positive IDs; enums
  known; every `transition.to` names a phase of that entity; every `spawn`
  names an entity; every `*Ms` is a multiple of 100 and in bounds; counts and
  sizes in bounds; effect fields required by their type are present; stamina
  `cost` only on the `dash` channel; at most one entity spawned per verb
  unless a `pattern` is given (count 1-12).
- **Docker:** build contexts stay `./frontend` and `./server`. Each service
  adds `additional_contexts: { shared: ./shared }` in `docker-compose.yml`,
  and its Dockerfile adds `COPY --from=shared . /shared` before the build, so
  the relative paths (`/app/../shared`) resolve the same as in the repo.
- `tools/botfight-mcp` becomes a JSON editor plus validator; its code
  generator and parity checker are retired. `chainScenarios.json` is the
  existing precedent for a file both runtimes read.

### 2.2 Ability

```json
{ "id": 1, "name": "slash", "label": "Slash", "channel": "ability",
  "timing": { "windupMs": 0, "activeMs": 300, "cooldownMs": 500 },
  "onTrigger": [
    { "do": "hit",
      "hitbox": { "shape": "arc", "range": 92, "arc": 120, "includeTargetRadius": true },
      "targets": ["BOT", "HP_ENTITY"],
      "effects": [{ "type": "damage", "amount": 8, "targets": ["BOT", "HP_ENTITY"] }],
      "visual": { "type": "meleeSlash", "size": 207, "visibleMs": 400 } }
  ] }
```

```json
{ "id": 19, "name": "dash", "label": "Dash", "channel": "dash",
  "cost": { "stamina": 30 },
  "timing": { "windupMs": 0, "activeMs": 200, "cooldownMs": 300 },
  "onTrigger": [{ "do": "move", "distance": 150, "unitsPerTick": 75, "trailMs": 300,
                  "visual": { "type": "dash", "size": 114, "visibleMs": 300 } }] }
```

```json
{ "id": 12, "name": "shotgun_blast", "channel": "ability", "timing": { "...": 0 },
  "onTrigger": [{ "do": "spawn", "entity": "pellet",
                  "pattern": { "type": "fan", "count": 7, "spreadDeg": 40 } }],
  "entities": { "pellet": { "...": "see 2.4" } } }
```

Fields:

- `channel`: `ability` (weapons and abilities) or `dash`.
- `timing`: `windupMs`, `activeMs`, `cooldownMs`.
- `cost.stamina`: dash channel only.
- `charges`: `{ "max", "reloadMs" }`. Reload when empty; the only model.
- `targetMode`: whether the ability needs a target from the brain.
- `capture`: freezes the pose at trigger.
- `onTrigger`: verbs run in order when the wind-up ends.

### 2.3 Verbs

The same verbs appear in `onTrigger` and in entity phase events.

| Verb | Does |
| --- | --- |
| `hit` | Instant: query the hitbox from the source pose once, apply `effects` to each target in distance order, emit its visual. Optional `nearestOnly`, `oncePerTarget` |
| `spawn` | Create entity `entity` (from this ability's `entities`), optional `pattern` (`fan`, `ring`, `line`). Serial IDs in index order |
| `move` | Move the owner (a dash): `distance`, `unitsPerTick`, `direction` from the action |
| `face` | Turn the owner toward the activation target (Lock On) |
| `applyEffects` | Apply `effects` to the event's targets (or the owner, for self effects) |
| `transition` | Entity enters phase `to` |
| `remove` | Remove the entity |
| `emitVisual` | Semantic visual event (`type`, `size`, `visibleMs`) |

Self abilities (heal, Overclock, armor) are `applyEffects` with
`"targets": ["OWNER"]`. Phase Strike's teleport stays an effect type.

### 2.4 Entities and attachment

```json
"entities": {
  "grenade": {
    "lifetimeMs": 3000, "spawn": { "offset": [0, 38], "rotation": 0, "rotationSpace": "world" },
    "snapshot": { "damageMultiplier": "owner.attackDamageMultiplier" },
    "phases": [
      { "id": "travel", "durationMs": 1000,
        "movement": { "mode": "straight", "unitsPerTick": 32 },
        "hitbox": { "shape": "rectangle", "length": 12, "width": 12 },
        "visual": { "type": "grenade", "state": "moving", "size": 12 },
        "on": {
          "collision":   { "targets": ["BOT", "HP_ENTITY"], "schedule": { "mode": "continuous" },
                           "do": [{ "do": "transition", "to": "active" }] },
          "lifetimeEnd": { "do": [{ "do": "transition", "to": "armed" }] } } }
    ] }
}
```

- **Movement mode decides attached vs flying:**
  - `straight`: forward or `backward`, `unitsPerTick`;
  - `static`;
  - `seek`: nearest enemy, `unitsPerTick`, `turnDegrees`;
  - `followOwner`: pose = owner pose + spawn offset, every tick.
- **`bindToCast: true`**: the entity is removed when the owner's ability that
  spawned it is interrupted or ends its active stage. Use it for swings,
  channelled beams and multi-hit melee.
- **Events** (`on`): `collision`, `trigger`, `hit`, `killed`, `lifetimeEnd`,
  `schedule` (a timer event with `intervalMs`, `count`, `startImmediately`).
  Each event has `targets`, an optional `schedule` (`once`, `continuous`,
  `repeat`), an optional `targetPolicy` (`everyTick`, `once`, `interval`) and
  `do` (verbs).
- **A trap** is a phase with a `trigger` event (`radius`, `botContact`,
  `chain`, `attackHits`).
- **A summon** is `seek` movement plus a `schedule` event whose `do` is a
  `hit`. The drone mini-abilities become ordinary verbs.
- `health` (`hp`, `maxHp`, `allowFriendlyDamage`) on a phase makes the entity
  damageable.

### 2.5 Ability state on the bot

```js
abilityState: { [abilityId]: { stage: "windup" | "active" | "cooldown" | "ready",
                                remainingMs, charges?, reloadMs?, target? } }
```

- `stage` and `remainingMs` describe the ability's current stage.
- When `active` ends, `cooldown` starts. Only the leftover of that tick counts
  toward it, as today.
- Overclock and `attackSpeedMultiplier` scale a cooldown or reload when it is
  created.
- A channel is busy while any of its abilities is in `windup` or `active`.
  Channels are independent, and `channels.json` lists the statuses that block
  each channel (today: `ability` is blocked by stun and silence; `dash` by
  stun, slow and movement-lock).
- These replace `preparingAbility`, `preparingMs`, `preparingTarget*`,
  `abilityActiveMs`, `abilityCooldowns`, `abilityPendingCooldownMs`,
  `abilityCharges`, `abilityRechargeMs`, `justActivatedAbilityId`, `dashGapMs`
  and `ignoresGlobalAbilityLock`. The replay mapper and the condition resolver
  derive the old values.
- One generic `readyInMs(bot, id)` = max(cooldown, reload, time to afford the
  stamina cost) replaces `dashWaitMs`.

### 2.6 Effects, statuses, targets

- **Effect registry:** `EFFECTS[type] = { apply(ctx) }`, one per runtime
  (`ecs/abilities/effects.js`, `simulation/core/combat/Effects.java`), used for
  bots and entities alike. `ctx` carries `source`, `target`, `distance`,
  `ability`, `world`, `log`. Knockback, pull, damage, falloff and so on exist
  once.
- **Status presets** in `statuses.json`:
  `"slow": { "effects": [{ "type": "movement_modifier", "movement": 0.5, "rotation": 0.5 }] }`.
  A status effect in an ability names a preset and adds its duration, amount
  and interval. Summons use the same presets.
- **Target query:** one `findTargets(pose, hitbox, { kinds, sweep, skipOwner })`
  returns ordered `{ target, distance }`. It serves `hit`, entity collision,
  traps and entity-vs-entity damage.

### 2.7 Tick pipeline and combat log

The same named stages in both runtimes:

1. `decide`
2. `act`: stamina timers, stun, cancel, movement, channels, trigger verbs
3. `resolveHits`
4. `spawn`
5. `entities`
6. `hazards`
7. `settle`

Every effect application, trigger, spawn, transition and removal appends one
log line, for example `{ tick, stage, kind, source, target, abilityId, effect, amount }`.

The log is:

- off in rated runs unless requested;
- shown in a practice-room debug panel later;
- the basis of the golden tests.

## 3. Stages

| Stage | What | Behavior change |
| --- | --- | --- |
| R0 | Small fixes and dead code | Summon slow 0.5 only |
| R1 | Combat log, named stages, golden scenarios in both runtimes | None |
| R2 | Shared JSON for today's data, loaders, validators, Docker, MCP | None |
| R3 | `abilityState`, channels, generic stamina cost, Dash with no special cases | None |
| R4 | Effect registry, status presets, `findTargets` | None (golden-proved) |
| R5 | Verb model: `onTrigger`, entity `on` verbs, movement modes, `bindToCast`, spawn patterns | None for existing abilities |
| R6 | One `tickEntity`; traps and summons as data | None |
| R7 | Visuals keyed by visual type; renderer modules out of `PixiCanvas.jsx` | None |
| R8 | Server tidy-up (brain normalization out, `Bot` own file), rewrite `docs/ABILITIES.md`, delete this plan | None |

After R5, Shotgun Blast (old S7) is a data change plus pellet visuals.

## 4. Sonnet prompts

### R0: Small fixes and dead code

```
Botfight, both runtimes (frontend/src/gameArena, server .../simulation). See
docs/GAMEPLAY_REFACTOR_PLAN.md section 1.
- Summon slow: use x0.5 movement and rotation like bots (browser
  AbilityEntitySystem applySummonStatus/summonMovementMultiplier; server
  AbilityEntitySystem.summonMovementMultiplier and ArenaEntityCombatService).
- Remove resource models regenerate, fixed and hp (AbilityResourceSystem.js,
  BotResourceSystem.js, server Abilities.ResourceModel and BotStateService);
  keep reload.
- Remove effectOverrides end to end (AbilityContracts, AbilityEffectSystem,
  EntityEffectSystem, EntityEventSystem, AbilityEntitySystem and the server
  mirrors: withEffectOverride/effectOverrideFor/EffectOverride).
- Remove: the spawnedThisTick check, `const stats = {}` placeholders and the
  helpers that only exist to read them, the unused CONCUSSIVE_*_SLOW_DURATION
  constants, `damage > 0 ? next : next`.
- pixi/botAbilityPresentationDefinitions.js: fix role names (16 reactive-armor,
  23 absolute-guard, 30 disruptor-dart, 32 vampiric-beam, 33 overclock,
  34 basic-strike) and anything keyed on the old names.
Update affected tests. Run frontend npm test, lint, build and server
.\mvnw.cmd test. Don't commit.
```

### R1: Combat log and golden scenarios

```
Botfight, both runtimes. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md 2.7.
- Split the browser tick (modelPayloads/arenaPreviewSimulation.js) and the
  server loop (DuelSimulationService.simulate) into the named stages decide,
  act, resolveHits, spawn, entities, hazards, settle, as small functions with
  the same names in both runtimes. No behavior change.
- Add an optional combat log passed through the tick: one entry per trigger,
  effect application (with final amount), status applied, spawn, phase
  transition, removal, and stamina spend/refund. Off unless requested.
- Add shared/gameplay-tests/goldenScenarios.json: about 20 scenarios (two bots,
  loadouts, small ALWAYS brains, tick count) covering every ability, Dash,
  sprint, cancel, a trap, a summon, reflection, DOT. A browser test and a
  server test each run every scenario and compare against a committed golden
  file per runtime (log plus per-tick bot/entity state hash). Add an npm
  script and a Maven property to regenerate goldens.
- Add a report test that diffs browser vs server logs per scenario; it lists
  mismatches but does not fail yet.
Run all tests. Don't commit.
```

### R2: Shared gameplay data

```
Botfight, both runtimes. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md 2.1.
Move today's data, unchanged in meaning, into shared/gameplay/: abilities.json
(AbilityRegistry, Abilities timing, AbilityContracts attached and entity
contracts), statuses.json (the status shapes built in
AbilityEffectSystem.applyStatusEffect), movement.json (MovementConfig).
- Write every value explicitly; runtimes add no defaults.
- Browser: gameconfig/gameplayData.js imports the JSON with
  `with { type: "json" }`, validates (gameconfig/gameplayValidation.js),
  freezes and exports. AbilityContracts.js, Abilities.js, AbilityRegistry.js
  and MovementConfig.js read from it and keep their exported API.
- Server: pom.xml resource entry copies ../shared/gameplay to classpath
  gameplay/. simulation/gameconfig/GameplayData.java loads it with Jackson 3
  JsonMapper (FAIL_ON_UNKNOWN_PROPERTIES on) into records with enums, runs the
  same semantic checks (plan 2.1 list), and throws on error. Abilities.java,
  AbilityContracts.java, AbilityRegistry.java and MovementConfig.java read from
  it.
- docker-compose.yml: keep both build contexts; add
  `additional_contexts: { shared: ./shared }` to backend and frontend, and
  `COPY --from=shared . /shared` in each Dockerfile before the build step.
- tools/botfight-mcp: edit and validate the JSON instead of generating
  fragments; drop the parity checker.
- Validation tests on both sides: one valid file, plus a broken file per rule.
Goldens must not change. Run all tests and docker compose build. Don't commit.
```

### R3: Ability state, channels and Dash

```
Botfight, both runtimes. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md 2.5.
- Replace the loose ability fields with abilityState[abilityId] = { stage,
  remainingMs, charges, reloadMs, target } in browser bot state and server Bot.
  Keep cooldown-after-active timing exactly (leftover-of-tick rule), reload
  rules, Overclock/attackSpeed applied at creation, interrupt behavior.
- Add `channel` to each ability and shared/gameplay/channels.json with blocking
  statuses. A channel is busy while one of its abilities is in windup or
  active; channels are independent. Remove ignoresGlobalAbilityLock.
- Dash: cost.stamina 30 and cooldownMs 300 in the JSON replace dashGapMs and
  every DASH_ABILITY_ID branch (StaminaSystem, ActionExecutionSystem,
  actionRuntime, BotLogicContracts, server mirrors). Generic readyInMs replaces
  dashWaitMs. Validation rejects stamina cost outside the dash channel.
- Replay mapping and state-variable resolvers derive the old fields
  (preparingAbility, preparingMs, abilityActiveMs, abilityCooldowns,
  abilityCharges, ...) so replay DTOs and conditions are unchanged.
- Add a test: an ability starts, winds up and fires while a dash is active,
  and a dash starts during another ability's wind-up and active time.
Goldens must not change. Run all tests. Don't commit.
```

### R4: Effects, statuses, targets

```
Botfight, both runtimes. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md 2.6.
- One effect registry per runtime (browser ecs/abilities/effects.js, server
  simulation/core/combat/Effects.java): one apply function per effect type for
  bots and HP entities. Replace AbilityEffectSystem.applyEffect,
  EntityEffectSystem.applyEntityEffects and AbilityEntitySystem
  applyIncomingImpact/applySummonStatus, and the server's AbilityEffectService,
  ArenaEntityCombatService and AbilityEntitySystem copies (amount, falloff,
  range, knockback, pull). Remove Bot.applySlow/applyStun/applySilence.
- Statuses are built from statuses.json presets for bots and summons.
- One findTargets(pose, hitbox, options) per runtime used by direct hits,
  entity collisions, traps and entity-vs-entity damage; remove the legacy
  damageToEntity path.
Goldens must not change. Run all tests. Don't commit.
```

### R5: Verb model

```
Botfight, both runtimes. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md 2.2-2.4.
- Schema: abilities get onTrigger verbs; entities get phases with `on` events
  whose `do` lists verbs; movement modes straight/static/seek/followOwner;
  bindToCast; spawn pattern fan/ring/line (count 1-12). Convert every ability
  in abilities.json. Update both validators.
- Runtime: one verb executor per runtime used by triggers and entity events.
  Weapons and rays use `hit`; heals and buffs use applyEffects on OWNER; Dash
  uses `move`; Lock On uses `face`; drone shots become a schedule event with a
  `hit`. abilitySpawn becomes a list; serials in index order.
- Remove the attached/entity distinction (BotCombatSystem
  resolveTriggeredAbilityCombatForRoster, attachedAbility* helpers,
  phaseForAttachedAbility, server attachedAll) once nothing uses it.
- Tests: a followOwner bindToCast entity is removed on interrupt; a fan spawn
  with 7 entities and its serial order; a spawn verb inside an entity event.
Goldens must not change for existing abilities. Run all tests. Don't commit.
```

### R6: One entity tick

```
Botfight, both runtimes. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md 2.4.
Rewrite AbilityEntitySystem (browser and server) as one tickEntity: advance
clocks, move by movement mode, apply incoming impacts, run due events
(collision/trigger/schedule), handle lifetimeEnd and phase entry (the entered
phase's once-collision check lives in one place). Traps and summons are data
(trigger event, seek mode, schedule event); remove tickTrapEntities,
tickCanonicalProjectile/Zone/Summon and the armed-flag fallback. Keep entity
order and same-tick settlement. Goldens must not change. Run all tests. Don't
commit.
```

### R7: Visual registry

```
Botfight frontend. Plan: docs/GAMEPLAY_REFACTOR_PLAN.md.
- Bot ability visuals are keyed by the verb's visual `type` from
  abilities.json instead of ability ID; botAbilityPresentationDefinitions.js
  becomes a map from visual type to renderer settings.
- Move each renderer out of pixi/PixiCanvas.jsx into pixi/renderers/<type>.js
  exporting { create, update, destroy }, driven only by state and contract
  numbers (no Math.random). PixiCanvas keeps scene lifecycle and dispatch.
- Adding a visual = one renderer file + one JSON type name.
Check practice room, match testing and replay against
docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md. Update tests. Run npm
test, lint, build. Don't commit.
```

### R8: Server tidy-up and docs

```
Botfight. Move brain JSON normalization out of DuelSimulationService into
simulation/bots/BrainNormalizer.java and give Bot its own file; the service
keeps only the tick loop and replay recording. Make the browser/server log diff
test from R1 fail on mismatch. Rewrite docs/ABILITIES.md for the new model
(shared JSON, verbs, entities, ability state, channels, effects, statuses,
combat log, how to add an ability); update context maps if responsibilities
moved; delete docs/GAMEPLAY_REFACTOR_PLAN.md. Run all tests. Don't commit.
```
