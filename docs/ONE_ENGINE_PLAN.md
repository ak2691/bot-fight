# One engine plan

Status: direction chosen 2026-10-08 (the JS engine on Node workers). Stage O
(optimizing the JS engine) can start now: it also speeds up the practice room.
The worker migration (stages E) starts after launch feedback, once the
browser/server parity test is green.

## 1. Why

The gameplay simulation exists twice: the browser engine in
`frontend/src/gameArena/` and the Java engine in `server/.../simulation/`
(about 13k lines, authoritative for rated matches and puzzles). Since the
refactor the **data** is shared (`shared/gameplay/*.json`), but the **logic**
that interprets it (verbs, entity tick, effects, targeting, tick stages,
stamina, channels, the brain runtime) is written in both languages. Every
gameplay change is two implementations plus a parity test, and the test only
catches what the golden scenarios cover (example: the server's Snare Bomb used
the wrong radius and hit nobody).

Goal: one simulation codebase, run by the browser for previews and by Node
workers for authoritative results. Parity is then true by construction.

What does not change:

- The server stays the match authority. The browser stays a preview.
- Spring keeps Spring Security, sessions, matchmaking, match phases and round
  flow, deadlines, submission validation and allowlists, row ownership,
  persistence, ratings, puzzles, chat and replay storage.
- Brains stay normalized allowlisted data. The engine never runs user code.
- Seeds and deterministic replays are preserved.

## 2. Options considered

| | A. JS engine on Node workers (chosen) | B. JS engine in the JVM (GraalJS) | C. Java engine compiled for the browser (TeaVM, J2CL) |
| --- | --- | --- | --- |
| Frontend change | None: engine files move to a shared package | None | Replace the engine; React and Pixi must read compiled Java state through a conversion layer |
| Math vs Chrome previews | Same engine family (V8) | Different math library | Server JVM math vs browser JS math: same source, different libraries |
| Speed | V8 | Fast only on a GraalVM JDK | Varies |
| Ops | One more service | JDK choice, bigger image | Build toolchain; Java 21 records, sealed switches and Jackson reflection are hard cases |

## 3. How the Node worker works

```text
Spring (Java)                                   sim-worker (Node)
  validate submissions (section 4),
  store brains as JSON strings
  build the simulation request  --- POST /simulate (internal network) --->  pool of worker threads
                                                                            each: shared/engine + shared/gameplay,
                                                                            loaded and validated once at startup
  apply result, ratings, phase; <--- { result, replay } ------------------  runs the fight, returns JSON
  serve replay batches
```

- **Stateless.** A request carries everything: arena, seed, bots, normalized
  brains for every round so far, loadouts, `recordFromMs`. The worker
  simulates from the start of the fight to the end of the requested segment
  and records only that segment, exactly as `DuelSimulationService` does
  today. No database, no session, no memory between requests, so any worker
  can serve any request and a crash loses nothing.
- **Threads.** Node runs JavaScript on one thread, and a simulation is pure CPU
  work. The HTTP process therefore only accepts requests and hands each one to
  a pool of worker threads (`node:worker_threads`, or a small library like
  Piscina), one per CPU core. Each thread runs one fight at a time. Scaling
  out is more containers behind the same internal hostname.
- **Bounds.** The worker is reachable only from Spring (internal Docker
  network plus a shared secret). It caps body size and tick count, validates
  the request against the shared schema, and kills a thread that exceeds its
  time budget. Spring calls it with a timeout and uses the retry and cancel
  path that `MatchRoundResolutionService` already has.
- **Versions.** The worker reports its engine version (git commit plus a hash
  of `shared/gameplay`) on `/health` and in every response. Spring logs it
  with the match, and the frontend compares it with its own build to force a
  reload after an engine deploy.
- **Callers to switch:** `MatchSimulationService`, `PuzzleAttemptService` and
  `PuzzleOutcomeEvaluator`.
