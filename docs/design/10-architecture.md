# 10 Architecture

The shape stays familiar: one deterministic engine shared by browser and server, a Node worker that runs it for
results, Spring for everything stateful, Postgres for storage. What changes is the engine itself (a new physics
engine), the content model, and the services (contests instead of live matches).

## Overview

```
Browser (React + Pixi)
 ├─ Garage, brain editor, sandbox, Academy ── shared/sim in a Web Worker (previews only)
 ├─ Replay viewer ── frames from the server
 └─ REST + STOMP (notifications) ──► Spring Boot ──► Postgres
                                          │
                                          └─ HTTP + shared secret ──► sim-worker (Node + Piscina) ── shared/sim (authoritative)

shared/content  ── parts, weapons, sensors, arenas, twists, seasons, house bots, gauntlets, Academy (read by everyone)
shared/schemas  ── JSON Schemas for builds, brains, rulesets, arenas, seasons, simulation request/response, replays
tools/          ── season planner, balance harness, arena validator, content formatter
```

**Why keep Node workers:** the same JavaScript runs the sandbox in the browser and the authoritative game on the
server, so previews and results can't drift. At the target of under 30 ms per game, JavaScript is fast enough;
Piscina scales across cores and the worker scales horizontally. WebAssembly is a later option only if profiling
demands it.

## Packages

### `shared/sim/` (the engine)

