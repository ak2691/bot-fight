# Game Arena context

The simulation core (`ecs/`, `gameconfig/`, `loadout/BotLoadout.js`, `botlogic/code` and `planner`, the
bot format and state payload in `modelPayloads/`, and the fight itself) now lives in
[`../../../shared/engine/`](../../../shared/engine/context.md); paths below that name those areas are
relative to it. What stays here is the editor, Pixi, hooks, and the tests.

This area is the browser testing/runtime preview and presentation surface. It
previews the shared engine for player feedback; Spring decides rated results through
the authenticated Node worker.

## Ownership map

- `Arena.jsx`: testing-room state, mode coordination, logic action application,
  submission coordination, state snapshots, and live-match code-view responders
  plus editable sandbox copies. The preview simulation loop is owned by
  `hooks/`.
- `hooks/`: browser preview simulation-loop and mode hooks. `useArenaAutoPlay.js`
  owns fixed-step preview ticks: it keeps the running fight (`createFight`, in
  `shared/engine/fight.js`) in a ref and sets `fight.frame()` as
  the React shapes; shapes that did not come from its frames restart the fight.
- `coding/CodingPanel.jsx`: coding workspace composition root, toolbar,
  history, modal coordination, outer workspace layout, and read-only live
  participant snapshots.
- `coding/lanes/`: the lanes brain editor (three sections Movement, Actions, Variables; list UI, the shared menu shell with the condition and card menus, the inline condition and action editors, attached movement, the ability details popover, pure edit ops, menu models, aim defaults, live highlight sets, starter, summaries); `coding/LogicBoard.jsx` is the legacy tree canvas, mounted only by the puzzle win/lose rules editor (`pages/puzzles/PuzzleLogicWorkspace.jsx`).
- `coding/LogicBoard.jsx`: graph canvas interaction, node positioning, branch
  edits, selection, and search integration.
- `coding/nodes/GraphNodes.jsx`: graph layout, condition/action node rendering,
  inspectors, operand editors, and shared coding controls.
- `coding/controls/`: priority and toolbar icon controls used by the coding UI.
- `coding/modals/`: custom-variable and root-search modal implementations.
- `coding/utils/`: coding-menu coordination and custom-variable search helpers.
- `status/`: player-facing cooldown, charge, and ability-status presentation.
- `pixi/PixiCanvas.jsx` + `pixi/PixiCanvas.css`: Pixi scene lifecycle, layers,
  sprites, arena/entity rendering, and dispatch to the bot ability renderers.
  `pixi/botAbilityPresentationDefinitions.js` maps each ability visual `type`
  (from `abilities.json`) to presentation-only renderer settings;
  `pixi/renderers/<type>.js` holds one `{ create, update, destroy }` renderer per
  type (registry and dispatch in `renderers/index.js`, Pixi access through
  `pixiToolkit.js`, pure helpers in `rendererHelpers.js`).
- `loadout/BotLoadout.js`: ability catalog metadata, round pools, loadout
  normalization/encoding, action mapping, and visual capabilities.
- `botlogic/code/`: structured bot-code contract with `BotCode.js` as the public
  entry point and helpers split into `configuration/`, `runtime/`, and `tests/`.
- `modelPayloads/`: arena units/constants, shape construction, and the logic
  feature/state snapshot contract. `botState.js` is the one bot format:
  `createBotState` builds a flat bot with every field present and `kind: "bot"`;
  `isBotState` is the only bot check. Build bots with it, never as loose objects.
- `gameconfig/`: browser numeric definitions, geometry, defensive rules, bot
  combat, and visual timers. `gameplayData.js` loads and freezes the shared
  `shared/gameplay/*.json` (checked by `gameplayValidation.js`); `Abilities.js`,
  `AbilityRegistry.js`, `MovementConfig.js` and `ecs/contracts/AbilityContracts.js`
  read from it. `AbilityState.js` holds the per-bot `abilityState[abilityId]`
  records (stage, remaining time, charges, reload, wind-up target) and the
  channel-busy helpers; `AbilityChannels.js` reads each ability's channel and
  stamina cost and the channels' blocking statuses; `AbilityResourceSystem.js`
  changes the records (cooldown, charges, interrupt, `readyInMs`).
