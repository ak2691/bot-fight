# Botfight agent guide

## Required context routing

Before exploring code, read [`context.md`](context.md). It is the repository map
and routes each task to the smallest useful area context.

1. Classify the request using the routing table in `context.md`.
2. Read only the routed area context files, then search within the named owning
   directories and inspect nearby tests.
3. Use targeted `rg`/`rg --files` queries. Do not recursively inventory the
   repository or read unrelated root files for background.
4. Exclude generated or vendored content: `.git/`, `node_modules/`, `dist/`,
   `target/`, logs, caches, and `artifacts/` unless the request names an artifact.
5. If a change moves responsibilities or adds a major subsystem, follow
   [`docs/MAINTAINING_CONTEXT_FILES.md`](docs/MAINTAINING_CONTEXT_FILES.md).
   Ordinary new files do not require context-map entries. Keep every context
   file below 200 lines.

Context files are navigation aids, not substitutes for source verification.
Confirm current symbols and contracts in code before changing behavior.

## Always-on product constraints

- Botfight is a competitive deterministic-logic fighting game. A normalized,
  allowlisted logic-block configuration is the submitted brain; never execute
  arbitrary user code or expression text.
- Rated outcomes come from authoritative deterministic server simulation.
  Browser training and rendering are previews, not match authority. A timeout
  is a draw; a win requires defeating the opponent through HP damage.
- Treat client submissions, identifiers, hashes, logs, and claimed outcomes as
  hostile input. Validate and bound them at server boundaries and enforce row
  ownership with the authenticated user.
- Preserve deterministic seeds and replay/audit data when changing simulation.
- Keep browser and server gameplay contracts in parity when abilities, logic,
  timing, units, or payloads change.

## Working rules

- Respect tracked and untracked user work; avoid unrelated rewrites.
- Prefer small, testable changes and run the narrowest relevant checks first.
- Keep path casing Linux-safe and never commit secrets or generated artifacts.
- Explain changes to logic contracts, match authority, validation, persistence,
  ratings, or anti-cheat behavior.
