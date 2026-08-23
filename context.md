# Machiner repository context

This file is the first-stop map for agents. It routes by directory ownership,
not by individual file. Read the smallest matching area context below, then
search within that area. Do not preload every context file.

## Product in one minute

Bot Fight lets players assemble a structured deterministic bot code plan, test it in
a browser arena, and submit the normalized configuration for an authoritative
fight. The React client owns editing, testing feedback, matchmaking UI, Pixi
presentation, and replay display. The Spring application owns authentication,
sessions, submissions, validation, matchmaking state, persistence, and rated
`duel-v1` simulation.

The browser and server intentionally mirror combat and logic behavior, but the
server is authoritative. Cross-runtime changes must preserve stable IDs, units,
timing, rounding, targeting, effects, loadout encoding, and replay shape.

## Route by task

| Prompt concerns | Read next | Owning areas |
| --- | --- | --- |
| React routes, pages, auth, CSRF, frontend API calls | [`frontend/context.md`](frontend/context.md) | `frontend/src/pages/`, `auth/`, `security/` |
| Testing room, arena UI, Pixi, visuals, interpolation | [`frontend/context.md`](frontend/context.md), then [`frontend/src/gameArena/context.md`](frontend/src/gameArena/context.md) | `frontend/src/gameArena/` |
| Logic blocks, conditions, actions, targeting, code normalization | [`frontend/context.md`](frontend/context.md); add [`server/context.md`](server/context.md) for submitted/rated behavior | `frontend/src/gameArena/logic/`, server validation and simulation areas |
| Matchmaking UI or WebSocket protocol | [`frontend/context.md`](frontend/context.md) and [`server/context.md`](server/context.md) | frontend matchmaking/page areas and server controller/service areas |
| REST endpoints, auth, CSRF, submissions | [`server/context.md`](server/context.md); add frontend context for callers | server controller, service, security, and DTO areas |
| Persistence, ownership, migrations | [`server/context.md`](server/context.md) | server domain, repository, and migration areas |
| Rated fights, deterministic simulation, replay, combat parity | [`server/context.md`](server/context.md), [`frontend/src/gameArena/context.md`](frontend/src/gameArena/context.md), and [`docs/context.md`](docs/context.md) | server simulation and frontend arena/runtime areas |
| Adding/changing abilities, effects, shields, arena entities | [`docs/context.md`](docs/context.md) first, then both runtime contexts | documentation and both gameplay runtime areas |
| Review, regression audit, combat/visual checklist | [`docs/context.md`](docs/context.md) plus the affected runtime context | documentation and affected runtime areas |
| Docker, ports, local service orchestration | this file, then relevant area context | repository root and component roots |
| Adding folders or maintaining context maps | [`docs/MAINTAINING_CONTEXT_FILES.md`](docs/MAINTAINING_CONTEXT_FILES.md) | closest existing context boundary |

For a task spanning boundaries, read each relevant area context. For a local
fix, stop routing when the owning directory is clear, then use targeted search
to find the implementation and tests.

## Top-level map

- `frontend/`: React 19 + Vite client. Source is in `frontend/src/`; generated
  `dist/`, installed `node_modules/`, and Vite logs are not source.
- `server/`: Java 21, Spring Boot 4, Maven backend and in-process authoritative
  duel simulator. There is no separate active Node simulation package.
- `docs/`: durable gameplay contracts, implementation guides, and regression
  audit checklists. Use its context index instead of opening every document.
- `artifacts/`: ignored runtime/base-model assets mounted read-only by Docker.
  Inspect only for an artifact-specific request.
- `.github/`: repository automation. `.vscode/`: local editor configuration.
- `docker-compose.yml`: PostgreSQL, pgAdmin, backend, and frontend orchestration.
- `MATCH_COMPONENTS.txt`: older rules snapshot; do not use it as current
  authority when it conflicts with code or the docs index.

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

From the repository root: `docker compose up --build`.

## Maintaining this map

Do not add a row when an ordinary file is created. Update routing only when a
directory gains a new responsibility or ownership boundary. The complete policy
and examples are in
[`docs/MAINTAINING_CONTEXT_FILES.md`](docs/MAINTAINING_CONTEXT_FILES.md).
