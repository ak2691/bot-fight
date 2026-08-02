# Arena and Pixi context

This area is the browser testing/runtime preview and presentation surface. It
mirrors rated behavior for player feedback, but the Spring simulator decides
rated results.

## Ownership map

- `BetaModel.jsx`: testing-room state, fixed-step arena loop, logic action
  application, entity ticking, submission coordination, and state snapshots.
- `StrategyTestingPanel.jsx`: logic-tree/strategy authoring controls and
  testing feedback. Brain schema behavior belongs in `../logic/`, not only UI.
- `PixiCanvas.jsx` + `PixiCanvas.css`: Pixi scene lifecycle, layers, sprites,
  arena/fighter/entity rendering, overlays, and status presentation.
- `AbilityStatusPanel.jsx`: player-facing cooldown/charge/status display.
- `loadout/BotLoadout.js`: ability catalog metadata, round pools, loadout
  normalization/encoding, stat budgets, action mapping, and visual capabilities.
- `modelPayloads/`: arena units/constants, shape construction, and the logic
  feature/state snapshot contract.
- `combat/`: browser numeric definitions, declarative effect contracts,
  geometry, shield/defensive rules, fighter combat, and visual timers.
- `ecs/`: transient/persistent arena entities and action/effect execution.
- `pixi/`: renderer-only texture caching, snapshot interpolation, and mapping
  gameplay shapes/state to Pixi layers/captions/visual state.
- `ArenaObjects.js`: transient ability-entity identifiers and presentation geometry used by testing/replay.

## Route by symptom

| Symptom/change | Start here | Then check |
| --- | --- | --- |
| Pixi object missing, wrong layer/caption/texture | renderer and `pixi/` areas | shape producer and visual regression checklist |
| Jitter, teleport smear, rotation/interpolation bug | `pixi/` | combat visual-state area and snapshot timestamps |
| Wrong cooldown/charge/status visual | presentation and `combat/` areas | gameplay timer owner in `ecs/` or combat |
| Damage, shield, effect, or collision bug | `combat/`, then `ecs/` | arena tick orchestration and server mirror |
| Projectile/trap/summon/entity behavior | `ecs/` | combat contracts and server `simulation/ecs/` |
| Action does not execute | `../logic/` and `ecs/` | loadout action mapping and brain selection |
| Condition/target sees wrong data | `modelPayloads/` | `../logic/` and shape construction |
| Ability draft/loadout/stat issue | `loadout/` | frontend and server matchmaking areas |
| Testing loop/state coordination | arena orchestrator | focused system/helper and submission area |
| Replay-only mismatch | `../replay/` | `pixi/` mapping and server replay DTO area |

## Boundaries to preserve

- Gameplay systems produce state; Pixi reads and presents it. Rendering must not
  determine hits, damage, cooldown readiness, target selection, or match result.
- `modelPayloads/strategyStatePayload.js` is a logic contract, not a convenient
  view model. Coordinate/field changes require brain and server parity review.
- Ability IDs and numeric tuning are mirrored by server `simulation/combat/`.
  Entity lifecycle/effects are mirrored by server `simulation/ecs/` and
  `DuelSimulationService`.
- Keep fixed-step timing, arena units, collision geometry, rounding, effect
  order, loadout encoding, and seeded choices aligned across runtimes.
- Add presentation metadata to visual helpers/catalogs instead of branching on
  ability names throughout `PixiCanvas.jsx`.

## Relevant documentation

Read [`../../../docs/context.md`](../../../docs/context.md) before adding an
ability or changing effect/shield/entity semantics. For visual, timer, transform,
or simultaneous-effect work, run through the regression checklist indexed there.

## Tests

- `ecs/EntitySystems.test.js`: action execution, entity lifecycle, combat/status
  interactions, and tick-order regressions.
- `pixi/snapshotInterpolation.test.js`: position interpolation math.
- `pixi/pixiVisualState.test.js`: renderer mapping and visual-state rules.
- `../logic/BotBrain.test.js`: schema, conditions, targets, normalization, and
  deterministic selection.
- `../logic/MovementActions.test.js`: movement intent generation.

After focused tests, run `npm test`; for JSX/CSS/import changes also run lint and
build from `frontend/`.