- **Spring side:** no new executor. The call happens where
  `MatchSimulationService` calls `DuelSimulationService` today, through an
  HTTP client with a timeout and a concurrency limit about the size of the
  worker pool.

## 4. Brain validation: one schema, Spring checks

The worker only simulates. Spring keeps validating submissions at submit time,
so players get errors immediately and submitting does not depend on the worker.
The rules are written once, as data:

- `shared/schemas/brain.schema.json` (JSON Schema 2020-12) is the only definition of a
  valid brain: types, required fields, closed lists (`enum`/`const`), bounds on
  every number and array, `oneOf` per condition and action type, `$ref`
  recursion for branch children, and `additionalProperties: false` everywhere,
  so smuggled fields are rejected.
- **Spring** loads it once at startup (Maven resource `schemas/`, like `shared/gameplay`)
  and validates with `com.networknt:json-schema-validator`. Only what a schema
  cannot express stays in Java: maximum depth, totals across the tree, and
  references (actions use loadout abilities, resets name existing variables).
  Guards run first: request size limit and a low Jackson nesting limit. The
  brain stays a `JsonNode`; it is stored as a JSON string (`brain_payload`)
  exactly as validated.
- **The worker** checks the same schema with `ajv` as a guard; a bad brain
  fails the simulation cleanly. **The editor** uses `ajv` too, for live errors.
- **Fixtures:** `shared/brain-tests/` holds valid and invalid brains that both
  sides must classify the same way.
- **Versions:** additive schema changes are safe. A breaking change gets a new
  schema per `brain_schema_version` or a migration of stored brains. Spring and
  the worker compare schema hashes and refuse to simulate on a mismatch.
- Check Jackson 3 support in networknt first (Spring Boot 4 uses
  `tools.jackson`); options if missing: Jackson 2 for validation only, another
  validator, or a small walker for the keywords used.

## 5. Replays straight from the engine

Today the Java engine records frames into Java DTOs (`MatchReplayDTO`,
`ReplayMappingService`, about 650 lines of records and mapping). The frontend
then hydrates them back into shapes Pixi can draw (`replayPresentation.js`:
`hydrateReplayBot`, ability visual and target reconstruction). That is two
translations of the same state, in two languages.

With one engine:

- The engine defines **one render frame**: the plain JSON view of bots and
  entities for one tick. The practice room draws that frame live; the worker
  records the same frames for replays. Pixi has one input format.
- The worker returns `{ result, replay }`. `result` is a small typed summary
  Spring needs (winner, per-team HP, KO or decision, segment end, engine
  version). Replays are not stored: as today, a match re-simulates from its
  seed and stored brains.
- The worker slices the replay into 1-second batches (`sequence`, `endMs`,
  `terminal`, `frames`), which `MatchReplayService` does today. Spring parses
  only those three fields and keeps each batch's frames as a raw JSON string.
  It still decides who may see which batch and when (the reconnect lookahead
  and result reveal stay in Spring), and writes the strings out unchanged.
- The compact format moves into the engine: a static initial state plus small
  per-tick frames (what `CompactReplayRecorder` does today). If size matters,
  frames can later be deltas against the previous frame; the frontend undoes
  that with the same engine module, so it is still one format.
- `ReplayMappingService`, the replay DTO records and most of the frontend
  hydration code are deleted.

## 6. Optimizing the JS engine

Measured 2026-10-08 in Node 20 on the current browser engine, full 1,200-tick
matches (all six segments):

| Scenario | Time |
| --- | --- |
| Mixed duel | ~370 ms |
| Zones (Orbital, Null Zone, Frost) alone | ~300 ms |
| Zones after other scenarios ran in the same process | ~4,000 ms |

The base speed is fine. The 10x slowdown when different matches share one
process is not: a long-running worker runs exactly that mix. The CPU profile is
dominated by shape conversion and copying, not by gameplay.

### Baseline (O1, `npm run bench`)

