# Documentation index

Open only the document relevant to the task. Source code and tests win when a
document is stale.

## Gameplay

- [`ABILITIES.md`](ABILITIES.md): abilities, weapons, Dash and stamina,
  contracts and phases, effects and statuses, entities, the tick order, the
  combat log and golden scenarios, visuals, and how to add or tune an ability in
  both runtimes.
- [`ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md):
  recurring visual, timer and same-tick combat failures. Use for any ability,
  entity, replay field or bot-state change, and for reviews.
- [`ONE_ENGINE_PLAN.md`](ONE_ENGINE_PLAN.md): later proposal to run one
  simulation engine on both server and browser.
- [`PLAYER_COORDINATES_AND_BRAIN_VERSIONS.md`](PLAYER_COORDINATES_AND_BRAIN_VERSIONS.md):
  public centered/Y-up coordinates versus internal ones, and brain schema
  versions v1/v2.
- [`CODE_WORKSPACE_REDESIGN.md`](CODE_WORKSPACE_REDESIGN.md): how the brain and
  chain editors work (execution order, nodes, panels, chains, toolbar).

## Match format and timing

- [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md): the six-round
  format design and its rationale.
- [`TIMED_ROUNDS_IMPLEMENTATION_PLAN.md`](TIMED_ROUNDS_IMPLEMENTATION_PLAN.md):
  locked decisions, remaining work (P5, P6, S7) and their Sonnet prompts.
- [`MATCH_TIMING.md`](MATCH_TIMING.md): server deadlines, client clock
  conversion, and the round-transition checklist.

## Server, security and legacy

- [`CHAT_MODERATION.md`](CHAT_MODERATION.md): chat evidence, report
  authorization, retention and the admin review contract.
- [`LEGACY_PATH_DECISIONS.md`](LEGACY_PATH_DECISIONS.md): evidence required
  before removing legacy party persistence or replay recorders.

## Maintaining docs

- [`MAINTAINING_CONTEXT_FILES.md`](MAINTAINING_CONTEXT_FILES.md): when and how
  to change the `context.md` routing maps.
- Update the existing guide when behavior changes; do not add a parallel
  document for the same contract. Keep context files under 200 lines.
