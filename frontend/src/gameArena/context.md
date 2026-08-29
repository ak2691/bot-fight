# Game Arena context

This area is the browser testing/runtime preview and presentation surface. It
mirrors rated behavior for player feedback, but the Spring simulator decides
rated results.

## Ownership map

- `Arena.jsx`: testing-room state, fixed-step arena loop, logic action
  application, entity ticking, submission coordination, state snapshots, and
  live-match code-view responders plus editable sandbox copies.
- `coding/CodingPanel.jsx`: coding workspace composition root, toolbar,
  history, modal coordination, outer workspace layout, and read-only live
  participant snapshots.
- `coding/LogicBoard.jsx`: graph canvas interaction, node positioning, branch
  edits, selection, and search integration.
- `coding/nodes/GraphNodes.jsx`: graph layout, condition/action node rendering,
  inspectors, operand editors, and shared coding controls.
- `coding/controls/`: priority and toolbar icon controls used by the coding UI.
- `coding/modals/`: custom-variable and root-search modal implementations.
- `coding/utils/`: coding-menu coordination and custom-variable search helpers.
- `status/`: player-facing cooldown, charge, and ability-status presentation.
- `pixi/PixiCanvas.jsx` + `pixi/PixiCanvas.css`: Pixi scene lifecycle, layers,
  sprites, arena/bot/entity rendering, and presentation overlays.
- `loadout/BotLoadout.js`: ability catalog metadata, round pools, loadout
  normalization/encoding, action mapping, and visual capabilities.
- `botlogic/code/`: structured bot-code contract with `BotCode.js` as the public
  entry point and helpers split into `configuration/`, `runtime/`, and `tests/`.
- `modelPayloads/`: arena units/constants, shape construction, and the logic
  feature/state snapshot contract.
- `gameconfig/`: browser numeric definitions, declarative effect contracts,
  geometry, shield/defensive rules, bot combat, and visual timers.
- `ecs/`: deterministic arena execution organized into `contracts/`, `bots/`,
  `abilities/`, and `entities/`; see `ecs/context.md` for ownership and
  boundaries.
- `pixi/`: renderer-only texture caching, snapshot interpolation, and mapping
  gameplay shapes/state to Pixi layers/captions/visual state.
- `ArenaObjects.js`: transient ability-entity identifiers and presentation
  geometry used by testing/replay.

## Route by symptom

| Symptom/change | Start here | Then check |
| --- | --- | --- |
| Pixi object missing, wrong layer/caption/texture | `pixi/` | shape producer and visual regression checklist |
| Jitter, teleport smear, rotation/interpolation bug | `pixi/` | combat visual-state area and snapshot timestamps |
| Wrong cooldown/charge/status visual | `status/`, then `ecs/` | numeric definitions and effect contracts in `gameconfig/` |
| Damage, shield, effect, or collision bug | `gameconfig/`, then `ecs/` | arena tick orchestration and server mirror |
| Projectile/trap/summon/entity behavior | `ecs/` | combat contracts and server `simulation/ecs/` |
| Action does not execute | `botlogic/code/`, `botlogic/planner/`, and `ecs/` | loadout action mapping and code selection |
| Condition/target sees wrong data | `modelPayloads/` | `botlogic/code/` and shape construction |
| Ability draft/loadout issue | `loadout/` | frontend and server matchmaking areas |
| Coding workspace or graph interaction | `coding/` | `botlogic/graph/`, code schema, and nearby toolbar tests |
| Testing loop/state coordination | `Arena.jsx` | focused system/helper and submission area |
| Replay-only mismatch | `../replay/` | `pixi/` mapping and server replay DTO area |

## Boundaries to preserve

- Gameplay systems produce state; Pixi reads and presents it. Rendering must not
  determine hits, damage, cooldown readiness, target selection, or match result.
- `modelPayloads/strategyStatePayload.js` is a logic contract, not a convenient
  view model. Coordinate/field changes require code and server parity review.
- Ability IDs and numeric tuning are mirrored by server `simulation/gameconfig/`.
  Entity lifecycle/effects are mirrored by server `simulation/ecs/` and
  `DuelSimulationService`.
- Keep fixed-step timing, arena units, collision geometry, rounding, effect
  order, loadout encoding, and seeded choices aligned across runtimes.
- Add presentation metadata to visual helpers/catalogs instead of branching on
  ability names throughout `pixi/PixiCanvas.jsx`.

## Relevant documentation

Read [`../../../docs/context.md`](../../../docs/context.md) before adding an
ability or changing effect/shield/entity semantics. For visual, timer, transform,
or simultaneous-effect work, run through the regression checklist indexed there.

## Tests

- `ecs/tests/EntitySystems.test.js`: action execution, entity lifecycle, combat/status
  interactions, and tick-order regressions.
- `pixi/snapshotInterpolation.test.js`: position interpolation math.
- `pixi/pixiVisualState.test.js`: renderer mapping and visual-state rules.
- `botlogic/code/tests/BotCode.test.js`: schema, conditions, targets, normalization, and
  deterministic selection.
- `ecs/tests/EntitySystems.test.js`: movement intent generation and execution.
- `coding/strategyToolbar.test.js`: coding workspace and graph source contracts.
- `status/abilityStatusPresentation.test.js`: status-panel source and timing contracts.

After focused tests, run `npm test`; for JSX/CSS/import changes also run lint and
build from `frontend/`.
