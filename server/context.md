# Server context

The Java 21 / Spring Boot 4 application owns authenticated state, matchmaking,
training deadlines, submission validation/persistence, and authoritative rated
simulation. Controllers should remain thin; business and ownership rules belong
in services.

## Layer map

All Java paths below are under
`src/main/java/com/example/botfight/`.

- `controller/`: REST and STOMP boundaries for auth, training sessions,
  submissions, time, coordinates, and matchmaking messages.
- `DTO/`: request/response and replay boundary shapes.
- `service/`: authentication, current-user lookup, FIFO matchmaking queue,
  active-match lifecycle, match chat/rate limits, connection state, match persistence, training
  sessions, submission normalization/validation/rate limiting/persistence, and
  match simulation orchestration. Keep queue pairing separate from active-match
  rounds, reconnect deadlines, and result persistence.
- `domain/`: JPA entities and persisted status/result enums.
- `repository/`: JPA queries. Ownership-sensitive access must include or verify
  the authenticated user and return generic not-found behavior for private data.
- `security/` and `config/`: session identity, Spring Security/CSRF, time, and
  WebSocket configuration.
- `simulation/DuelSimulationService.java`: authoritative `duel-v1` fixed-step
  logic evaluation, arena/combat state, result, and replay production.
- `simulation/combat/`: authoritative ability/move definitions, effect/shield
  contracts, rules, and catalog.
- `simulation/ecs/`: authoritative ability-entity model and systems.
- `src/main/resources/db/migration/`: append-only Flyway schema history.

## Route by task

| Concern | Start here | Also inspect |
| --- | --- | --- |
| Auth/session/CSRF | `controller/`, `service/`, `config/`, `security/` | auth tests and frontend auth/security areas |
| Matchmaking queue | matchmaking controller and queue service areas | matchmaking DTOs and frontend client area |
| Active match, reconnect, round draft, placement, surrender, match chat | match lifecycle, connection, and persistence service areas | matchmaking controller, DTOs, repositories, and frontend client area |
| Training deadline/session | training controller/service areas | domain/repository and submission binding |
| Submission endpoint/persistence | submission controller/service areas | DTO, repository, and domain areas |
| Brain/loadout boundary validation | validation service area | combat catalog, frontend schema, and focused tests |
| Rated simulation orchestration | simulation service areas | replay DTO and matchmaking lifecycle |
| Combat/ability/effect parity | `simulation/combat/`, `simulation/ecs/` | duel orchestration, frontend beta context, docs index |
| Replay/result mismatch | `simulation/`, `DTO/` | match orchestration/matchmaking and frontend replay areas |
| Database/schema | `domain/`, `repository/`, `resources/db/migration/` | services enforcing ownership/state transitions |

## Authority and validation rules

- Bind rated submissions to the authenticated user, active match, and
  server-issued training session.
- Normalize and bound schema versions, block/condition counts, priorities,
  identifiers, target/object slots, action/ability IDs, parameters, and payload
  lengths before persistence or simulation.
- Do not trust client results, seeds, timers, loadout eligibility, hashes, or
  replay claims. Preserve server seeds and enough metadata to reproduce a duel.
- Exact browser parity is desirable, but server behavior wins disagreements.
  Fix the browser mirror rather than accepting a client-reported result.
- Keep expensive audits asynchronous and state-changing routes protected and
  rate-limited where appropriate.

## Spring/Jackson conventions

This is Spring Boot 4 with Jackson 3. Use `tools.jackson.databind.*`, including
`JsonMapper`; do not introduce old `com.fasterxml.jackson.databind.ObjectMapper`
injection. Use DTOs at boundaries and entities only for persistence.

## Cross-runtime gameplay changes

Before changing abilities, moves, effects, shields, entities, targeting, brain
evaluation, units, or timing, read [`../docs/context.md`](../docs/context.md) and
[`../frontend/src/beta/context.md`](../frontend/src/beta/context.md). Trace both
runtimes and add parity-focused tests.

## Checks

From `server/` on Windows, run the narrowest test with Maven's `-Dtest=...`
selector, then `.\mvnw.cmd test` for contract or lifecycle changes. Relevant
suites are grouped under `src/test/java/com/example/botfight/service/`,
`simulation/`, and `simulation/combat/` or `simulation/ecs/`.

There is no active `server/package.json`; do not use the obsolete Node
simulation commands from older guidance.