Measured 2026-10-08 in Node, all 20 golden scenarios at 1,200 ticks, combat log
off, one process, three passes in fixed orders (forward, reversed, rotated by
half). `npm test` runs one pass with a 10 s per-scenario budget
(`SCENARIO_BUDGET_MS` in `engineBenchmark.test.js`). Total ms per pass:

| Pass | Total | Fastest scenario | Slowest scenario |
| --- | --- | --- | --- |
| 1 (forward) | 39,705 | 280 (stun-repelling-blast) | 4,571 (duel-mixed) |
| 2 (reversed) | 60,306 | 2,307 (dash-chain) | 4,146 (duel-mixed) |
| 3 (rotated) | 60,616 | 2,206 (stun-repelling-blast) | 4,836 (duel-mixed) |

In pass 1 the first scenarios of the process run at about 300-480 ms each; once
the process has run a few different scenarios, every later scenario costs 2,200-4,800 ms
(a scenario that took 280 ms in pass 1 takes 2,624 ms in pass 2). That is the
mixed slowdown this section is about.

After O2 (brains normalized once): pass totals 36,968 / 59,846 / 52,620 ms
(before: 39,705 / 60,306 / 60,616). A small gain inside run-to-run noise; the
mixed slowdown is unchanged, so it comes from the bot/state shapes (O3, O5, O6),
not from normalization.

After O3 (one bot format; `modelPayloads/botState.js`): pass totals 4,388 / 4,077 / 4,725 ms
in this run (O1 baseline run: 5,848 / 5,256 / 5,425 on the same machine). Goldens unchanged.
Every bot is the flat object `createBotState` builds, with `kind: "bot"`; `toSimulationBotShape`,
`toCanonicalBotShape`, `mergeBotShapeUpdates` and the nested `health`/`stats`/`transform` bot fields are
gone. The brain payload keeps its own nested `health`/`stats`/`transform` until O4.

After O5 (mutable state inside the tick; `createFight`, the mutators in `effects.js`): pass totals
1,632 / 1,261 / 1,265 ms (before, same machine and run: 3,042 / 2,653 / 2,613). Goldens unchanged.
Bots and entities are changed in place; `fight.frame()` is the only place new objects are made for callers,
and nested values (status lists, ability records) are replaced rather than edited, so a frame stays valid
while the fight runs. The cross-entity reads that used to rely on copies are explicit now: the brain
snapshot, the copy of the entities a pass reads (`tickRun`), and the bots' target view (`botTargetView`).

### What makes it slow

1. **Two bot formats, converted every tick.** The engine works on a flat bot
   (`toSimulationBotShape`), but the tick returns a nested one
   (`toCanonicalBotShape`: `health`, `stats`, `transform`), so every bot is
   unpacked at the start of each tick and repacked at the end. These two
   functions are the top of the profile (about 25%).
2. **A third format for the brain.** `strategyStatePayload.js` builds a
   separate payload per bot for the brains every tick and deep-freezes it
   (`freezePayload`, about 4-6%).
3. **Brains normalized every tick.** `actionSelector.js` calls
   `normalizeConfiguration` on every decision (`normalizeBranches` shows in the
   profile), and `decide` normalizes again through `hasAbilityStrategyActions`.
   The server normalizes once (`BrainNormalizer`).
4. **Copy on every change.** Systems return `{ ...bot, field }` for each small
   change, so a bot is copied many times per tick. Most of those objects die
   immediately (garbage collection shows in the profile).
5. **Defensive re-defaulting.** Hot code is full of `Number(x ?? default)` and
   format checks (`isSimulationBotShape` tests six different identities),
   because state can arrive in several shapes.
6. **Objects of many shapes.** Conditional spreads (`...(cond ? {a} : {})`)
   and optional fields give objects of the same kind different hidden classes.
   V8 then gives up on optimizing the functions that read them
   (megamorphic access), which is the likely cause of the 10x slowdown.

