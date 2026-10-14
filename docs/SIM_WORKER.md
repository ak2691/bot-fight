# Simulation worker (branch workspace-ui-port)

Goal: rated matches and puzzle attempts run on the browser's JS engine inside a Node worker. Spring stops
simulating. The JS engine is the source of truth; the Java simulation is deleted, not ported.

Out of scope: chains, new abilities, stamina, shared actions, round-format changes, brain validation (Java
`BotSubmissionValidationService` keeps validating brains), any gameplay change.

## Layout

- `shared/engine/` - the browser engine, moved from `frontend/src/gameArena/` with the same sub-paths
  (`botlogic/`, `ecs/`, `gameconfig/`, `loadout/BotLoadout.js`, `modelPayloads/`). The browser and the worker
  import the same files. No React, Pixi or DOM in `shared/engine`.
- `shared/engine/match/` - worker-only orchestration: `simulateMatch.js`, `replayMapping.js`,
  `puzzleOutcome.js`, `botSetup.js`, tests in `shared/engine/match/tests/`.
- `sim-worker/` - HTTP service (Piscina thread pool), copied from `archive/match-round-overhaul-2026-10-13`
  commit `8d46135`, minus `/validate`, ajv and schemas.
- Spring: `service/simulation/SimWorkerClient.java` + `SimulationRequest.java`.

## Tick

`advanceArenaPreviewTick` is split into a core `advanceArenaTick(prevShapes, options)` in
`modelPayloads/arenaTick.js`, and the browser wrapper. The wrapper keeps today's preview rules exactly:
"main" always runs its brain, other bots run only with ability actions, and the clock is read from "main".
The worker runs every bot's brain and passes the match clock.

Worker loop order follows today's Java `DuelSimulationService.simulate`: `elapsedMs` runs from 100 to
`durationMs` in 100 ms steps (`AUTO_STEP_MS`); record a frame; run the puzzle check; stop when at most one
team has a living bot. The winner is the first living bot of the surviving team in request order. No team
alive, or time out, gives a draw (`"DRAW"`, no winner).

## Request (Spring -> worker, `POST /simulate`)

Same JSON as today's Java `DuelSimulationRequest`, plus an optional `puzzle`:

```text
{ matchId, rulesetVersion: "duel-v1", seed: "<string>",
  arena: { width, height, durationMs, initialElapsedMs },
  bots: [{ userId, username, slot, x, y, rotation, size, selectedLoadout, brain, initialHp|null, teamNumber }],
  puzzle?: { logicConfiguration, winConditions, loseConditions, timeLimitMs, initialElapsedMs } }
```

The roster rules match Java `validateBotRoster`: 2-8 bots, unique slots 1-8, positive team numbers, at least
two teams. `initialElapsedMs + durationMs` must stay within the closing-zone simulation length. Errors give
400 `INVALID_SIMULATION`.

## Response

```text
{ engineVersion, replay: <MatchReplayDTO JSON: initialState, frames, result, winnerUserId, message>,
  puzzle?: { status: "solved"|"failed", elapsedMs } }
```

- The replay fields, names, omission and rounding match Java `ReplayMappingService` + `MatchReplayDTO`
  exactly. The frontend replay player must not change.
- `result` is `"BOT_WIN"` or `"DRAW"`. The message is `"<Blue|Red|Team N> wins."` or
  `"The fight ended in a draw."`, the same as Java.
- Puzzle requests skip frames (`frames: []`). The puzzle rules port `PuzzleOutcomeEvaluator.java`
  (logic-configuration rules, legacy flat conditions, `custom.puzzle.*` variables, time limit), using the
  JS condition evaluator and custom-variable runtime.

## Worker service

- `POST /simulate` only, plus `GET /health`.
- Shared-secret header `X-Sim-Worker-Secret`.
- Bounded body, depth, queue and per-task timeout, as in the archive.
- `engineVersion` = git commit (from `engine-version.json` when present, else `"unknown"`) + sha256 of
  `shared/engine`. A missing manifest must not break `docker compose up`.

## Spring

- `MatchSimulationService.buildDuelReplay` and `PuzzleAttemptService` call `SimWorkerClient`. A worker
  failure keeps today's behavior: an `"ERROR"` replay for matches, and an exception for puzzles.
- Delete the Java engine (`simulation/core`, `simulation/ecs`, Java brain execution) and its tests. Keep
  what validation, loadout and DTOs still use (gameconfig catalogs, geometry, `BotLogicContracts`,
  `CompactAbilityCode`, `StatusEffectState`).
- Config: `sim.worker.url` (default `http://sim-worker:8090`), `sim.worker.secret` (required),
  `sim.worker.timeout` (12 s), `sim.worker.concurrency` (2). Tests use a stub.

## Docker and deploy

- Local `docker-compose.yml`:
  - a `sim-worker` service on an internal network;
  - `SIM_WORKER_SECRET` defaults to a local-only value;
  - the frontend and worker builds get `shared` as an additional context.
- Prod (`docker-compose.prod.yml`, CI):
  - build and push a `botfight-sim-worker` image and run it next to the backend;
  - `SIM_WORKER_SECRET` comes from the prod secret store and has no default.
  - The owner must add that secret before merging to main.

## Verification

- Before the Java engine is deleted, the same scenarios (1v1 melee, ranged, 2v2, closing-zone timeout, KO,
  two puzzles) run through Java and JS.
- The diff is reported to the owner. JS wins, but field-name or shape differences are bugs.
- JS goldens in `shared/engine/match/tests/goldens/` then guard regressions.

## Status

Built on this branch (not deployed; nothing ships until merged to main):

- `shared/engine/match/`: `simulateMatch`, `replayMapping`, `puzzleOutcome`, `botSetup`, with unit tests.
- JS goldens: `shared/engine/match/tests/goldens/` holds 10 request files and one golden summary each.
  `goldens.test.js` compares them; `npm --prefix shared run golden:update` rewrites them, only for an intended change.
- `sim-worker/`: `POST /simulate` and `GET /health` with the shared secret, a Piscina pool, body and task limits,
  and `engineVersion`. `npm test` there also runs the shared engine tests.
- Spring: `SimWorkerClient` plus the worker calls in `MatchSimulationService` and `PuzzleAttemptService`.
- Docker: `docker-compose.yml` runs `sim-worker` on the internal `simulation` network. `docker-compose.prod.yml`
  runs it the same way from `SIM_WORKER_IMAGE`, with `SIM_WORKER_SECRET` required and no default.
- CI (`.github/workflows/cicd.yml`): `simworker` path filter, sim-worker test job, `botfight-sim-worker` image build
  and push, and a deploy that recreates `sim-worker` when it or `shared` changes.
- The Java engine is deleted (`simulation/core`, `simulation/ecs`, Java brain execution). Kept: gameconfig catalogs,
  geometry and `BotLogicContracts`, which validation, loadout and puzzles use.

Java vs JS comparison (run once before the deletion):

- All 8 match scenarios agree on result, winner, frame count and final HP. Two are KO wins and six end in draws.
- Both puzzle scenarios agree on status and elapsed time.
- JS differs from Java in three places, all kept because JS is the source of truth:
  - entities expire one tick earlier;
  - turning near an aligned target differs by about 0.01-0.1 degrees per tick, which also shifts dash direction
    slightly;
  - JS records entity events (`eventType`), which Java never sent.

Not yet done:

- Production needs `SIM_WORKER_SECRET` in the `prod/botfight` secret and `SIM_WORKER_IMAGE` in the production
  `docker-compose.prod.env` on the server before the first deploy.
