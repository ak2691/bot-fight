# Spring server cleanup: audit and Sonnet prompts

Audit of `server/` on 2026-10-09 (27k main lines, 12.8k test lines). Run A, B and C in order, one per
fresh Sonnet session, and review and commit after each. Each run must leave `.\mvnw.cmd test`, and
`npm test` in `frontend/` when it touches a payload, green. Delete this file when the last run lands.

## Verdict

Auth, security, chat moderation, profile, ratings, blocks and the worker client are fine: small
services, CSRF on, admin routes checked, ownership enforced in services. Most of the bloat is in the
match and matchmaking path:

| Problem | Where | Size |
|---|---|---|
| ~30 "compatibility", "backward-compatible" or "fixture" constructors and overloads kept for old tests and callers. 12 Spring beans have 2 to 5 constructors | `MatchmakingEventDTO`, `MatchSession`, `MatchPlayer`, `MatchService`, `MatchmakingService.joinQueue` (8 overloads), `PartyService`, `CustomLobbyService`, `AuthController`, ... | ~1,500 lines |
| The match event DTO has 59 fields, 10 positional constructors and 7 hand-written `withX` copies | `DTO/match/MatchmakingEventDTO.java` (1,235 lines) | ~1,000 lines |
| Dead phases: the entity placement phase is never entered (`withEntityPlacement` has no callers), and best-of leftovers remain (`winsRequired`, `previousRoundWon`, `seriesComplete`, `useLegacyCreateMatch`) | match model, event factory, phase, lifecycle; frontend `selectionPhase.js`, `useMatchLifecycle.js` | ~300 lines |
| The phase is derived in five places from nullable timestamps and event-type strings, and the copies disagree (the countdown maps to `PREP` in one and `BUILDING` in another) | `MatchLifecycleService.statusForSession`, `MatchService.codeViewStatus`, `MatchEventFactory` (2), `MatchPhaseService.phaseForSession/phaseForEvent` | correctness risk |
| The controller is the round scheduler. It inspects outgoing events (`"PREP"`, `"MATCH_ROUND_READY"`, ...) to decide which timeouts, chat closures and simulation retries to schedule | `MatchmakingSocketController` (1,220 lines, ~500 of scheduling) | SRP |
| `MatchService` builds its 10 sub-services with `new` and shares one mutable `MatchRuntimeState`; sessions are keyed by user id only, so finding a match is an O(n) scan | `service/match/` | testability |
| Legacy party persistence: 3 unused repositories, `@Entity` classes used as in-memory carriers, V38 tables never written | `service/party/`, `domain/party/`, `repository/Party*` | ~350 lines |
| Two replay delivery modes. `FULL` is unused in deployment, and the `@Value` default (`full`) disagrees with `application.properties` (`batched`) | `service/match/replay/` | YAGNI |
| Puzzle rules are partly re-validated in Java (branch shapes, action counts, loadout encoding) next to the schema and `brainRules.js` | `PuzzleService` lines ~575-670, ~960-1030 | DRY |
| A hand-rolled cache class with 10 caches and manual invalidation for low-traffic reads | `service/cache/DatabaseLookupCache.java` (380 lines) | YAGNI, owner decision |

About the schemas: `shared/schemas/brain.schema.json` is 9.7k lines, but it is generated
(`npm run schema:brain`). 56 KB of its 84 KB is one `if/then` branch per condition type, and the pretty
printer puts every array item on its own line. It costs diff noise, not maintenance. Run C step 3
handles it.

## Run A: deletions

