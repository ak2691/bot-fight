# Gameplay Overhaul: Codebase Migration Outline

Status: planning outline, nothing changed yet. It maps today's codebase (2026-10-10) onto the MVP design in
[`design/`](design/README.md). It's a map for planning, not a task list. Confirm symbols in code before
changing anything. Updated 2026-10-10: the design now replaces the engine, the brain model and puzzles too.

## 1. The big shift

Today's codebase is built around **live, synchronous matches**: a queue pairs two online players, a
WebSocket session drives a draft, build clocks and six segments, and Spring holds match state in memory under
locks and deadlines.

The new game is **asynchronous and batch-driven**: players build in a garage whenever they like, and the
server runs cups and ladder games as scheduled batches from Postgres. Nobody has to be online at the same time
as anyone else.

Consequences:
- **Most of the real-time machinery goes:** the queue, live sessions, reconnects, build deadlines, the round
  draft, surrender votes, match chat and code-view snapshots. That's the largest and most complex part of the
  server today (`service/match/` alone is about 40 files).
- **WebSockets shrink to notifications** (or go away entirely; section 5).
- **The engine and the brain model are replaced** by a new physics engine (`shared/sim/`) and the modes-and-rules
  brain ([design/03](design/03-physics.md), [design/06](design/06-programming.md)). Their infrastructure survives:
  the worker's transport and admission, the engine lint rules, schema generation, golden-test tooling.
- **What survives is the solid core:** auth, sessions, profiles, blocks, notifications, the scheduler and
  startup-recovery pattern, replay delivery, the Pixi application shell.

**The game hasn't launched publicly**, so there is no player history to preserve. Old match data can be
dropped rather than migrated (owner to confirm, section 8).

## 2. Server (Spring), area by area

Legend: **Keep** (unchanged or nearly), **Change** (same responsibility, new inputs), **Replace** (the
responsibility moves to a new service), **Remove**.

