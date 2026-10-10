# Frontend context

Use this map for React, browser networking, deterministic code editing, arena
testing, Pixi rendering, and replay presentation. For arena internals, continue
to [`src/gameArena/context.md`](src/gameArena/context.md).

## Entry points and routes

- `src/main.jsx`: mounts React.
- `src/App.jsx`: route ownership and lazy-loaded pages.
- `src/routeLoaders.js`: route-level loading helpers.
- `src/pages/`: login, registration, home, matchmaking, custom-lobby, and puzzle screens.
- `src/puzzles/`: puzzle list and admin-authoring API calls; puzzle storage and
  server validation remain backend-owned.
- `src/auth/`: session state and route protection.
- `src/security/csrf.js`: CSRF acquisition/header helpers for state changes.
- `src/notifications/`: app-wide notification subscription, party/custom-lobby invite
  actions, and block-aware notification state.
- `src/chatModeration/`: report submission UI/API shared by match and custom-lobby
  chat; admin review is under `src/pages/admin/`.
- `src/index.css` and `src/App.css`: global/application styling.

Route UI and navigation bugs here first. Authentication behavior usually spans
`auth/`, `security/`, the calling page, and server auth/security endpoints.

## Task routing

| Concern | Primary paths | Also inspect |
| --- | --- | --- |
| App route or page UI | `src/pages/` and the app shell | relevant styles and route-loading area |
| Custom lobby UI and live roster | `src/pages/customLobby/` and `src/matchmaking/` | `src/notifications/`, `src/components/AppNavbar.jsx`, and server custom-lobby areas |
| Puzzle list or admin puzzle authoring | `src/pages/puzzles/` and `src/puzzles/` | `src/auth/`, arena code/loadout contracts, and server puzzle areas |
| Login/session/CSRF | `src/auth/`, `src/security/` | server auth/security areas |
| Notifications, party/custom-lobby invites, and blocks | `src/notifications/`, `src/components/AppNavbar.jsx`, `src/pages/profile/` | matchmaking queue/socket, server party/custom-lobby/invite/block/notification areas |
| Chat reporting and admin moderation | `src/chatModeration/`, chat components under `src/matchmaking/` and `src/pages/customLobby/`, and `src/pages/admin/` | server chat moderation controller/service/domain/repository and [`../docs/CHAT_MODERATION.md`](../docs/CHAT_MODERATION.md) |
| Matchmaking lifecycle/ability draft or match chat | `src/pages/`, `src/matchmaking/` | server matchmaking areas |
| WebSocket framing/reconnect | `src/matchmaking/` | server WebSocket configuration and controller areas |
| Logic evaluation/normalization | `../shared/engine/botlogic/code/` (tests in `src/gameArena/botlogic/code/tests/`) | nearby tests and arena payload/loadout contracts |
| Movement planning | `../shared/engine/botlogic/planner/` | arena geometry and constants areas |
| Match submission API | `src/gameArena/botlogic/submission/` | server DTO, controller, validation, and service areas |
| Arena, combat, loadout, Pixi | [`src/gameArena/context.md`](src/gameArena/context.md) | relevant docs via `docs/context.md` |
| Authoritative replay display | `src/replay/` | shared-engine render frames and server replay authorization |

## Logic and API boundaries

`../shared/engine/botlogic/` owns the structured code contract and deterministic
selection/planning helpers (the engine is shared with sim-worker; see
[`../shared/engine/context.md`](../shared/engine/context.md)); `src/gameArena/botlogic/` keeps the editor graph,
submission client, brain-schema validation and the tests. Keep schema normalization pure and bounded. Stable
action, target, condition, comparator, and ability IDs must match server
validation and simulation.

`code/configuration/brainSchema.js` validates a normalized brain with ajv against `shared/schemas/brain.schema.json`
(the file the server checks); the editor shows its errors. That schema is generated from the contracts in
`code/contracts/` and the loadout catalog by `scripts/generate-brain-schema.mjs` (`npm run schema:brain`), and a test fails
when the committed file is stale. Change a variable, action or limit there and regenerate. The rules a schema
cannot express are `shared/engine/botlogic/code/configuration/brainRules.js`; the editor runs them after the
schema (`validateBrain.js`), and the sim-worker runs the same file for every submission.

`SubmissionClient.js` sends normalized code/loadout data; it does not make the
browser authoritative. Any payload change requires tracing the matching server
DTO, validator, persistence mapping, and rated simulation consumer.

The WebSocket client uses STOMP destinations under `/app/matchmaking.*` and
receives lifecycle and chat events from authenticated user queues. Treat
destination or event shape changes as shared contracts.

## Arena boundary

`src/gameArena/Arena.jsx` is the browser testing orchestrator and
`src/gameArena/pixi/PixiCanvas.jsx` presents arena state. Do not add gameplay
authority to the renderer. The focused arena context maps combat, ECS, payload,
loadout, and visual-state ownership.

## Checks

Run the narrowest matching test first:

- code/conditions/targeting: `src/gameArena/botlogic/code/tests/BotCode.test.js`;
- movement and action planning: `src/gameArena/ecs/tests/EntitySystems.test.js`;
- entity/combat execution: `src/gameArena/ecs/tests/EntitySystems.test.js`;
- interpolation/visual mapping: `src/gameArena/pixi/*.test.js`.

Then use `npm test`. For UI, import, or build changes also run `npm run lint` and
`npm run build`.

Do not inspect or modify `node_modules/`, `dist/`, `*.log`, or generated Vite
assets as source.