```
Botfight server (Spring Boot 4, Jackson 3): remove compatibility code, dead match state and legacy
persistence. No behavior change apart from deleting unused fields. Do the steps in order and run
.\mvnw.cmd test after each; fix failures before moving on.

1. Compatibility constructors and overloads
- Grep server/src/main/java for "Compatibility", "Backward-compatible", "Fixture constructor",
  "older callers", "@Deprecated" and "source-compatible". Delete those constructors and methods.
- Give each @Service/@Component/@Controller exactly one constructor. Remove null-dependency
  fallbacks such as `participationCoordinator == null ? new ... : ...`.
- Replace MatchmakingService.joinQueue's 8 overloads with one method taking a QueueJoinRequest
  record. Collapse the overloads of PuzzleService.listPublished/getPublished and
  MatchService.startMatch/startTeamMatch/selectLoadout/acceptMatchSubmission/submitChatMessage.
- Remove MatchmakingSocketController.scheduleSelectionTimeouts (an alias) and the no-payload
  joinQueue "old clients" entry point.
- Tests call the canonical constructor. Where many tests build the same object, add one test-only
  factory under src/test (for example TestMatches.session(...)), never a production overload.

2. Dead phases and best-of leftovers. Trace each field (server model -> MatchEventFactory ->
   MatchmakingEventDTO -> frontend consumer) before deleting it.
- Entity placement is never entered (MatchSession.withEntityPlacement/withEntityPlacements have no
  callers). Remove MatchPhase.OBJECT_PLACEMENT, the "OBJECT_PLACEMENT" status, entityPlacementEndsAt,
  entityPlacementsByUserId, entityPlacementUserId, entityPlacements, MatchmakingPlayerDTO's
  entityPlacementSubmitted, and the handling in frontend/src/matchmaking/selectionPhase.js.
- Remove winsRequired (server and frontend/src/pages/game/hooks/useMatchLifecycle.js),
  previousRoundWon and RoundBrainDTO.won if no timed-rounds UI reads them, and MatchLifecycleService's
  useLegacyCreateMatch flag. Rename seriesComplete to ended.
- Delete arenaEntities and roundBlockLimit if the frontend only passes them through.
- PuzzleService: drop the hasLegacyAction branch check (the schema rejects that field).

3. Legacy party persistence, replay mode, admin guard
- Parties are in-memory only. Replace domain/party/* (@Entity classes used as carriers) with plain
  records/classes in service/party/. Delete PartyRepository, PartyMemberRepository,
  PartyInviteRepository and domain/party. Add V59__drop_party_tables.sql dropping party_invites,
  party_members and parties (never edit V38).
- Delete ReplayDeliveryMode.FULL and the botfight.replay.delivery-mode property; keep batched only.
- SecurityConfig: guard /api/admin/** with hasRole("ADMIN"); keep the chat-report service check.

Finish with .\mvnw.cmd test, then npm test and npm run lint in frontend/. Update server/context.md
if a package disappears. Don't commit.
```

## Run B: match core

```
Botfight server: make the active-match phase explicit and move round scheduling out of the socket
controller. The JSON sent to clients must not change. Do the steps in order and run
.\mvnw.cmd test after each.

1. Event DTO builder
- First add a JSON snapshot test for 3 representative MatchmakingEventDTO events (round ready,
  replay batch, result).
- Keep the record and its JSON. Add a nested Builder with toBuilder(). Delete every secondary
  constructor, every withX method and the replayBatchPayload overloads; callers use the builder.
- MatchEventFactory builds through the builder; merge overloads that differ only in trailing
  nullable parameters. Do the same for MatchSession copy(...) helpers that forward 10+ arguments.

2. One phase field
- The phase is derived in five places that disagree (MatchLifecycleService.statusForSession,
  MatchService.codeViewStatus, MatchEventFactory near lines 66 and 522,
  MatchPhaseService.phaseForSession/phaseForEvent). Add `MatchPhase phase` to MatchSession, set only
  in transition methods (pick, build, all finished, simulating, replay, result). Delete the
  derivations.
- Map phase -> wire status in one method on MatchPhase, keeping today's strings.
- Replace event-type string literals with a MatchEventType enum (same JSON names).
- MatchPhaseService only checks legal transitions (from -> to); remove phaseForEvent.
- One test per transition asserting phase and status together.

3. Scheduler out of the controller
- MatchmakingSocketController schedules work by inspecting outgoing events
  (scheduleLoadoutSelectionTimeouts, scheduleBuildingTimeouts, scheduleMatchChatClosures,
  scheduleAuthoritativeSimulations with retries, scheduleMatchAcceptanceTimeouts, delayed
  round/result events).
- Create service/match/MatchScheduler (owns the scheduler and simulation executor) with
  schedule(matchId, phase, deadline, task), simulate(matchId, round) and cancelAll(matchId). Keep
  the current guards: stale-task check, one in-flight key per deadline, retry then cancel.
- Services call the scheduler when they set a deadline or phase, not from events.
- Add a MatchEventPublisher bean for messagingTemplate fan-out and delayed publish.
- The controller keeps @MessageMapping handlers, subscribe/disconnect listeners and error mapping;
  target under 350 lines. Move scheduling tests to MatchSchedulerTest.

Cover docs/MATCH_TIMING.md's round-transition checklist in tests. Finish with .\mvnw.cmd test and
npm test in frontend/. Don't commit.
```