| Area | Today | Fate | Notes |
|---|---|---|---|
| `service/auth/`, `security/`, `config/` | Sessions, CSRF, verification, password reset | **Keep** | WebSocket security config shrinks with sockets |
| `service/limits/` | Rate limits | **Keep** | New limits: bots, versions, sparring per day, cup entries |
| `service/cache/` | Read-model caching | **Keep** | |
| `service/simulation/` | Worker client, admission, versions, replay envelopes | **Change** | New request shape (ruleset, spawn layout, builds); called by the game queue dispatcher instead of live matches |
| `service/submission/` | Match-bound brain submissions, schema + worker validation | **Replace → `garage/`** | The validation pipeline (`BrainSchemaValidator`, worker `/validate`, `SubmissionJsonReader`) is kept and extended to whole builds. The match-bound submission flow goes. |
| `service/rating/` (`EloRatingService`) | Per-player Elo from live matches | **Replace** | Builder Rating: Glicko-2 per player, one rating period per cup (`rating/`); a separate per-bot ladder rating (`ladder/`) |
| `service/puzzle/` | Puzzle authoring, list, completions | **Replace** | The Academy and the Daily Gauntlet, as content files in `shared/content/` ([design/08](design/08-competition.md), [design/09](design/09-social-and-progression.md)). Puzzle tables and admin authoring retire once the Academy exists |
| `service/profile/` | Profile data | **Change** | Adds bots, cup history and season badges |
| `service/block/` | User blocks | **Keep** | Still needed for challenges, invites and private cups |
| `service/notification/` | Notification fan-out | **Change** | New events: cup brief, lock reminder, stage results, twist drawn, adapt window closing, finals premiere, challenge and gauntlet results |
| `service/invite/` | Invite plumbing | **Change** | One generic invite for challenges and private cups (section 4) |
| `service/matchmaking/` | FIFO queue, pools, participation | **Remove** | Pairing moves to Swiss (cup) and rating-based sampling (ladder), both server-side batches |
| `service/match/` (lifecycle, phase, timing, scheduler, loadout, round resolution, code view, chat, connection, reconnection, event, state, startup recovery, replay, persistence) | Live match engine | **Remove**, except two ideas reused | The scheduler pattern (server-time transitions) and startup recovery carry over into `cup/`. Replay authorization moves to `replay/`. |
| `service/party/` | Transient party state (tables already dropped in V59) | **Remove** | No live queue to party up for |
| `service/customlobby/` | Live custom lobbies, teams, lobby chat | **Replace** | Challenges and private cups (section 4) |
| `service/chatmoderation/` | Reports, evidence, admin review | **Decide** (section 5) | Only needed if a chat or comment surface remains |
| `service/websocket/` | STOMP socket registry | **Shrink or remove** (section 5) | |
| `service/system/` | System endpoints | **Keep** | |
| **New** | | `content/`, `garage/`, `game/`, `cup/`, `rating/`, `ladder/`, `gauntlet/`, `challenge/`, `social/`, `progression/`, `academy/`, `replay/` | [design/10](design/10-architecture.md#spring-services) |

### Controllers

| Controller | Fate |
|---|---|
| `AuthController`, `ProfileController`, `UserBlockController`, `TimeController` | Keep (`TimeController` still shows server-time countdowns for locks and deadlines) |
| `PuzzleController`, `AdminPuzzleController` | Keep until the Academy replaces puzzles, then remove |
| `BotSubmissionController` | Replace with garage endpoints (bots, versions, validation) |
| `MatchmakingSocketController`, `MatchmakingSocketDestinations`, `MatchStatusController` | Remove |
| `PartyController`, `PartyInviteController` | Remove |
| `CustomLobbyController`, `CustomLobbyInviteController`, `CustomLobbySocketController` | Replace with challenge and private-cup endpoints |
| `ChatReportController`, `AdminChatReportController` | Depends on the chat decision |
| **New** | Content, garage, cup, gauntlet, ladder, challenges, friends, profile/rating, academy, replay, archive ([design/10](design/10-architecture.md#api-sketch)) |

### Database

Flyway is append-only, so removals are new migrations, never edits.

| Today | Fate |
|---|---|
| `AppUser`, `EmailVerification`, `PasswordResetRequest`, `UserAuthIdentity`, `UserRole` | Keep |
| `UserBlock`, `Profile` | Keep (profile gains fields) |
| `Puzzle`, `PuzzleBot`, `PuzzleBotRole`, `PuzzleCompletion`, `PuzzleStatus` | Drop once the Academy replaces puzzles |
| `Match`, `MatchParticipant`, `MatchResult`, `MatchRoundBotCode`, `MatchMode`, `MatchStatus` | Drop (pre-launch data) |
| `BotSubmission`, `BotSubmissionStatus` | Replace with `bot` and `bot_version` |
| `PlayerRating` | Replace with `player_rating` (Glicko-2) and `rating_history`, plus `ladder_bot` |
| `ChatReport`, `ChatMessageEvidence`, `ChatModerationAudit` and enums | Depends on the chat decision. Check the retention rules in [`CHAT_MODERATION.md`](CHAT_MODERATION.md) before dropping evidence. |
| **New** | As listed in [design/10](design/10-architecture.md#data-model): `bot`, `bot_version`, `game` (also the queue), `season`, `cup*`, `player_rating`, `ladder_bot`, `gauntlet*`, `challenge`, `rivalry`, `friendship`, progression tables, `academy_progress` |

## 3. Shared engine, worker and schemas

| Area | Fate | Notes |
|---|---|---|
| `shared/engine/` (fight, ECS, abilities, botlogic, planner, loadout, simulateFight) | **Replace** with `shared/sim/` | A new deterministic 2D physics engine with parts, weapons, sensors, hazards and the modes-and-rules brain ([design/03](design/03-physics.md), [design/10](design/10-architecture.md#packages)). Keep the engine lint rules (extended with the determinism bans) and the golden-test approach |
| `shared/gameplay/` (abilities, statuses, channels, movement) | **Replace** with `shared/content/` | Parts, weapons, sensors, rulesets, arenas, twists, seasons, house bots, gauntlets, Academy |
| `shared/schemas/` | **Replace contents, keep tooling** | Build, brain, ruleset, arena, season, simulation request/response and replay schemas; keep generation and the stale-schema test |
| `shared/gameplay-tests/`, `shared/brain-tests/` | **Replace** | New golden games and build/brain fixtures |
| `sim-worker/` | **Change, slightly** | Same transport, auth, bounds and pool; `/simulate` and `/validate` take the new request shapes; `/version` reports engine and content versions |
| Replay batching | **Simplify later** | Replays are re-simulated on demand and returned whole; drop batching when the new replay path lands |

## 4. Social features in the new game

| Today | New game | Why |
|---|---|---|
| **Matchmaking queue** | **None.** Cups and the ladder pair bots on the server. | No one needs to be online at the same time |
| **Parties** | **Removed.** | Parties exist to queue together; there's no queue |
| **Custom lobbies** | **Challenges** first, **private cups** later | |
| ↳ Challenge | Pick one of your bots and a friend's challengeable bot, a rules preset or custom knobs, single game or best of 3/5, optionally a mirror match ([design/09](design/09-social-and-progression.md#challenges)) | Asynchronous; the friend's code stays private; runs on the game queue |
| ↳ Scrim rooms (after the MVP) | Live rooms with synchronized watching and Blitz Build | Today's custom-lobby realtime code is a useful reference (keep it in git history) |
| ↳ Private cup | A user schedules a cup with its own lock time, arena and twists from the catalogue, and shares an invite link. It runs on the same `cup/` code as the weekly cup. | Clubs, schools and friend groups. Halite's private leaderboards served the same need. |
| **2v2 / teams** | **Not in v1.** | Team cups (two players' bots fighting together) are a possible later mode. They'd need team entries and 2v2 games on the same game table. |
| **Match chat, lobby chat** | **Removed** with live matches. | |
| **Blocks** | **Kept.** | Blocked users can't challenge or invite you |
| **Notifications** | **Kept and repurposed** (section 2) | The cup's weekly rhythm depends on them |
| **Profiles** | **Expanded:** bots, cup results, season badges, published bots | Profiles are where attachment shows |

## 5. Real-time and chat decisions

**WebSockets.** Without live matches, the only push need is notifications ("Stage 1 results are in").
Options:
- **Keep STOMP for notifications only.** It's already built and secured; just delete the match destinations.
- **Replace it with polling or server-sent events.** Simpler infrastructure, at the cost of a rewrite.

Recommendation: keep STOMP, cut it down to notifications, and revisit only if it causes trouble.

**Chat and moderation.** With no live matches or lobbies, there's no chat surface left. Options:
- **No chat at launch** (community on Discord). Retire chat moderation; check evidence retention first.
- **Keep a small surface** later (cup discussion, replay comments), and keep moderation for it.

Recommendation: no chat at launch. Keep the moderation module's code dormant until the retention question is
answered, then remove it or put it back to use.

## 6. Frontend, area by area

| Area | Fate | Notes |
|---|---|---|
| `auth/`, `security/`, `config/` | Keep | |
| `pages/home/` | Change | The cup's current state (brief, lock countdown, standings), your bots, notifications. `RankedMatchBlock` goes. |
| `pages/game/`, `matchmaking/` (queue, acceptance modal, build clock, loadout draft, selection phase, match chat, network delay estimator, relative timing) | **Remove** | The STOMP client stays only if notifications use it |
| `pages/customLobby/` | Replace | Challenge and private-cup pages |
| `pages/profile/` | Change | Bots, cup history, badges |
| `pages/puzzles/`, `puzzles/` | Replace | Academy and Daily Gauntlet pages |
| `pages/catalogue/` | Change | Parts, weapons, sensors and readings catalogue |
| `pages/admin/` | Change | Puzzle admin stays; chat admin depends on the chat decision. Cups don't need admin pages at first (section 7). |
| `notifications/` | Change | New event types |
| `chatModeration/` | Depends on the chat decision | |
| `tutorial/` | Rewrite later | After the game settles |
| `replay/` | Keep | Replays come from the game record and visibility rules |
| `gameArena/` (Arena, coding editor, loadout, ecs, botlogic tests) | **Replace** | The garage (builder, brain editor, sandbox in a Web Worker) on `shared/sim`. During Phase 1 only the live-match parts are removed, so practice keeps working until the garage lands |
| `gameArena/pixi/` | Keep the shell, replace renderers | Bots drawn from their parts; arena, hazards and effects layers |
| **New pages** | | Garage (bots, versions, parts builder, editor, sandbox), Cup, Ladder, Archive, Challenge |

## 7. Content and operations

- **Cups are scheduled from data, not an admin page.** `shared/content/seasons/<season>.json` lists each
  week's arena, Cup rule and three Stage 2 candidates. The cup service creates each week's cup from it, so a
  season is planned and reviewed like code. An admin page is only worth adding if schedules change often.
- **House bots** (practice milestones, beginner opponents, filler for small cups) are builds + brains in the
  repository, like golden fixtures. Puzzle bots can share the format.
- **Docker:** the same four services (Postgres, backend, frontend, worker). Cups add throughput needs, not
  components: scale worker replicas or threads during stage runs.
- **Season patch week:** engine and content changes ship together, the engine version is bumped, and golden
  scenarios are regenerated.

## 8. Docs and agent rules to update when the overhaul is adopted

- `AGENTS.md`: the always-on constraints describe six 20-second segments and live rounds. Replace them with
  the new rules (single fight, parts, cups; the server stays the authority).
- `context.md`, `server/context.md`, `frontend/context.md`, `frontend/src/gameArena/context.md`,
  `shared/engine/context.md`: routing for the new services and pages; remove matchmaking, match, party and
  custom-lobby routes.
- Retire or archive: `TIMED_ROUNDS_MATCH_FORMAT.md`, most of `MATCH_TIMING.md`, `SPRING_CLEANUP_PROMPTS.md`
  (its target code is mostly being removed), and `CHAT_MODERATION.md` if chat goes.
- Also retire when the new engine lands: `ABILITIES.md`, `CODE_WORKSPACE_REDESIGN.md`, `PLAYER_COORDINATES.md`,
  `ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md`, `LEGACY_PATH_DECISIONS.md` (replaced by `design/`).

## 9. Suggested order

Pre-launch, it's simpler to clear out the live-match stack first and build on a smaller codebase than to keep
both games running side by side.

| Phase | Work |
|---|---|
| 0 | Owner confirms decisions (below); update `AGENTS.md` and context maps |
| 1 | **Remove** matchmaking, live match, party, custom lobbies, match chat, plus their frontend; drop their tables. Practice and puzzles keep working on the old engine for now |
| 2+ | Build the new game by the milestones in [design/11](design/11-mvp-plan.md#milestones) (M0 physics prototype → M6 launch); retire the old engine, editor and puzzles when the garage and Academy replace them |

Phase 1 can start as soon as the decisions are made, because it only removes code. M0 (the physics prototype)
doesn't depend on Phase 1 and can run in parallel.

## 10. Decisions for the owner

1. Drop all old match data (pre-launch)? Recommended: yes.
2. Chat at launch? Recommended: none; check moderation evidence retention first.
3. WebSockets: keep STOMP for notifications only? Recommended: yes.
4. Challenges in v1, private cups later? Recommended: yes.
5. Team (2v2) cups: out of v1? Recommended: yes.
6. Remove the live-match stack before building the new game (phase 1 first)? Recommended: yes.
