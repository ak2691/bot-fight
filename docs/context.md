# Documentation and audit context

Use this index to open only the document relevant to the task. Source code and
tests remain authoritative when a document is stale.

## Gameplay contract and implementation guides

- [`MATCH_TIMING.md`](MATCH_TIMING.md): authoritative server deadlines,
  Cristian clock conversion, and lifecycle countdown rules.
- [`ABILITY_EFFECT_CONTRACT.md`](ABILITY_EFFECT_CONTRACT.md): declarative
  delivery/effect/shield model and browser/server ownership. Read for effect
  semantics, shield behavior, presentation boundaries, or contract review.
- [`ADDING_AN_ABILITY_OR_MOVE.md`](ADDING_AN_ABILITY_OR_MOVE.md): end-to-end
  browser + server workflow and definition of done. Read first when adding or
  materially changing a move, ability, entity, targeting mode, or visual.
- [`ADDING_A_BACKEND_ABILITY_OR_MOVE.md`](ADDING_A_BACKEND_ABILITY_OR_MOVE.md):
  detailed authoritative catalog, validation, simulation, ECS, replay, and test
  checklist. Read for server implementation after the end-to-end guide.

## Audits and regression review

- [`ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`](ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md):
  recurring failures involving transform ownership, timer-driven visuals,
  accumulated combat state, statuses, and browser/server parity. Use for any
  arena visual, ability, move, entity, replay field, or fighter-state change.

For a code review or audit, pair the checklist with the affected runtime map:

- browser arena/Pixi: [`../frontend/src/beta/context.md`](../frontend/src/beta/context.md);
- server authority/security/persistence: [`../server/context.md`](../server/context.md);
- cross-boundary/API/logic: both runtime contexts plus root
  [`../context.md`](../context.md)'s end-to-end trace.

## Documentation maintenance

- [`MAINTAINING_CONTEXT_FILES.md`](MAINTAINING_CONTEXT_FILES.md): directory-first
  policy for changing routing maps as the repository grows. Read before adding,
  splitting, or substantially expanding any `context.md`.

- Keep context files as navigation, not duplicated specifications. Stable detail
  belongs in a focused document or next to the DTO/type that owns the contract.
- Update an existing guide when behavior changes; avoid parallel documents for
  the same contract.
- Add a new context layer only when a high-level area has multiple subsystems and
  agents otherwise need broad discovery. Do not add one for every directory.
- Keep each context file under 200 lines and use repository-relative links.
- If code, tests, and docs disagree, verify current behavior and update the stale
  documentation in the same change when it is in scope.
