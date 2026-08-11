# Adding an Ability or Move

`duel-v1` is implemented twice: the browser previews testing and presentation; Spring decides rated results. A change is complete only when both runtimes share the same IDs, units, timing, targeting, effects, and replay state.

See [Ability Effect Contract](ABILITY_EFFECT_CONTRACT.md) for effect semantics and [Adding an Authoritative Backend Ability or Move](ADDING_A_BACKEND_ABILITY_OR_MOVE.md) for server details.

## 1. Define the contract

Record the stable ID, draft round, type, targeting mode, timing/resources, geometry, ordered effects, collision/ownership rules, spawned entity (if any), shield policy, interpolation mode, and required replay fields.

Use capability tags only for real gameplay contracts consumed by targeting, conditions, collision, or validation. Keep browser/server milliseconds, arena units, tick order, and rounding identical.

## 2. Browser catalog and logic

- `gameArena/gameconfig/AbilityRegistry.js`: permanent numeric ID plus the
  current protocol name, display label, and type. The `ABILITIES` object is a
  numeric-keyed map, not an array; never reuse a deleted ID or renumber later
  entries. Runtime configuration should use `ABILITIES[id]` and numeric-keyed
  tuning/contracts rather than name-based property access.
- `gameArena/loadout/BotLoadout.js`: catalog entry, actions, draft metadata, compact loadout code, interpolation, and entity capabilities.
- `gameArena/gameconfig/Abilities.js`: numeric definition.
- `gameArena/gameconfig/AbilityContracts.js`: delivery, ordered effects, and shield interaction.
- `gameArena/botlogic/code/BotCode.js`: edit only for a new condition variable, target mode, payload shape, or action head; catalog-derived actions and targets need no duplicate list.
- `gameArena/modelPayloads/strategyStatePayload.js`: expose only state the brain is allowed to observe.

Target-dependent actions must fall through when no live target exists. Keep retired IDs only in explicit migration code.

## 3. Browser execution

```text
snapshot -> brain selection -> action payload -> executor -> combat/entities -> next state
```

| Concern | Owner |
| --- | --- |
| Selected action payload | `gameArena/botlogic/planner/ArenaActionPlanner.js` |
| Readiness, resources, preparation, spawn request | `gameArena/ecs/ActionExecutionSystem.js` |
| Immediate bot combat | `gameArena/gameconfig/BotCombatSystem.js` |
| Short-lived projectiles | `gameArena/ecs/ProjectileSystem.js` |
| Persistent/targetable entities | `gameArena/ecs/EntityFactory.js`, `AbilityEntitySystem.js` |
| Timed bot effects | `gameArena/ecs/BotStatusSystem.js` |

`Arena.jsx` orchestrates returned state; it should not own ability geometry or damage. Factories create initial state; systems own ticking, collision, effects, and removal.

## 4. Visuals

- `gameArena/pixi/PixiCanvas.jsx`: bot/entity rendering and anchored HP/status UI.
- `gameArena/gameconfig/visualState.js`: pure opacity/progress calculations.
- `gameArena/pixi/pixiVisualState.js`: presentation selection and replay normalization.

Visuals may derive presentation from authoritative state, but never decide hits, damage, cooldowns, or movement.

Set `visualInterpolation` explicitly:

- `none`: instantaneous gameplay such as melee, rays, and teleports. Cosmetic sweeps/fades may use a timer but cannot move hit geometry.
- `linear`: physical motion such as bots, dashes, projectiles, waves, and summons. Interpolate only between authoritative positions.

Keep rotating bot content separate from anchored bars/icons. Keep a cast glow timer separate from the gameplay effect duration. Verify Bot Room, match testing, and replay.

## 5. Authoritative mirror

Mirror definitions, contracts, loadout validation, action eligibility, target resolution, readiness/resources, geometry, effects, entity lifecycle, and replay state. Never treat working browser behavior as rated support.

Shield policy is resolved once per impact from `shieldInteraction`; apply the remaining ordered effects. Do not independently re-apply an attached status after its hit was blocked.

## 6. Required regression coverage

Browser:

- catalog/normalization and target eligibility;
- an `ALWAYS` brain reaching the real executor;
- both bot slots when symmetry matters;
- missing-target priority fallthrough;
- entity lifecycle/collision/status timing;
- pure visual-state timing tests.

Server:

- allowlist, loadout ownership, targets, and bounds;
- authoritative `ALWAYS` execution;
- deterministic timing, geometry, damage, status, expiry, and same-tick settlement;
- entity targeting/fallthrough and replay state;
- repeated-run determinism and KO/timeout behavior.

Run `npm test`, `npm run lint`, and `npm run build` in `frontend`; run `.\mvnw.cmd test` in `server`.

## Done

Catalog, draft/loadout encoding, brain UI, normalization, submission validation, both executors, targeting, visuals, replay, and tests agree. A picker-only or validation-only implementation is incomplete.
