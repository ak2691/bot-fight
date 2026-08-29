# Server context

The Java 21 / Spring Boot 4 application owns authenticated state, matchmaking,
in-memory match deadlines, submission validation/history, and authoritative rated
simulation. Controllers should remain thin; business and ownership rules belong
in services.

## Layer map

All Java paths below are under
`src/main/java/com/example/botfight/`.

- `controller/`: REST and STOMP boundaries for auth, submissions, time, and
  matchmaking messages, notifications, duel/party invites, and custom lobbies.
- `DTO/`: request/response and replay boundary shapes.
- `service/`: business services grouped by responsibility: `auth/`,
  `submission/`, `limits/`, `matchmaking/`, `match/`, `profile/`, `rating/`,
  `puzzle/`, `invite/`, `party/`, `customlobby/`, `block/`, `notification/`, `websocket/`, and `system/`. Party membership and custom-lobby rosters are transient socket-bound runtime state; they are not persisted match roster sources. Puzzle authoring/listing owns admin
  validation, puzzle persistence, and the public published-list contract.
  Shared bounded database read-model caching and write invalidation lives in
  `cache/`; cache DTO/read-model snapshots rather than managed JPA entities.
  Within `match/`, keep `connection/`,
  `coordination/`, `event/`, `lifecycle/`, `phase/`, `chat/`, `loadout/`,
  `persistence/`, `replay/`, `resolution/`, `simulation/`, `state/`,
  `submission/`, and `timing/` focused on one active-match concern. Keep FIFO
  queue pairing in `matchmaking/` separate from active-match rounds, reconnect
  deadlines, simulation, and result persistence in `match/`.
- `domain/`: JPA entities and persisted status/result enums.
- `repository/`: JPA queries. Ownership-sensitive access must include or verify
  the authenticated user and return generic not-found behavior for private data.
- `security/` and `config/`: session identity, Spring Security/CSRF, time, and
  WebSocket configuration.
- `simulation/core/`: the package-coupled authoritative duel runtime, organized
  by role into `orchestration/` (fixed-step duel flow), `logic/`
  (conditions, targeting, and custom-variable actions), `combat/`
  (actions, abilities, projectiles, and entity hits), `state/` (bot state,
  movement, and deferred transitions), and `replay/` (authoritative replay
  mapping). The role packages communicate through explicit authoritative types
  owned by the orchestration package.
- `simulation/bots/`: submitted bot configuration reading, the declarative
  bot-code contract registry, and normalized condition evaluation.
- `simulation/geometry/`: pure authoritative distance, angle, and arena-unit
  calculations.
- `simulation/gameconfig/`: authoritative ability definitions, effect/shield
  contracts, and the active duel configuration.
- `simulation/ecs/`: authoritative ability-entity model, split into
  `contracts/`, `abilities/`, and `entities/`.
- `src/main/resources/db/migration/`: append-only Flyway schema history.

## Route by task

| Concern | Start here | Also inspect |
| --- | --- | --- |
| Auth/session/CSRF | `controller/`, `service/`, `config/`, `security/` | auth tests and frontend auth/security areas |
| Duel invites, blocks, and notifications | invite/block/notification controllers and services, `domain/`, `repository/` | frontend notification/profile/matchmaking/chat areas |
| Party membership and party invites | party controller/service areas, `domain/`, `repository/` | matchmaking queue page, notification transport, and live socket registry |
| Custom lobby creation, invites, teams, and party detachment | custom-lobby controllers/service and matchmaking lifecycle | DTOs, WebSocket security, party service, and frontend custom-lobby/notification areas |
| Matchmaking queue | matchmaking controller and queue service areas | matchmaking DTOs and frontend client area |
| Active match, reconnect, round draft, code-view snapshots, unanimous surrender, match chat | match lifecycle, connection, and persistence service areas | matchmaking controller, DTOs, repositories, and frontend client area |
| Building deadline/match timing | `service/match/timing/` | match state, matchmaking controller, and frontend lifecycle |
| Submission endpoint/persistence | submission controller/service areas | DTO, repository, and domain areas |
| Puzzle authoring, published list, and admin role boundary | puzzle controller/service areas | auth/security, puzzle domain/repository, migration, and frontend puzzle page |
| Brain/loadout boundary validation | validation service area | combat catalog, frontend schema, and focused tests |
| Rated simulation orchestration | `simulation/core/orchestration/DuelSimulationService.java` | replay DTO and matchmaking lifecycle |
| Combat/ability/effect parity | `simulation/gameconfig/`, `simulation/core/combat/`, `simulation/core/logic/`, `simulation/core/state/`, `simulation/ecs/` | duel orchestration, frontend Game Arena context, docs index |
| Replay/result mismatch | `simulation/core/replay/`, `DTO/` | match orchestration/matchmaking and frontend replay areas |
| Database/schema | `domain/`, `repository/`, `resources/db/migration/` | services enforcing ownership/state transitions |

## Authority and validation rules

- Bind match submissions to the authenticated user, active match, server-owned
  round, and canonical phase. During a live match, the
  `matchId/round/phase/userId` key is authoritative in memory under the match
  lock; copy accepted round code to history storage only when the match ends.
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

Before changing abilities, effects, shields, entities, targeting, brain
evaluation, units, or timing, read [`../docs/context.md`](../docs/context.md) and
[`../frontend/src/gameArena/context.md`](../frontend/src/gameArena/context.md). Trace both
runtimes and add parity-focused tests.

## Checks

From `server/` on Windows, run the narrowest test with Maven's `-Dtest=...`
selector, then `.\mvnw.cmd test` for contract or lifecycle changes. Relevant
suites are grouped under `src/test/java/com/example/botfight/service/`,
`simulation/`, and `simulation/gameconfig/` or `simulation/ecs/`.

There is no active `server/package.json`; do not use the obsolete Node
simulation commands from older guidance.