### Principles

These are the same rules that made the shared data work, applied to runtime
state:

- **One state shape, defined once.** Each bot and each entity has exactly one
  format, built by one factory with every field present (`null` when it does
  not apply). The engine, the brain snapshot, the render frame and the replay
  all use it. No canonical/simulation/payload variants and no converters.
- **Normalize at the edge, once.** Brains, loadouts and ability lookups are
  normalized and indexed when a fight is created (as Java does), never during
  a tick. Inside the engine, state is trusted: no `?? default`, no
  `Number(...)`, no format detection.
- **Mutable inside the tick, read-only between ticks.** Like the Java engine's
  `Bot`, the engine updates its own working state in place during a tick.
  Brains read a snapshot of the start of the tick (needed for determinism):
  the engine keeps two copies of the small numeric state, or copies once per
  tick, instead of every system copying. Callers outside the engine (React,
  the worker) receive the frame produced at the end of the tick; that is the
  only place new objects are made for them.
- **Stable object shapes.** Fixed field sets, created in the same order, with
  no conditional spreads in hot code, so V8 keeps its optimizations.
- **One mutator per kind of change.** Each change to a combatant (a bot or an HP
  entity) has exactly one function: `dealDamage`, `heal`, `applyStatus`,
  `interrupt`, `displace`. Bots and entities share the combat fields (`x`, `y`,
  `rotation`, `hp`, `maxHp`, `statusEffects`, `damageTakenThisTick`), so these
  functions do not branch into a bot path and an entity path. The few rules
  that only apply to one kind (hit stagger and reflection for bots, resetting a
  summon's timers) are steps inside the same function. Every caller (effect
  registry, closing zone, reflection, act stage) imports these functions
  directly; nothing is passed around as a `combat` hook.
- **Precompute what the data already knows.** Ability by ID, entity phase by
  ID, hitbox geometry and status presets are built when the data loads, not
  looked up or rebuilt per tick.
- **Freeze in tests, not in production.** Deep freezing catches mutation bugs;
  run it under a test flag, never on the hot path.
- **Measure, and let the goldens judge.** No optimization may change a golden.
  A benchmark test runs mixed scenarios back to back in one process and fails
  above a time budget, so the slowdown cannot come back.

### Stages

| Stage | What | Check |
| --- | --- | --- |
| O1 | Benchmark test: every golden scenario at full length, mixed, repeated in one process; record the baseline | Benchmark runs in `npm test` (budget loose at first) |
| O2 | Normalize brains and loadouts once per fight; remove per-tick `normalizeConfiguration` | Goldens unchanged; benchmark faster |
| O3 | One bot format: remove `toSimulationBotShape`/`toCanonicalBotShape` and the nested shape; React, Pixi and replay read the flat bot | Goldens unchanged; UI checklist |
| O4 | One brain snapshot built from the same format, built once per tick, frozen only in tests | Goldens unchanged |
| O5 | Mutable working state inside the tick; start-of-tick snapshot for brains; frame produced at the end | Goldens unchanged; benchmark |
| O6 | Stable shapes: factories with every field, no conditional spreads in hot code; precomputed lookups | The mixed slowdown is gone; budget tightened |

After O6 (stable shapes and precomputed lookups): pass totals 1,579 / 1,227 / 1,221 ms (before, same machine:
1,594 / 1,250 / 1,231; the mixed slowdown was already gone after O5, so O6 changes little in time). Goldens
unchanged. Slowest scenario 118 ms on the coldest pass, 66-110 ms later; the `npm test` budget is now 450 ms per
scenario (about 3x the cold figure). Entities have one factory shape (`createEntity`: 49 fields, fixed order,
`null`/neutral when unused; the shot, event and damage-multiplier fields no longer appear later), statuses have one
shape (`normalizeStatusEffect`), phases and trigger hit verbs are indexed in the contract registry, and the stat
records effects read are built once per phase. `legacyAbilityFields` and the test helper are gone; tests build
`abilityState` records. Still variable by design: ability records (stage-dependent fields) and effect entries
inside a status. `Number(x ?? default)` is removed only for bot/entity `x, y, rotation, size, hp` and entity timers
(35 sites); the rest stays because many tests and replay paths pass partial literals (see the report).

