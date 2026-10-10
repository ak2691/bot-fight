# Botfight repository context

This file is the first-stop map for agents. It routes by directory ownership,
not by individual file. Read the smallest matching area context below, then
search within that area. Do not preload every context file.

## Product in one minute

Bot Fight lets players assemble a structured deterministic bot code plan, test it in
a browser arena, and submit the normalized configuration for an authoritative
fight. The React client owns editing, testing feedback, matchmaking UI, Pixi
presentation, and replay display. The Spring application owns authentication,
sessions, submissions, validation, matchmaking state, persistence, and rated
`duel-v2` orchestration through the authenticated Node worker.

Gameplay has one implementation in `shared/engine/`, imported by the browser
for previews and by `sim-worker/` for authoritative simulation. Spring owns
ratings, validation, deadlines, result acceptance and replay authorization.

## Route by task

| Prompt concerns | Read next | Owning areas |
| --- | --- | --- |
| React routes, pages, auth, CSRF, frontend API calls | [`frontend/context.md`](frontend/context.md) | `frontend/src/pages/`, `auth/`, `security/` |
| Testing room, arena UI, Pixi, visuals, interpolation | [`frontend/context.md`](frontend/context.md), then [`frontend/src/gameArena/context.md`](frontend/src/gameArena/context.md) | `frontend/src/gameArena/` |
| Logic blocks, conditions, actions, targeting, code normalization | [`frontend/context.md`](frontend/context.md); add [`server/context.md`](server/context.md) for submitted/rated behavior | `frontend/src/gameArena/botlogic/`, server submission validation and shared engine areas |
| Matchmaking UI or WebSocket protocol | [`frontend/context.md`](frontend/context.md) and [`server/context.md`](server/context.md) | frontend matchmaking/page areas and server controller/service areas |
| REST endpoints, auth, CSRF, submissions | [`server/context.md`](server/context.md); add frontend context for callers | server controller, service, security, and DTO areas |
| Chat reporting and moderation | [`server/context.md`](server/context.md), [`frontend/context.md`](frontend/context.md), and [`docs/CHAT_MODERATION.md`](docs/CHAT_MODERATION.md) | chat moderation services, chat UI, and admin report workflow |
| Persistence, ownership, migrations | [`server/context.md`](server/context.md) | server domain, repository, and migration areas |
| Rated fights, deterministic simulation, replay, combat | [`server/context.md`](server/context.md), [`shared/engine/context.md`](shared/engine/context.md), [`frontend/src/gameArena/context.md`](frontend/src/gameArena/context.md), and [`docs/context.md`](docs/context.md) | shared engine, worker transport and server match/replay areas |
| Adding/changing abilities, effects, statuses, stamina, arena entities | [`docs/ABILITIES.md`](docs/ABILITIES.md) first, then shared engine and server contexts | `shared/gameplay/` and shared engine and server validation areas |
| Review, regression audit, combat/visual checklist | [`docs/context.md`](docs/context.md) plus the affected runtime context | documentation and affected runtime areas |
| Docker, ports, local service orchestration | this file, then [`sim-worker/context.md`](sim-worker/context.md) for the worker | repository root and component roots |
| Adding folders or maintaining context maps | [`docs/MAINTAINING_CONTEXT_FILES.md`](docs/MAINTAINING_CONTEXT_FILES.md) | closest existing context boundary |

For a task spanning boundaries, read each relevant area context. For a local
fix, stop routing when the owning directory is clear, then use targeted search
to find the implementation and tests.

## Top-level map

- `frontend/`: React 19 + Vite client. Source is in `frontend/src/`; generated
  `dist/`, installed `node_modules/`, and Vite logs are not source.
- `server/`: Java 21, Spring Boot 4, Maven backend. Owns authenticated match
  state, validation, persistence, ratings and mandatory worker calls.
- `sim-worker/`: internal Node HTTP simulator adapter, Piscina pool, transport bounds and version reporting. Read [`sim-worker/context.md`](sim-worker/context.md).
- `docs/`: durable gameplay contracts, implementation guides, and regression
  audit checklists. Use its context index instead of opening every document.
- `shared/gameplay/`: the ability, status, channel and movement data (`abilities.json`, ...). Only the
  engine reads the gameplay in it (`gameconfig/gameplayData.js` checks it); Spring reads ability IDs and
  loadout codes. Reformat after edits with `node tools/format-gameplay-json.mjs`.
- `shared/engine/`: the simulation core (fight, systems, brain runtime, `simulateFight` match loop),
  plain ES modules shared by the browser and sim-worker; a lint rule keeps UI, DOM and Node
  imports out. Read [`shared/engine/context.md`](shared/engine/context.md).
- `shared/gameplay-tests/`: deterministic scenarios and the single committed
  `golden.browser.json` (combat log and per-tick state hashes). Browser and
  worker tests execute the same shared engine against it. Regenerate intended
  gameplay changes with `npm run golden:update` from `frontend/` and review the diff.
- `shared/schemas/`: JSON Schemas (2020-12). `brain.schema.json` is the only definition of a
  structurally valid brain (generated: `npm run schema:brain` from `frontend/`, from the
  browser contracts; the server and the editor both validate against it). `simulation-request.schema.json`
  and `simulation-response.schema.json` describe what Spring and the simulator worker exchange.
  The server's pom copies the folder to the classpath as `schemas/`.
- `shared/brain-tests/`: `valid/` and `invalid/` brain fixtures (each invalid one names its rule and the
  layer that rejects it: `schema`, or `rules` for the engine's `brainRules.js`, which the worker runs on
  `POST /validate`). Editor, Spring and worker tests must classify them the same way;
  regenerate with `npm run fixtures:brain`.
- `artifacts/`: ignored runtime/base-model assets mounted read-only by Docker.
  Inspect only for an artifact-specific request.
- `.github/`: repository automation. `.vscode/`: local editor configuration.
- `docker-compose.yml`: PostgreSQL, backend, frontend and internal sim-worker orchestration.

## Cross-boundary change rule

When a payload or gameplay contract crosses client/server boundaries, trace it
end to end before editing:

1. frontend schema/catalog and normalization;
2. request or WebSocket client;
3. server DTO/controller boundary;
4. validation and ownership checks;
5. service/persistence or authoritative simulation;
6. replay/presentation consumers;
7. focused tests on both sides.

## Common commands

From `frontend/`: `npm test`, `npm run lint`, `npm run build`.

From `server/` on Windows: `.\mvnw.cmd test` and
`.\mvnw.cmd spring-boot:run`.

From `sim-worker/`: `npm test`.

From the repository root: `npm run version:write --prefix sim-worker`, then
`docker compose build` (requires Docker Linux engine and `SIM_WORKER_SECRET`).

## Maintaining this map

Do not add a row when an ordinary file is created. Update routing only when a
directory gains a new responsibility or ownership boundary. The complete policy
and examples are in
[`docs/MAINTAINING_CONTEXT_FILES.md`](docs/MAINTAINING_CONTEXT_FILES.md).
