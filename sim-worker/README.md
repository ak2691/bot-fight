# Simulation worker

Node 20.18+ HTTP service that runs `shared/engine/match/simulateMatch.js` in a Piscina thread pool. The
worker is the match authority for Spring; it holds no game rules of its own.

## Endpoints

- `POST /simulate`: requires `Content-Type: application/json` and `X-Sim-Worker-Secret` equal to
  `SIM_WORKER_SECRET`. The body is a duel-v1 request (`rulesetVersion: "duel-v1"`, `arena`, `bots`, optional
  `puzzle`). Success is `{ engineVersion, replay, puzzle? }`. A roster or arena error is
  `400 INVALID_SIMULATION`; a request over the tick cap is `400 TICK_LIMIT`.
- `GET /health`: unauthenticated readiness check. Returns `{ status, engineVersion, threads, ... }`.

Every response carries `X-Engine-Version`, and JSON bodies carry `engineVersion`. Errors are
`{ engineVersion, error: { code, issues } }`.

`engineVersion` is the Git commit (or `unknown` when none is available), a colon, and the SHA-256 of
`shared/engine` (all files, recursively, skipping `tests/` folders). A missing or stale
`engine-version.json` falls back to git, then to `unknown`; it never stops the service.

## Running

```powershell
npm ci --prefix sim-worker
npm test --prefix sim-worker
$env:SIM_WORKER_SECRET = '<a private shared secret>'
npm start --prefix sim-worker
```

Optional: `npm run version:write --prefix sim-worker` writes the ignored `engine-version.json` manifest.

## Environment

| Variable | Default |
| --- | --- |
| `SIM_WORKER_SECRET` | required |
| `PORT` | 8090 |
| `SIM_WORKER_THREADS` | available CPU cores |
| `SIM_WORKER_MAX_QUEUE` | twice the thread count |
| `SIM_WORKER_MAX_BODY_BYTES` | 1048576 |
| `SIM_WORKER_MAX_TICKS` | 1200 (cannot exceed this) |
| `SIM_WORKER_TASK_TIMEOUT_MS` | 10000 |
| `SIM_WORKER_BODY_TIMEOUT_MS` | 5000 |

Limits: JSON nesting is capped at 64 before parsing. Admission (in-flight uploads plus queued tasks) is
bounded by threads plus queue. A task that exceeds its deadline is aborted and its thread is replaced
(`504 SIMULATION_TIMEOUT`).

## Docker and Spring

`docker-compose.yml` runs the worker as `sim-worker` on the internal `simulation` network, with no published
port. The build context is this folder plus `shared` as an additional context. `engine-version.json` is
optional in the image. Spring (`sim.worker.url`, default `http://sim-worker:8090`) sends the same secret in
`X-Sim-Worker-Secret` and treats worker failures as its existing error path.