Plain ES modules, no DOM, Node built-ins or UI imports, enforced by lint as today, plus the determinism rules in
[03](03-physics.md#determinism) (banned transcendental `Math` functions, `Math.random`, `Date`).

| Module | Responsibility |
|---|---|
| `math/` | Vectors, `dsin`/`dcos`/`datan2`, angle wrapping, rectangle geometry, separating-axis tests, raycasts |
| `physics/` | Bodies, integration, contacts, impulse solver, compound bodies for grabs |
| `parts/` | `deriveStats(build, ruleset)`: the only place parts become numbers |
| `weapons/` | One state machine per weapon type; zones; hit resolution |
| `sensors/` | Built-in sensing, rangefinder detection and line of sight, camera with delay buffer; builds the perception struct |
| `brain/` | Compiling and evaluating brains; maneuvers to control targets; trace |
| `control/` | Maneuvers to desired motion, per drivetrain |
| `hazards/` | Pits, saws, spiked walls, ring-out, crates |
| `game/` | `runGame`: the step loop, damage pipeline, end conditions, judges |
| `replay/` | Frames, events, traces |
| `validate/` | Build rules, brain rules, ruleset rules (schemas cover structure) |

### `shared/content/`

Data with schemas and formatters: `parts.json`, `weapons.json`, `sensors.json`, `rulesets/base.json`,
`twists.json`, `arenas/`, `arena-templates/`, `seasons/`, `house-bots/`, `gauntlets/`, `academy/`. Also the arena
generator and its seeded PRNG (content generation may be seeded-random; the fight may not). A **content version**
(a hash of all data files) is recorded with every game.

## Engine API

```js
runGame({
  ruleset, arena, spawnLayout, swapped,
  bots: [{ id, build, brain }, { id, build, brain }],
  record: { frames: true, events: true, traceFor: ["a"] }   // optional
}) → {
  result:  { winner: "a" | "b" | "draw", reason: "ko" | "pit" | "ringout" | "judges" | "draw",
             endStep, damageTaken: [a, b], weaponHits: [a, b] },
  summary: { per-bot stats for careers and achievements },
  replay?: { frames, events, traces }
}

deriveStats(build, ruleset)       → stats for the garage bars and the engine
validateBuild(build, ruleset)     → errors
validateBrain(brain, build)       → errors and warnings
```

The engine and content versions are reported by the worker and stored with each game.

## Simulation worker

| Endpoint | Purpose |
|---|---|
| `POST /simulate` | Run one game; return the result, and the replay when asked |
| `POST /validate` | Validate a build, a brain and a ruleset together |
| `GET /version` | Engine and content versions |

Bounds: request size limits, brain and build limits from the schema, a soft CPU budget of 200 ms per game and a
hard timeout of 2 s, bounded admission. Authenticated with the shared secret, as today. A batch endpoint is added
only if per-request overhead shows up in measurements.

## Spring services

| Package | Responsibility |
|---|---|
| `auth`, `profile`, `block`, `notification` | Existing; profile gains level, XP, main bot |
| `content` | Loads `shared/content` at startup (season, twists, arenas, house bots, gauntlets); refuses to start if its content version differs from the worker's |
| `garage` | Bots and immutable bot versions; validation through the worker on save |
| `game` | The game record and the simulation queue (below) |
| `cup` | Cup state machine, entries, auto-entry, Swiss pairing, tiebreakers, finals, premiere visibility |
| `rating` | Glicko-2 as pure functions; rating history and performance ratings |
| `ladder` | Ladder enrolment, pairing scheduler, ladder ratings |
| `gauntlet` | Daily gauntlets, submissions, scoring, medals, streaks |
| `challenge` | Challenges, rivalry records |
| `social` | Friends, activity feed |
| `progression` | XP ledger, levels, trophies, achievements, cosmetic unlocks |
| `academy` | Mission verification by re-simulation |
| `replay` | Re-simulation on demand, caching, visibility checks, stripping traces the viewer doesn't own |
| later: `room`, `club` | Scrim rooms over STOMP; clubs and private cups |

Pure logic (Swiss pairing, tiebreakers, Glicko-2, gauntlet scoring) lives in plain classes with no database or
Spring dependencies, so it's unit-testable with reference data.

## Data model

| Table | Key columns |
|---|---|
| `app_user`, `profile` | Existing; profile adds `level`, `xp`, `main_bot_id` |
| `friendship` | user_a, user_b, status, created_at |
| `bot` | id, owner_id, name, paint, decal, challengeable, created_at, deleted_at |
| `bot_version` | id, bot_id, number, build_json, brain_json, content_version, created_at, published_at |
| `season` | id, number, starts_at, content_ref |
| `cup` | id, season_id, week, state, arena_json, ruleset_json, stage2_candidates, stage2_twist, lock_at, premiere_at |
| `cup_entry` | cup_id, user_id, division, stage1_version_id, stage2_version_id, points, final_rank |
| `cup_round` | cup_id, number, stage, state |
| `cup_match` | id, round_id, side_a, side_b (an entry or a house bot), games_a, games_b, result |
| `game` | id, context (cup / ladder / challenge / gauntlet / academy), context_ref, side_a, side_b (version or house bot), ruleset_json, ruleset_hash, arena_json, spawn_layout, swapped, engine_version, content_version, priority, status, attempts, claimed_at, result_json, created_at, done_at |
| `player_rating` / `rating_history` | user_id, rating, deviation, volatility / user_id, cup_id, before, after, performance |
| `ladder_bot` | bot_id, version_id, rating, deviation, volatility, games_today |
| `gauntlet` / `gauntlet_submission` / `streak` | date, content_json / user_id, date, version_id, score, medal / user_id, current, best, last_date |
| `challenge` / `rivalry` | id, from_user, to_user, versions, rules_json, format, mirror, status, result / user_a, user_b, wins_a, wins_b, draws |
| `xp_ledger`, `trophy`, `achievement`, `cosmetic_unlock` | progression records |
| `academy_progress` | user_id, mission, version_id, cleared_at |
| `notification`, `user_block` | Existing |

House bots are content (in `shared/content/house-bots/`), referenced by id rather than stored as rows.

## Simulation pipeline

The `game` table is the queue: no new infrastructure.

- **Dispatcher:** claims `PENDING` rows with `SELECT … FOR UPDATE SKIP LOCKED`, highest priority first, sends them
  to the worker with concurrency equal to the worker pool size, writes `DONE` with the result, or retries (3
  attempts, backoff). Rows stuck in `RUNNING` past a timeout return to `PENDING`. Inserts are idempotent (unique by
  context, ref and game index).
- **Priorities:** academy verification, gauntlet submissions and challenges (a player is waiting) → cup rounds (on a
  schedule) → ladder (background).
- **Cup rounds:** pair → insert the round's games → wait until all are done → score → pair the next round. Rounds
  are sequential (Swiss needs results); games within a round run in parallel.
- **Capacity:** about 24,000 games for a 1000-entrant cup at under 30 ms each is about 12 CPU-minutes. Each stage
  finishes in minutes on a few cores.

## Scheduling

Spring's scheduler drives fixed UTC transitions, as the current match scheduler does:

- the cup state machine (brief → lock → Stage 1 → adapt → Stage 2 → finals → premiere), persisted and idempotent,
  with startup recovery;
- the Daily Gauntlet rollover at 00:00 UTC;
- the ladder pairing tick every 10 minutes;
- the season loader at startup.

## Replays and visibility

- A replay request is checked against the visibility rules ([08](08-competition.md#visibility)), then re-simulated
  through the worker with recording on. The opponent's brain trace is removed unless the viewer owns that bot or it's
  published. Results are cached (in-memory LRU; finals pre-warmed before the premiere).
- **Engine and content versions are frozen for a season** (urgent fixes aside); a season patch bumps both. Replays
  are guaranteed within a season. Results and summaries are kept forever; old seasons' worker images can be kept if
  replaying old seasons matters.

## API sketch

| Area | Endpoints |
|---|---|
| Garage | `GET/POST /api/bots`, `PATCH/DELETE /api/bots/{id}`, `POST /api/bots/{id}/versions` (validate and save), `GET /api/bots/{id}/versions/{n}` |
| Cup | `GET /api/cups/current`, `GET /api/cups/{id}`, `PUT/DELETE /api/cups/{id}/entry`, `PUT /api/cups/{id}/adapt`, `GET /api/cups/{id}/standings`, `GET /api/cups/{id}/finals` |
| Gauntlet | `GET /api/gauntlet/today`, `POST /api/gauntlet/today/submissions`, `GET /api/gauntlet/{date}/leaderboard` |
| Ladder | `PUT/DELETE /api/ladder/{botId}`, `GET /api/ladder` |
| Challenges | `POST /api/challenges`, `GET /api/challenges`, `GET /api/challenges/{id}` |
| Replays | `GET /api/games/{id}/replay` |
| Social | `/api/friends…`, `GET /api/feed` |
| Profiles | `GET /api/profile/{username}`, `GET /api/rating/{username}/history` |
| Academy | `POST /api/academy/{mission}/verify` |
| Content | `GET /api/content/current` (season, arenas, twists, house bots: public data) |
| Archive | `GET /api/archive`, `POST /api/archive/{versionId}/fork` |

## Realtime

STOMP stays for **notifications** (`/user/queue/notifications`). Scrim rooms (after the MVP) add per-room topics.

## Frontend

| Route | Page |
|---|---|
| `/` | Home: cup status, today's gauntlet, notifications, friends feed |
| `/garage`, `/garage/:botId` | Bots; tabs for Build, Brain, Sandbox, Versions |
| `/academy` | Missions |
| `/gauntlet` | Today's gauntlet and leaderboards |
| `/cup`, `/cup/:id` | Brief, entry, standings, finals premiere |
| `/ladder`, `/challenges`, `/friends` | Social play |
| `/replay/:gameId` | Replay viewer with trace and highlights |
| `/profile/:username`, `/archive`, `/catalogue` | Profiles, published bots, parts and readings |

- **The sandbox runs the engine in a Web Worker,** so the UI stays smooth; fast-forward and rewind are
  re-simulations.
- **The renderer** (Pixi) draws layers for the arena, hazards, bots (sprites composed from their parts and paint),
  weapons, effects (sparks, shake, slow-motion on big hits) and overlays (zones, sensor cones, planned path). Effects
  are presentation only.
- **The brain editor** follows [06](06-programming.md#the-editor); validation runs instantly in the browser with the
  shared rules.

## Validation

| Layer | Where | What |
|---|---|---|
| Schemas | Browser, worker, Spring (request envelopes) | Structure, types, closed lists, sizes |
| Shared rules (`shared/sim/validate`) | Browser for instant feedback; the worker's `/validate` for authority | Build rules, brain rules, ruleset rules |
| Spring | Server | Ownership, limits, contest state (lock times, one entry), rate limits |
| Re-simulation | Worker | Academy and gauntlet results are never taken from the client |

## Security

Every query is bound to the authenticated user; private data returns a generic not-found. Opponent brains and
traces are never sent unless published or owned. Request sizes, brain limits and rates are bounded. Content changes
only through the repository. The worker is internal and authenticated.

## Observability

Metrics for games per minute, queue depth, simulation time (median and 99th percentile), failures and retries;
a cup-run view; and **meta statistics** per cup (usage share and win rate per weapon and part) that feed the
rotation decisions in [07](07-arenas-and-twists.md#rotation).

## Testing

| Level | Tests |
|---|---|
| Engine units | Deterministic trig accuracy; acceleration curves; push contests (heavier and grippier wins); impact energy and damage; each weapon's cycle and hit rules; sensor cones and line of sight; brain semantics (first match, fall-through, switches, timing) |
| Golden games | Fixed scenarios hashed every 100 steps; must match in the worker and in a headless browser |
| Properties | No NaN or infinity; HP and charge stay in range; no body escapes the arena |
| Balance | The harness in CI on changes to parts, weapons or engine numbers ([07](07-arenas-and-twists.md#vetting)) |
| Spring | Swiss pairing, tiebreakers, Glicko-2 (against the published reference example), gauntlet scoring, visibility rules, cup state transitions |
| Worker boundary | Authentication, bounds, timeouts, malformed input (as today) |
| End to end | A test season: enter a cup → Stage 1 → adapt → Stage 2 → standings → replay |

## Reuse and replace

Reused: authentication and sessions, notifications, blocks, the scheduler and startup-recovery pattern, the worker's
transport and admission control, the schema-generation and engine-lint tooling, the Pixi application shell. Replaced:
the engine, the brain model and editor, live matches and matchmaking, puzzles (by Academy and gauntlet content). The
area-by-area map is in [`../GAMEPLAY_OVERHAUL_MIGRATION.md`](../GAMEPLAY_OVERHAUL_MIGRATION.md).