O3 and O5 are the big ones. O1, O2 and O4 are small and pay off on their own.

## 7. Migration stages (after launch feedback)

| Stage | What | Exit check |
| --- | --- | --- |
| E0 | Schemas in `shared/`: the brain (section 4, used by Spring and the editor right away), the simulation request and `{ result, replay }` | Brain fixtures agree on both sides |
| E1 | Move the engine core into `shared/engine/` with no browser imports; frontend imports it | Frontend tests and goldens unchanged |
| E2 | `sim-worker/` Node service (HTTP, thread pool, bounds, version) and Docker service | Worker passes all golden scenarios |
| E3 | Shadow mode: Spring runs the Java engine (authoritative) and the worker for every match and puzzle, compares results, logs differences | Zero differences across a few thousand real and fuzzed matches |
| E4 | Worker becomes the authority; Java engine kept behind a flag as fallback | Correct ratings and replays in production for a period |
| E5 | Delete the Java simulation, `BrainNormalizer`, replay mapping and batching, the Java golden runner and the parity report; the frontend reads worker replays directly | Server tests cover the Spring/worker boundary |

```text
shared/
  gameplay/          data (exists)
  gameplay-tests/    golden scenarios (exists)
  engine/            tick stages, verbs, entities, effects, findTargets, ability state,
                     stamina, brain runtime, render frames, replay recording
frontend/            imports shared/engine (practice room, training, replay)
sim-worker/          Node service around shared/engine
server/              Spring; calls sim-worker
```

## 8. Risks

- Spring's validator and the engine must agree on what a valid brain is. The
  shared schema and fixtures (section 4) cover structure; the few Java
  cross-checks are covered by the fixtures only.
- Deterministic math: no `Math.random`, wall-clock time or key-order
  dependence. If Firefox/Safari preview drift ever matters, use one
  deterministic sin/cos/atan2 in the engine.
- One more service to deploy and monitor. Latency is one internal call per
  round, which is small next to round timing.

## 9. Sonnet prompts

Rules for every stage:

- Goldens must not change unless the stage says so (`npm run golden:update`
  regenerates; review and explain any diff). The parity test stays green until
  E5 removes it.
- `npm test` lists test files explicitly in `frontend/package.json`: add every
  new test file there.
- Run `npm test`, `npm run lint` and `npm run build` in `frontend/`, and
  `.\mvnw.cmd test` in `server/` when server code changes. Don't commit.
- UI-touching stages: check practice room (both slots), match testing and
  replay against `docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`.

### O1: Benchmark

```
Botfight frontend. Plan: docs/ONE_ENGINE_PLAN.md section 6.
Add an engine benchmark using testing/goldenScenarioRunner.js runScenario (log off):
every scenario in shared/gameplay-tests/goldenScenarios.json at 1,200 ticks, all in
one process, three passes in a fixed mixed order (so different scenarios share the
process, which is what shows the slowdown). Print ms per scenario per pass.
- `npm run bench` prints the full table.
- A test in npm test runs one mixed pass and fails above a loose budget
  (10 s per scenario for now; the budget is one constant).
Write the measured baseline into section 6 of the plan. No engine changes.
```

### O2: Normalize brains once

```
Botfight frontend. Plan: docs/ONE_ENGINE_PLAN.md section 6, "normalize at the edge".
Brains are normalized on every tick: botlogic/code/runtime/actionSelector.js calls
runtime.normalizeConfiguration on each decision, and arenaPreviewSimulation.js
decide() normalizes again through hasAbilityStrategyActions.
- Normalize each bot's configuration once, when the preview fight is set up or the
  configuration changes (practice room edits), and pass the normalized form into the
  tick. The selector and decide() take normalized input and never normalize.
- Keep the editor's normalization where it is (it runs on edit, not per tick).
Goldens unchanged. Report the benchmark before/after.
```

