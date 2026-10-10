# Simulation worker

Node 20.18+ HTTP adapter for the shared engine. Spring accepts authoritative results only from this worker. No game rules live here.

From the repository root:

```powershell
npm ci --prefix sim-worker
npm test --prefix sim-worker
$env:SIM_WORKER_SECRET = '<a private shared secret>'
npm start --prefix sim-worker
```

`POST /simulate` requires `Content-Type: application/json` and
`X-Sim-Worker-Secret` equal to `SIM_WORKER_SECRET`. Its JSON body follows
`shared/schemas/simulation-request.schema.json`, including the E0 brain schema.
Success is the unchanged E0 `{ result, replay }` envelope.

`POST /validate` (same headers) takes `{ "brain": {...} }`, or `{ "brain": {...}, "puzzleRules": true }`
for puzzle outcome rules, and answers `{ "errors": [...] }` (empty means valid): the brain schema, then the
shared engine's `brainRules.js`. Spring calls it for every submission and puzzle save. `GET /health` is an
unauthenticated internal readiness endpoint. Every HTTP response carries
`X-Engine-Version`; health and errors also carry `engineVersion` in JSON,
and success carries `result.engineVersion`.

The version is the full Git commit, a colon, and the SHA-256 of sorted relative
paths plus exact file bytes under `shared/gameplay` and `shared/schemas`.
Uncommitted engine source is identified by HEAD; commit engine changes before a
production image build. The data/schema hash still identifies uncommitted data.
The E0 response version bound is now 128 characters to fit this 105-character ID.

Before **each** Docker build, regenerate the ignored version manifest:

```powershell
npm run version:write --prefix sim-worker
docker compose build
```

Copy the root `.env.example` to `.env` if it does not exist, then fill in
`SIM_WORKER_SECRET` using the generation command in the template. The secret is
required and left blank in the example. The real `.env` is ignored by Git.
You can also set `SIM_WORKER_SECRET` in the shell for Compose. Both backend and
worker receive it; backend also receives `SIM_WORKER_URL=http://sim-worker:8090`.
The worker has no published port and joins only the internal simulation network,
which the backend also joins. The image uses Node 20 and a non-root user. It
checks the manifest's hash against the packaged shared data at startup and fails
if stale. No Git metadata, credentials, fixtures or frontend files enter the image.

Defaults (environment overrides are positive integers except queue, which may be zero):

| Variable | Default |
| --- | --- |
| `PORT` | 8090 |
| `SIM_WORKER_THREADS` | available CPU cores (container quota aware) |
| `SIM_WORKER_MAX_QUEUE` | twice the thread count |
| `SIM_WORKER_MAX_BODY_BYTES` | 1048576 |
| `SIM_WORKER_MAX_TICKS` | 1200 (cannot exceed this match bound) |
| `SIM_WORKER_TASK_TIMEOUT_MS` | 10000, including queue and thread startup |
| `SIM_WORKER_BODY_TIMEOUT_MS` | 5000, absolute upload deadline |

Only the HTTP thread receives/parses bounded JSON and handles authentication;
Ajv and simulation execute in the pool, loaded once per thread. JSON nesting is
capped at 64 before parsing/schema recursion. Admission includes in-flight uploads
and is bounded by threads plus queue capacity. Each task runs alone in a thread.
Timeouts and client disconnections abort the task through Piscina, terminating an
active thread and allowing its replacement. SIGTERM stops admission and cancels
work. Structured logs record response status, duration, version and pool failures,
without logging request bodies or secrets.

Errors are `{ engineVersion, error: { code, issues } }`, with machine-readable
schema issues (`path`, `keyword`, `message`, `params`) or simulation issues:

| HTTP | Failure |
| --- | --- |
| 400 | malformed/too-deep JSON, schema/engine input checks, tick cap |
| 401 | missing/incorrect shared secret |
| 404 | unknown route/method |
| 408 | upload deadline |
| 413 | declared or streamed body exceeds byte cap |
| 415 | non-JSON content type |
| 503 | admission/queue capacity exhausted or stopping |
| 504 | task deadline, thread terminated |
| 500 | pool/infrastructure failure |

Tests exercise every committed browser golden through HTTP and compare all
returned tick hashes (up to KO), validate the success schema, and check auth,
invalid input, chunked oversize uploads, slow uploads, queue saturation, health
responsiveness and recovery after terminating a synchronous infinite CPU loop.
The blocking worker is injected by tests only; requests cannot choose a worker.


Optional deterministic diagnostics: `diagnostics: { stateHashes: true }` asks for a top-level
`diagnostics.stateHashes` array, one canonical golden FNV-1a hash per simulated
tick from match start, including segments before `recordFromMs`. A bounded
`stopAtMs` (100 ms multiples) limits diagnostic runs to a requested tick. Puzzle rules are evaluated by the shared engine. Without this option responses and
replays retain their existing shape. Seeds may be signed 64-bit decimal strings
to preserve Java longs exactly, or safe-integer JSON numbers. The shared engine has no random gameplay. Regenerate the ignored version manifest after schema
changes with `npm run version:write`.


Spring always calls the worker; failures use its existing retry/cancel path. An optional `puzzle` envelope
supplies saved win/lose conditions, puzzle logic and relative time limit. The
shared engine evaluates modify/win/lose/time rules after each tick and returns
`result.puzzleStatus` and the stopping tick. Match result `endState` is the
position/HP/stamina summary used by Spring between segments. Replays remain raw
practice-room render frames.

Run `npm run version:write --prefix sim-worker` from the repository root after
source changes and before `docker compose build`. This also generates the shared
build version consumed by Spring and Vite for `X-Build-Version` reloads.
