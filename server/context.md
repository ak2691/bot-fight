# Server context

The Java 21 / Spring Boot 4 application owns authenticated state, matchmaking,
in-memory match deadlines, submission validation/history, and authoritative rated
result orchestration through the mandatory Node simulation worker. Controllers should remain thin; business and ownership rules belong
in services.

## Layer map

All Java paths below are under
`src/main/java/com/example/botfight/`.

- `controller/`: REST and STOMP boundaries for auth, submissions, time, and
  matchmaking messages, notifications, party invites, custom lobbies, and
  chat reports/admin moderation.
- `DTO/`: request/response and replay boundary shapes, grouped by boundary area
  under `auth/`, `profile/`, `block/`, `submission/`, `puzzle/`, `party/`,
  `customlobby/`, `match/`, `notification/`, and `chatmoderation/`.
- `service/`: business services grouped by responsibility: `auth/`,
  `submission/`, `limits/`, `matchmaking/`, `match/`, `profile/`, `rating/`,
  `puzzle/`, `invite/`, `party/`, `customlobby/`, `block/`, `notification/`,
  `chatmoderation/`, `websocket/`, and `system/`. Party membership and
  custom-lobby rosters are transient socket-bound runtime state; they are not
  persisted match roster sources. Chat report authorization, evidence
  retention, and moderator actions belong to `chatmoderation/`. Puzzle
  authoring/listing owns admin validation, puzzle persistence, and the public
  published-list contract.
  Shared bounded database read-model caching and write invalidation lives in
  `cache/`; cache DTO/read-model snapshots rather than managed JPA entities.
  Within `match/`, constructor-injected workflow services share the indexed
  session store in `state/`; immutable session/player carriers live in `model/`.
  Socket presence lives in `connection/`, and snapshots/fan-out in `event/`.
  Keep FIFO queue pairing in `matchmaking/` separate from active-match rounds,
  reconnect deadlines, simulation, and result persistence in `match/`.
  Match services schedule authoritative deadlines and simulation through the
  match scheduler. The event publisher owns socket fan-out and delayed replay
  delivery; controllers do not infer work from outgoing payloads.
- `domain/`: JPA entities and persisted status/result enums, grouped by owning
  area under `auth/`, `profile/`, `rating/`, `block/`, `puzzle/`,
  `match/`, `submission/`, and `chatmoderation/`.
- `repository/`: JPA queries. Ownership-sensitive access must include or verify
  the authenticated user and return generic not-found behavior for private data.
- `security/` and `config/`: session identity, Spring Security/CSRF, time, and
  WebSocket configuration.
- `service/simulation/`: authenticated RestClient worker transport, timeouts,
  bounded synchronous admission, request DTOs, engine-version metrics and raw
  replay envelopes. There is no Java execution, shadow mode or rollback.
- `simulation/gameconfig/`: `AbilityCatalog` (ability IDs, standard abilities and loadout codes read
  from `shared/gameplay/abilities.json`) and the zone schedule needed by socket presentation.
- `simulation/geometry/`: coordinate conversion and arena bounds for puzzle
  authoring and request construction. Collision and combat geometry live in
  `../shared/engine/` only.
- `src/main/resources/db/migration/`: append-only Flyway schema history.

## Route by task