### O3: One bot format

```
Botfight frontend. Plan: docs/ONE_ENGINE_PLAN.md section 6, "one state shape".
Bots exist in two formats: flat (toSimulationBotShape, used by the systems) and
nested (toCanonicalBotShape: health/stats/transform), converted every tick in
modelPayloads/arenaPreviewSimulation.js.
- Make the flat format the only one. One factory (createBotState) builds a bot with
  every field present (null when not applicable). Remove toSimulationBotShape,
  toCanonicalBotShape, mergeBotShapeUpdates and the nested fields.
- Replace the identity checks (isSimulationBotShape, isArenaBotShape, isBotShape test
  six identities) with one explicit kind field set by the factory.
- Update every reader: Arena.jsx, setup/ArenaSetup.js, modelPayloads/previewBaseline.js,
  strategyStatePayload.js, pixi (PixiCanvas, pixiVisualState, renderers),
  replay/replayPresentation.js (hydrateReplayBot maps server replays into the flat
  bot; it stays the only converter until E5).
- practiceRoomStorage: shapes saved in the old nested format must still load
  (convert once on load).
- Entities too: ecs/entities/EntityWorld.js withComponentState mirrors every entity's
  flat fields into a `components` object (transform, motion, lifetime, health).
  Remove the mirror (only strategyStatePayload.js reads it) and give entities one
  factory with every field present. Bots and entities use the same names for the
  shared combat fields (x, y, rotation, hp, maxHp, statusEffects,
  damageTakenThisTick), so O5's mutators work on both.
Goldens unchanged. Report the benchmark before/after. Run the UI checklist.
```

### O4: One brain snapshot per tick

```
Botfight frontend. Plan: docs/ONE_ENGINE_PLAN.md section 6.
modelPayloads/strategyStatePayload.js builds a payload per actor per tick and
deep-freezes it (freezePayload).
- Build the start-of-tick snapshot once per tick from the flat bot format. Per-actor
  views (who is "player", who is "opponent") are thin views over that one snapshot,
  not copies.
- Deep freezing runs only when a test flag is on (one exported setter the tests
  call); never in the practice room or a worker.
- Keep the values conditions read exactly the same (stateVariableResolver,
  legacyAbilityFields).
Goldens unchanged. Report the benchmark before/after.
```

### O5: Mutable state inside the tick

```
Botfight frontend. Plan: docs/ONE_ENGINE_PLAN.md section 6, "mutable inside the tick".
- Add an engine object: createFight(setup) owns the bots and entities;
  fight.step() advances one tick through the seven stages, changing fields in place;
  fight.frame() returns new plain objects (the render frame) for callers.
- decide() reads the start-of-tick snapshot from O4. Code that compares before and
  after (hpNetChangeLastTick, damage taken, settle) reads the snapshot for "before".
- One mutator per kind of change (plan section 6), in ecs/abilities/effects.js,
  writing in place and used for bots and HP entities alike:
  - dealDamage(target, amount, source): replaces applyDamageToShape,
    applyDamageFromShapes (reflection becomes a step inside) and the inline entity
    damage in effects.js applyDamage. Immunity, modifiers, rounding, the combat log,
    the damage counters, hit flash/particles and hit stagger stay, in today's order.
  - applyStatus(target, preset, ...) (from applyStatusPreset + upsertStatusEffect),
    interrupt(target, ...), displace(target, ...), heal(target, ...): one function
    each, no isBotShape branches into separate paths.
  - The effect registry, ClosingZoneSystem, reflection and the act stage import them
    directly; remove the `combat` hook object (combat.applyDamageToShape etc.).
  - List any other place that still changes hp, statusEffects or position outside
    these functions, and route it through them.
- Convert the systems from `{ ...bot, field }` to in-place writes, one system at a
  time with goldens checked after each: the mutators above first, then
  ActionExecutionSystem, bot status, resource, lifecycle and state systems,
  StaminaSystem, verbs.js, AbilityEntitySystem.
- Callers never receive working objects: hooks/useArenaAutoPlay.js keeps the fight in
  a ref and puts fight.frame() into React state. Remove advanceArenaPreviewTick when
  nothing needs it (tests may use the fight object directly).
Goldens unchanged. Report the benchmark before/after. Run the UI checklist.
```