## Run C: structure

```
Botfight: final structural cleanup. Run the narrowest tests after each step.

1. Match services as beans
- MatchService builds MatchChatService, MatchLoadoutService, MatchReplayService, MatchEventFactory,
  MatchSubmissionService, MatchLifecycleService, MatchPhaseService, MatchReconnectionService,
  MatchTimingService and MatchRoundResolutionService with `new`, passing lambdas and a shared
  MatchRuntimeState. Make MatchRuntimeState, MatchLockService and each sub-service a @Component with
  constructor injection; replace lambda arguments with bean dependencies; break cycles by moving the
  shared method into the lower service.
- MatchRuntimeState: Map<matchId, MatchSession> plus Map<userId, matchId>; remove the O(n) scans.
- MatchService becomes a thin facade or goes away (controllers call the owning service).
- Move the single-class packages under service/match/ into service/match/ itself, next to model/
  and state/. Update server/context.md's layer map.
- Shrink MatchServiceTest: test services directly, keep a few end-to-end tests.

2. Puzzle validation in one place
- PuzzleService.validatePuzzleLogicConfiguration, countActionNodes, countConditionNodes and
  validLoadoutEncoding re-check rules owned by shared/schemas/brain.schema.json and the engine's
  brainRules.js (worker POST /validate, puzzleRules: true). Delete each Java check that is covered;
  move any uncovered one into brainRules.js puzzle mode with an invalid fixture
  (npm run fixtures:brain). Spring keeps non-brain puzzle fields and AbilityCatalog loadout checks.

3. Generated file noise
- Add .gitattributes `linguist-generated=true -diff` for shared/schemas/brain.schema.json and
  shared/gameplay-tests/golden.browser.json.
- frontend/scripts/generate-brain-schema.mjs: move fields shared by most condition types into $defs
  and print short scalar arrays on one line. The schema must classify shared/brain-tests the same
  (BrainFixturesTest, frontend and sim-worker tests).

Finish with .\mvnw.cmd test, and npm test in frontend/ and sim-worker/. Don't commit.
```

## Later: DatabaseLookupCache (owner decision first)

```
Botfight server: service/cache/DatabaseLookupCache hand-rolls 10 caches with manual invalidation.
Replace it with Spring Cache (spring-boot-starter-cache, Caffeine, @Cacheable/@CacheEvict on the
owning services), keeping the same TTLs and size limits. Delete the class and its snapshot records
where @Cacheable can cache the DTO directly. Port DatabaseLookupCacheTest's hit/eviction cases and
keep ProfileHistoryQueryCountTest green. Run .\mvnw.cmd test. Don't commit.
```

Alternative: delete the caches that the profile and puzzle pages do not need at current traffic.

## Frontend follow-up

`frontend/src/pages/game/hooks/useMatchLifecycle.js` (1,238 lines) mirrors the server's phase
inference. After runs A and B it can read `status` directly; split it with the botfight-ui-design
skill's conventions in a separate pass.

## Gameplay backlog

S7 (multi-spawn engine and Shotgun Blast) is the only timed-rounds stage not built. Its design and
prompt are in `git show HEAD:docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md` (sections 3c and 9/S7). Owner
decisions still open there: final tuning numbers, Heavy Slash vs Cleave overlap, AFK auto-submit, the
round 1 starting brain, the tutorial rewrite, and the active/recovery time refactor.