| Concern | Start here | Also inspect |
| --- | --- | --- |
| Auth/session/CSRF | `controller/`, `service/`, `config/`, `security/` | auth tests and frontend auth/security areas |
| Blocks and notifications | invite/block/notification controllers and services, `domain/`, `repository/` | frontend notification/profile/matchmaking/chat areas |
| Chat reporting and moderation | chat report controllers, `service/chatmoderation/`, `domain/chatmoderation/`, and chat report repositories | match/custom-lobby chat send paths, frontend chat/admin UI, and [`../docs/CHAT_MODERATION.md`](../docs/CHAT_MODERATION.md) |
| Party membership and party invites | party controller and `service/party/` runtime carriers | matchmaking queue page, notification transport, and live socket registry |
| Custom lobby creation, invites, teams, and party detachment | custom-lobby controllers/service and matchmaking lifecycle | DTOs, WebSocket security, party service, and frontend custom-lobby/notification areas |
| Matchmaking queue | matchmaking controller and queue service areas | matchmaking DTOs and frontend client area |
| Active match, reconnect, round draft, code-view snapshots, unanimous surrender, match chat | match lifecycle, connection, and persistence service areas | matchmaking controller, DTOs, repositories, and frontend client area |
| Building deadline/match timing | `service/match/` and the scheduler in `service/match/` | match state, event publisher, and frontend lifecycle |
| Submission endpoint/persistence | submission controller/service areas | DTO, repository, and domain areas |
| Puzzle authoring, published list, and admin role boundary | puzzle controller/service areas | auth/security, puzzle domain/repository, migration, and frontend puzzle page |
| Brain/loadout boundary validation | `service/submission/` (`BrainSchemaValidator`, `BotSubmissionValidationService`, `SubmissionJsonReader`), `../shared/schemas/brain.schema.json` | combat catalog, frontend `botlogic/code/configuration/`, `../shared/brain-tests/`, and focused tests |
| Rated simulation orchestration | `service/match/`, `service/simulation/` | worker request/result schemas, match lifecycle and shared engine |
| Combat/ability/effect behavior | `../shared/engine/` | engine context, worker tests and docs index |
| Replay/result mismatch | `service/simulation/`, `service/match/`, `DTO/match/` | worker batches, match orchestration and frontend replay areas |
| Database/schema | `domain/`, `repository/`, `resources/db/migration/` | services enforcing ownership/state transitions |

## Authority and validation rules

- A submitted brain is checked in two layers, and neither is Java code. `shared/schemas/brain.schema.json`
  (loaded once by `BrainSchemaValidator` with networknt) owns types, closed lists, bounds and which fields each
  condition and action may carry. On a schema-valid brain, `BotSubmissionValidationService` asks the worker
  (`SimWorkerClient.validateBrain`, `POST /validate`) for the brain rules (depth, totals, sibling order,
  references), which the shared engine implements once in `brainRules.js`. Do not re-implement either in
  Java. Spring keeps the request fields and variable resets. The endpoint reads its body through
  `SubmissionJsonReader`, which caps JSON nesting. `BrainFixturesTest` and `SimulationSchemasTest` cover the
  shared fixtures and the simulator request/response schemas. Puzzle outcome rules are only
  `logicConfiguration` (roots of kind win, lose, modify), checked the same way with `puzzleRules: true`.
  Authored puzzle bot budgets and the reserved puzzle namespace are also checked by
  the worker using the shared slot metrics; Spring keeps the surrounding puzzle fields
  and catalog-backed loadout decoding.

- Bind match submissions to the authenticated user, active match, server-owned
  round, and canonical phase. During a live match, the
  `matchId/round/phase/userId` key is authoritative in memory under the match
  lock; copy accepted round code to history storage only when the match ends.
- Normalize and bound schema versions, block/condition counts, priorities,
  identifiers, target/object slots, action/ability IDs, parameters, and payload
  lengths before persistence or simulation.
- Do not trust client results, seeds, timers, loadout eligibility, hashes, or
  replay claims. Preserve server seeds and enough metadata to reproduce a duel.
- Spring accepts results only from the authenticated worker. Browser previews
  use the same shared engine but cannot report authoritative results.
- Keep expensive audits asynchronous and state-changing routes protected and
  rate-limited where appropriate.

## Spring/Jackson conventions

This is Spring Boot 4 with Jackson 3. Use `tools.jackson.databind.*`, including
`JsonMapper`; do not introduce old `com.fasterxml.jackson.databind.ObjectMapper`
injection. Use DTOs at boundaries and entities only for persistence.

## Gameplay changes

Read [`../docs/ABILITIES.md`](../docs/ABILITIES.md) and
[`../shared/engine/context.md`](../shared/engine/context.md). Change execution
once in the shared engine. Java changes are limited to validation, transport,
match orchestration and presentation metadata; trace the schema end to end.

## Checks

From `server/` on Windows, run the narrowest test with Maven's `-Dtest=...`
selector, then `.\mvnw.cmd test` for contract or lifecycle changes. Relevant
suites are grouped under `src/test/java/com/example/botfight/service/` and
`simulation/gameconfig/`.

Worker-boundary suites cover authenticated requests, capacity/timeouts,
malformed responses, puzzle solve recording and raw replay authorization.
Combat golden tests live in frontend and sim-worker and use the shared engine.

There is no active `server/package.json`; do not use the obsolete Node
simulation commands from older guidance.