### O6: Stable shapes and precomputed lookups

```
Botfight frontend. Plan: docs/ONE_ENGINE_PLAN.md section 6.
- Check that bots and entities have every field present from their factories (O3),
  in the same order.
- Remove the old loose ability fields from the frontend: delete legacyAbilityFields
  (gameconfig/AbilityState.js, used by no production code) and the test helper
  testing/legacyAbilityShape.js; rewrite the tests that use it to build abilityState
  records directly. Bot-logic conditions keep their values (they read abilityState
  through the AbilityState helpers).
- In engine code (ecs/, gameconfig/, modelPayloads/, botlogic/code/runtime/), remove
  conditional spreads (`...(cond ? {...} : {})`) and `Number(x ?? default)` on state
  the engine created itself. Keep checks at the edges (setup, storage, replay input).
- Precompute at data load: ability by ID, entity phase by ID, hitbox numbers, status
  presets. No per-tick find() over the ability list.
- Confirm the mixed-process slowdown is gone with the O1 benchmark (and
  node --trace-deopt if it is not), then tighten the budget to about 3x the
  measured time.
Goldens unchanged. Report the benchmark before/after.
```

### E0: Schemas (brain, request, response)

```
Botfight, both sides. Plan: docs/ONE_ENGINE_PLAN.md sections 4 and 5.
- shared/schemas/brain.schema.json (JSON Schema 2020-12) from today's rules in
  server BotSubmissionValidationService and frontend botlogic/code/configuration
  (validation.js, normalization.js, constants.js, chainValidation.js):
  additionalProperties false everywhere, bounds on every number and array, oneOf per
  condition/action type, $ref recursion for branch children.
- Server: pom resource copies ../shared/schemas to classpath schemas/. Validate
  submissions with com.networknt:json-schema-validator, loaded once at startup.
  Check Jackson 3 (tools.jackson) support first; if missing, stop and report the
  options. Keep in Java only depth, totals and cross-references (loadout abilities,
  variable resets, slots). Keep the request size limit; set a low Jackson nesting
  limit on the submission endpoint. Error messages keep their JSON paths.
- Frontend: the editor validates with ajv against the same file.
- shared/brain-tests/: valid and invalid brain fixtures (each invalid one names the
  rule it breaks); a server test and a frontend test must classify them identically.
- shared/schemas/simulation-request.schema.json and simulation-response.schema.json
  ({ result, replay } with 1-second batches: sequence, endMs, terminal, frames), from
  DuelSimulationService's request records and MatchReplayService batching. A server
  test checks that today's requests validate.
Run all tests. Don't commit.
```

### E1: Engine package and match loop

```
Botfight. Plan: docs/ONE_ENGINE_PLAN.md sections 3, 5 and 7.
- Move the simulation core into shared/engine/ (ES modules, no React, Pixi or DOM
  imports; add a lint rule that enforces it): the fight object from O5, ecs systems,
  gameconfig runtime, botlogic runtime and planner, combat log. The frontend imports
  it; vite already allows ../ paths.
- Port the match loop from server DuelSimulationService.simulate into
  shared/engine/simulateFight.js: six 20 s segments, brain/loadout swap and variable
  resets per round, seed use, recordFromMs, KO and HP-decision endings. Input and
  output follow the E0 schemas; replay frames are fight.frame() batched per 1 s.
- Test: simulateFight on the golden scenarios matches the goldens; a segmented test
  mirrors SegmentedSimulationTest.
Goldens unchanged. Run all tests. Don't commit.
```

