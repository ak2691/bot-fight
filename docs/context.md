# Documentation index

Open only the document relevant to the task. Source code and tests win when a
document is stale.

## Gameplay

- [`ABILITIES.md`](ABILITIES.md): abilities, weapons, Dash and stamina,
  contracts and phases, effects and statuses, entities, the tick order, the
  combat log and golden scenarios, visuals, and how to add or tune an ability in
  the shared engine and Spring validation.
- [`ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md):
  recurring visual, timer and same-tick combat failures. Use for any ability,
  entity, replay field or bot-state change, and for reviews.
- [`PLAYER_COORDINATES.md`](PLAYER_COORDINATES.md): public centered/Y-up
  coordinates versus internal ones.
- [`CODE_WORKSPACE_REDESIGN.md`](CODE_WORKSPACE_REDESIGN.md): how the brain and
  chain editors work (execution order, nodes, panels, chains, toolbar).

## Match format and timing

- [`design/README.md`](design/README.md): the planned MVP design (nothing built yet):
  programmable BattleBots-style bots built from parts, a physics engine, the modes-and-rules
  brain, weekly cups and daily gauntlets. Start at its README; one doc per area.
- [`GAMEPLAY_OVERHAUL_MIGRATION.md`](GAMEPLAY_OVERHAUL_MIGRATION.md): what each
  current area keeps, replaces or removes for that design, and the phase order.
- [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md): the six-round
  format design and its rationale.
- [`FIXED_KIT_FORMAT.md`](FIXED_KIT_FORMAT.md): 2026-10-10 proposal amending
  it: fixed kits (weapon + one ability per tier), alternating unlock and gap
  rounds, saved brains and snippets. Not built.
- [`MATCH_TIMING.md`](MATCH_TIMING.md): server deadlines, client clock
  conversion, and the round-transition checklist.

## Server and security

- [`CHAT_MODERATION.md`](CHAT_MODERATION.md): chat evidence, report
  authorization, retention and the admin review contract.
- [`SPRING_CLEANUP_PROMPTS.md`](SPRING_CLEANUP_PROMPTS.md): the 2026-10-09
  server audit and the queued Sonnet cleanup runs (A, B, C). Read it before
  refactoring match, matchmaking, party or puzzle services.

## Explorations

- [`realtime-mode/`](realtime-mode/README.md): 2026-10-10 exploration of a
  real-time mode ("Hotfix") in which players patch their crew's brain during
  the match. Nothing decided or built.

## Maintaining docs

- [`MAINTAINING_CONTEXT_FILES.md`](MAINTAINING_CONTEXT_FILES.md): when and how
  to change the `context.md` routing maps.
- Update the existing guide when behavior changes; do not add a parallel
  document for the same contract. Keep context files under 200 lines.
