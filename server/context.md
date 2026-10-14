# Server context

The Java 21 / Spring Boot 4 application owns authenticated state, matchmaking,
in-memory match deadlines, submission validation/history, and rated-match dispatch
to the Node sim worker (the worker is the simulation authority). Controllers should remain thin; business and ownership rules belong
in services.

## Layer map

All Java paths below are under
`src/main/java/com/example/botfight/`.

- `controller/`: REST and STOMP boundaries for auth, submissions, time, and
  matchmaking messages, notifications, duel/party invites, custom lobbies, and
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
  Within `match/`, keep `connection/`,
  `coordination/`, `event/`, `lifecycle/`, `phase/`, `chat/`, `loadout/`,
  `persistence/`, `replay/`, `resolution/`, `simulation/`, `state/`,
  `submission/`, and `timing/` focused on one active-match concern. Keep FIFO
  queue pairing in `matchmaking/` separate from active-match rounds, reconnect
  deadlines, simulation, and result persistence in `match/`.
- `domain/`: JPA entities and persisted status/result enums, grouped by owning
  area under `auth/`, `profile/`, `rating/`, `block/`, `puzzle/`, `party/`,
  `match/`, `submission/`, and `chatmoderation/`.
- `repository/`: JPA queries. Ownership-sensitive access must include or verify
  the authenticated user and return generic not-found behavior for private data.
- `security/` and `config/`: session identity, Spring Security/CSRF, time, and
  WebSocket configuration.
- `service/simulation/`: Spring's client for the Node sim worker. `SimWorkerClient` posts duel and puzzle
  requests to `POST /simulate` and validates the answer; `SimulationRequest` holds the request records.
- `simulation/` is no longer a runtime. The Java duel engine (`simulation/core/`,
  `simulation/ecs/`) was deleted; the Node sim worker is the only simulator. What
  remains is contract and catalog data that validation, puzzles, and the match
  flow still read:
  - `simulation/bots/`: `BotLogicContracts`, the brain schema and allowlisted
    condition/variable/action contracts.
  - `simulation/geometry/`: `ArenaCoordinates` and `ArenaUnits` coordinate and
    unit conversions.
  - `simulation/gameconfig/`: `AbilityContracts` (ability phase/effect contract
    registry), `AbilityRegistry`, `Abilities`, `GameConfig`, `GameConfigCatalog`,
    `ClosingZoneConfig`, and `CompactAbilityCode`.
- Worker replay wire shapes that Spring deserializes live under `DTO/match/`
  (`StatusEffectState`, `ArenaEntityStatus`, `MatchReplayDTO`, `MatchPlaybackDTO`).
- `src/main/resources/db/migration/`: append-only Flyway schema history.

## Route by task

| Concern | Start here | Also inspect |
| --- | --- | --- |
| Auth/session/CSRF | `controller/`, `service/`, `config/`, `security/` | auth tests and frontend auth/security areas |
| Duel invites, blocks, and notifications | invite/block/notification controllers and services, `domain/`, `repository/` | frontend notification/profile/matchmaking/chat areas |
| Chat reporting and moderation | chat report controllers, `service/chatmoderation/`, `domain/chatmoderation/`, and chat report repositories | match/custom-lobby chat send paths, frontend chat/admin UI, and [`../docs/CHAT_MODERATION.md`](../docs/CHAT_MODERATION.md) |
| Party membership and party invites | party controller/service areas, `domain/`, `repository/` | matchmaking queue page, notification transport, and live socket registry |
| Custom lobby creation, invites, teams, and party detachment | custom-lobby controllers/service and matchmaking lifecycle | DTOs, WebSocket security, party service, and frontend custom-lobby/notification areas |
| Matchmaking queue | matchmaking controller and queue service areas | matchmaking DTOs and frontend client area |
| Active match, reconnect, round draft, code-view snapshots, unanimous surrender, match chat | match lifecycle, connection, and persistence service areas | matchmaking controller, DTOs, repositories, and frontend client area |
| Building deadline/match timing | `service/match/timing/` | match state, matchmaking controller, and frontend lifecycle |
| Submission endpoint/persistence | submission controller/service areas | DTO, repository, and domain areas |
| Puzzle authoring, published list, and admin role boundary | puzzle controller/service areas | auth/security, puzzle domain/repository, migration, and frontend puzzle page |
| Brain/loadout boundary validation | validation service area | combat catalog, frontend schema, and focused tests |
| Rated simulation and puzzle attempts | `service/simulation/` (worker client, request types), `service/match/simulation/MatchSimulationService.java`, `service/puzzle/PuzzleAttemptService.java` | `DTO/match/MatchReplayDTO.java`, [`../sim-worker/README.md`](../sim-worker/README.md) |
| Ability/effect contract data (validation, puzzles) | `simulation/gameconfig/AbilityContracts.java`, `simulation/gameconfig/Abilities.java`, `simulation/bots/BotLogicContracts.java` | `shared/engine/` (the JS engine is the simulation truth), frontend Game Arena context, docs index |
| Replay/result mismatch | `DTO/match/MatchReplayDTO.java`, `service/simulation/SimWorkerClient.java`, `sim-worker/` | match orchestration/matchmaking and frontend replay areas |
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

## Simulation worker

Rated rounds and puzzle attempts run in `sim-worker/` (the JS engine). Spring sends `duel-v1` requests
with `X-Sim-Worker-Secret` and maps the reply to `WorkerResult`. A worker failure becomes the
`Bot simulation failed: ...` ERROR replay for matches and an exception for puzzles.

Config (`application.properties`): `sim.worker.url` (`SIM_WORKER_URL`, default `http://sim-worker:8090`),
`sim.worker.secret` (`SIM_WORKER_SECRET`, required, no default; startup fails when blank),
`sim.worker.timeout` (`SIM_WORKER_TIMEOUT`, 12s), `sim.worker.concurrency` (`SIM_WORKER_THREADS`, 2).

Running Spring outside Docker (`spring-boot:run`) needs the worker on the host:

```powershell
$env:SIM_WORKER_URL = 'http://localhost:8090'
$env:SIM_WORKER_SECRET = '<same secret as the worker>'
# in another shell, from the repository root:
cd sim-worker; $env:SIM_WORKER_SECRET = '<same secret>'; npm start
```

The worker reads `PORT` and defaults to 8090, so set `PORT` only when you change it. Tests use
`support/WorkerStub` or a mocked `SimWorkerClient`; no test needs a running worker or a secret.

## Checks

From `server/` on Windows, run the narrowest test with Maven's `-Dtest=...`
selector, then `.\mvnw.cmd test` for contract or lifecycle changes. Relevant
suites are grouped under `src/test/java/com/example/botfight/service/`,
`simulation/bots/`, `simulation/gameconfig/`, and `simulation/geometry/`.

There is no active `server/package.json`; do not use the obsolete Node
simulation commands from older guidance.