### E2: sim-worker service

```
Botfight. Plan: docs/ONE_ENGINE_PLAN.md section 3.
- sim-worker/: Node 20 service. POST /simulate and GET /health on node:http (or a
  small framework). A Piscina pool (one thread per core) runs shared/engine
  simulateFight; the main thread only handles HTTP.
- Bounds: shared-secret header, body size cap, tick cap, per-task timeout that
  terminates the thread, ajv validation of the request against E0's schema (bad
  input is a 400, never a crash).
- /health and every response report the engine version: git commit plus a hash of
  shared/gameplay and shared/schemas.
- docker-compose: sim-worker service with additional_contexts shared, `expose` only
  (no public port), healthcheck. Backend gets SIM_WORKER_URL and the secret.
- Tests: the worker answers every golden scenario over HTTP and matches the browser
  golden; oversized, malformed and slow requests are rejected.
Run all tests and docker compose build. Don't commit.
```

### E3: Shadow mode

```
Botfight server. Plan: docs/ONE_ENGINE_PLAN.md section 7.
- SimWorkerClient (RestClient): timeout, concurrency limit about the worker pool
  size, secret header. Config sim.worker.mode = off | shadow | authority (default off).
- shadow: after the Java simulation in MatchSimulationService and the puzzle
  services, call the worker off the request thread and compare outcome, winner,
  per-team HP and per-tick state hashes (the worker returns them when asked; Java uses
  the same hash as the golden runners). Log each mismatch with matchId, round and
  first differing tick; count matches and mismatches in a metric. The Java result
  stays authoritative; worker failures never affect the match.
- Add a test-only fuzz harness: random valid brains built from the brain-tests
  fixtures and loadouts, run both engines, report differences.
Run all tests. Don't commit.
```

### E4: Worker becomes the authority

```
Botfight, both sides. Plan: docs/ONE_ENGINE_PLAN.md sections 3 and 5.
- sim.worker.mode=authority: MatchSimulationService, PuzzleAttemptService and
  PuzzleOutcomeEvaluator use the worker. Failures go through the existing retry and
  cancel path; there is no silent fallback to Java (switching back is the config
  flag).
- Spring parses `result` into a record and each batch's sequence/endMs/terminal;
  frames stay raw JSON strings. MatchReplayService gates batches by time as today
  (reconnect lookahead, result reveal) and writes the strings unchanged.
- Frontend replay reads worker frames directly (same format as the practice room);
  remove hydrateReplayBot and the visual/target reconstruction in
  replayPresentation.js.
- Version reload: Spring sends X-Build-Version on every response; the frontend
  reloads (after a short notice) when it differs from its own build.
Run all tests and docker compose build. Don't commit.
```

### E5: Delete the Java simulation

```
Botfight. Plan: docs/ONE_ENGINE_PLAN.md section 7. Only after authority mode has
run correctly in production.
- Delete the Java simulation (server .../simulation core, ecs, the engine parts of
  gameconfig), BrainNormalizer, ReplayMappingService and the replay DTO records and
  batching that the worker replaced, AbilityState.legacy* and the LegacyAbility test
  helper, the Java golden runner, golden.server.json and the parity report. Delete only what nothing outside the simulation uses; list what
  you kept and why (for example CompactAbilityCode, loadout pools, the schema
  validator).
- Remove sim.worker.mode off/shadow.
- Update AGENTS.md (no browser/server parity rule; one engine in shared/engine),
  the context maps and docs/ABILITIES.md (one engine, how to add an ability now),
  and delete this plan.
Run all tests and docker compose build. Don't commit.
```
