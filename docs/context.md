# Documentation index

Open only the document relevant to the task. Source code and tests win when a
document is stale.

## Gameplay

- [`ABILITIES.md`](ABILITIES.md): abilities, weapons, Dash and stamina,
  contracts and phases, effects and statuses, entities, the tick order, the
  combat log and golden scenarios, visuals, and how to add or tune an ability in
  the shared engine and Spring validation.
- [`ENGINE_PRIMER.md`](ENGINE_PRIMER.md): how the engine works, step by step (the tick,
  hits, entities, statuses and reactions), with worked ability examples.
- [`ROSTER_DESIGN.md`](ROSTER_DESIGN.md): the ability roster (built 2026-10-12): per-tier
  balance frame, each ability's job and numbers, the combo and counter check, and open questions.
- [`SOLVED_MATCHUPS.md`](SOLVED_MATCHUPS.md): 2026-10-11 summary of the
  solved-matchup problem, the agreed criteria and direction, and the rejected
  ideas. Read before proposing match-design changes.
- [`ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md):
  recurring visual, timer and same-tick combat failures. Use for any ability,
  entity, replay field or bot-state change, and for reviews.
- [`PLAYER_COORDINATES.md`](PLAYER_COORDINATES.md): public centered/Y-up
  coordinates versus internal ones.
- [`CODE_WORKSPACE_REDESIGN.md`](CODE_WORKSPACE_REDESIGN.md): how the brain editor works today (execution order, nodes, panels, toolbar).
- [`LANES.md`](LANES.md): the lanes programming model, the starting point for the
  next visual programming style (ordered cards per lane, modes, defaults). Not built.

## Match format and timing

- [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md): the six-round
  format design and its rationale.
- [`FIXED_KIT_FORMAT.md`](FIXED_KIT_FORMAT.md): 2026-10-10 proposal amending
  it: fixed kits (weapon + one ability per tier), alternating unlock and gap
  rounds, saved brains and snippets. Server and engine parts built; client UI not.
- [`MATCH_TIMING.md`](MATCH_TIMING.md): server deadlines, client clock
  conversion, and the round-transition checklist.

## Server and security

- [`CHAT_MODERATION.md`](CHAT_MODERATION.md): chat evidence, report
  authorization, retention and the admin review contract.

## Maintaining docs

- [`MAINTAINING_CONTEXT_FILES.md`](MAINTAINING_CONTEXT_FILES.md): when and how
  to change the `context.md` routing maps.
- Update the existing guide when behavior changes; do not add a parallel
  document for the same contract. Keep context files under 200 lines.