- `ecs/`: deterministic arena execution organized into `contracts/`, `bots/`,
  `abilities/`, and `entities/`; `ecs/contracts/AbilityContracts.js` is the
  canonical normalized registry for direct and spawned abilities. See
  `ecs/context.md` for ownership and boundaries.
- `pixi/`: renderer-only texture caching, snapshot interpolation, and mapping
  gameplay shapes/state to Pixi layers/captions/visual state.

## Route by symptom

| Symptom/change | Start here | Then check |
| --- | --- | --- |
| Pixi object missing, wrong layer/caption/texture | `pixi/` | shape producer and visual regression checklist |
| Jitter, teleport smear, rotation/interpolation bug | `pixi/` | combat visual-state area and snapshot timestamps |
| Wrong cooldown/charge/status visual | `status/`, then `ecs/` | numeric definitions and effect contracts in `gameconfig/` |
| Damage, effect, or collision bug | `gameconfig/`, then `ecs/` | shared engine tick orchestration |
| Projectile/trap/summon/entity behavior | `ecs/` | combat contracts and shared engine execution |
| Action does not execute | `botlogic/code/`, `botlogic/planner/`, and `ecs/` | loadout action mapping and code selection |
| Condition/target sees wrong data | `modelPayloads/` | `botlogic/code/` and shape construction |
| Ability draft/loadout issue | `loadout/` | frontend and server matchmaking areas |
| Coding workspace or graph interaction | `coding/` | code schema, and nearby toolbar tests |
| Testing loop/state coordination | `Arena.jsx` | focused system/helper and submission area |
| Replay-only mismatch | `../replay/` | `pixi/` mapping and server replay DTO area |

## Boundaries to preserve

- Gameplay systems produce state; Pixi reads and presents it. Rendering must not
  determine hits, damage, cooldown readiness, target selection, or match result.
- `modelPayloads/strategyStatePayload.js` is a logic contract, not a convenient
  view model. Coordinate/field changes require shared schema and consumer review.
- Ability lifecycle, effects, fixed-step timing, collision geometry, rounding
  and brain execution belong to `shared/engine/`, used by previews and worker.
  Spring keeps submission allowlists and metadata from shared gameplay data.
- Keep ability-specific drawing in `pixi/renderers/<type>.js`, keyed by visual
  type; settings may choose colours, assets, and timing but cannot affect
  gameplay outcomes. Renderers use state and contract numbers only (no
  `Math.random`) and reach Pixi through `ctx.kit`.

## Relevant documentation

Read [`../../../docs/ABILITIES.md`](../../../docs/ABILITIES.md) before adding an
ability or changing effect/entity/stamina semantics. For visual, timer, transform,
or simultaneous-effect work, run through the regression checklist indexed there.

## Tests

- `ecs/tests/EntitySystems.test.js`: action execution, entity lifecycle, combat/status
  interactions, and tick-order regressions.
- `pixi/snapshotInterpolation.test.js`: position interpolation math.
- `pixi/pixiVisualState.test.js`: renderer mapping and visual-state rules.
- `pixi/botAbilityPresentationDefinitions.test.js`, `pixi/renderers/botAbilityRenderers.test.js`:
  type-keyed settings, one renderer per type, dispatch rules, and renderer behaviour
  against a fake kit.
- `botlogic/code/tests/BotCode.test.js`: schema, conditions, targets, normalization, and
  deterministic selection.
- `testing/fightTick.js` (`advanceShapes`: one tick of a fresh fight, state in and
  out) and `testing/pureTicks.js` (copy-wrapped systems) are the test helpers for the
  in-place engine.
- `testing/goldenScenarios.test.js`: shared engine golden scenarios
  (`goldenScenarioRunner.js` runs them; `npm run golden:update` rewrites the
  golden). Worker tests execute the same scenarios against that golden.
- `ecs/tests/MovementStamina.test.js`, `DashChannel.test.js`, `StaminaRefund.test.js`:
  movement, Dash and stamina. `ecs/tests/AbilityChannels.test.js`: channel
  independence. Fixtures build
  `abilityState` records directly (`{ 3: { stage: "active", remainingMs: 200 } }`).
- `coding/strategyToolbar.test.js`: coding workspace and graph source contracts.
- `status/abilityStatusPresentation.test.js`: status-panel source and timing contracts.

After focused tests, run `npm test`; for JSX/CSS/import changes also run lint and
build from `frontend/`.
