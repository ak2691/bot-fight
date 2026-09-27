# Machiner code audit — 2026-09-26

## Executive summary

This static audit focused on concurrency, multiplayer lifecycle integrity,
security and privacy boundaries, database access, payload size, abuse resistance,
simulation/replay bounds, coupling, and legacy code. It found three issues that
should be treated as P1 work:

1. a player is not atomically reserved at the shared match-start boundary, so a
   queue match and custom match can race and both persist;
2. ranked 2v2 matchmaking performs combinatorial selection while holding the
   global queue monitor; and
3. authoritative simulation scheduling records permanent deduplication keys and
   can make a rejected or failed simulation unretryable.

The authoritative simulation itself is bounded and server-owned. Payload limits,
WebSocket destination authorization, chat bounds, puzzle completion idempotency,
and per-match state locks are generally sound. No definite deadlock, arbitrary
code execution path, cross-user subscription bypass, or raw unexpected-exception
leak was found in the reviewed paths.

Priority meanings:

- **P1:** correctness, availability, or lifecycle integrity; address before
  significant concurrency/load.
- **P2:** important hardening or performance work; schedule next.
- **P3:** measured optimization, cleanup, or maintainability work.

This was a read-only static review. The scenarios below still need focused tests
before and after fixes. Cloud infrastructure was out of scope except for
application-visible configuration.

## P1 findings

### AUD-01 — Match starts do not atomically reserve every player

**Risk:** One player can be persisted into two concurrent matches, after which
the newer session silently replaces the older in-memory user-to-session mapping.

Queue acceptance starts a match after the final acceptance without rechecking a
shared cross-mode reservation
([MatchmakingService.java](../server/src/main/java/com/example/botfight/service/matchmaking/MatchmakingService.java#L437)).
The lifecycle persists the match and participants before publishing the session
([MatchLifecycleService.java](../server/src/main/java/com/example/botfight/service/match/lifecycle/MatchLifecycleService.java#L137)),
and `putSession` overwrites each player's existing mapping
([MatchRuntimeState.java](../server/src/main/java/com/example/botfight/service/match/state/MatchRuntimeState.java#L68)).
Custom-lobby start has its own check/start path and party detachment does not
invalidate a queue snapshot already being accepted.

**Failure scenario:** a queued player accepts a custom-lobby invitation or starts
a custom match while a queue match is pending. Both starts pass their local
checks. Both database matches exist, but reconnect, submission, timeout, and
result operations can find only the last session mapped to that user.

**Change needed:** introduce a shared atomic roster reservation at the lifecycle
start seam. Acquire reservations in stable user-ID order or use an equivalent
atomic multi-user claim. Match creation should either reserve the whole roster or
reserve nobody. Starting a custom match must cancel or reject conflicting queue
and pending-match state; release reservations on every failed start path.

**Tests:** race queue final-acceptance against custom start; race two starts with
overlapping rosters; verify only one match is persisted, all mappings agree, and
failed starts release claims.

### AUD-02 — Ranked 2v2 search is combinatorial under the global queue lock

**Risk:** A sufficiently large or rating-incompatible queue can stall all queue
joins, leaves, sweeps, and acceptances in the process.

Queue operations are synchronized, while `selectGroups` recursively examines
candidate combinations and `assignTeams` recursively tests assignments
([MatchmakingService.java](../server/src/main/java/com/example/botfight/service/matchmaking/MatchmakingService.java#L913)).
For solo-heavy candidate sets, group selection approaches O(n^4). There is no
candidate cap or strong early rating prune, and the periodic sweep repeats the
work.

**Change needed:** cap the evaluated candidate window, pre-index/prune candidates
by rating feasibility and wait time, and move expensive selection off the global
monitor. Commit a chosen selection with a short atomic validation/removal step.

**Tests:** benchmark large incompatible and mixed solo/party queues; while search
is running, assert unrelated join/leave latency stays bounded; verify fairness
and deterministic tie-breaking after pruning.

### AUD-03 — Simulation scheduling keys leak and failed work cannot retry

**Risk:** A rejected or transiently failed authoritative simulation can leave a
match in `SIMULATION_LOADING` indefinitely. Completed rounds also accumulate
controller-lifetime keys.

The controller adds `matchId:round` before executor submission and never removes
it on success, failure, or submission rejection
([MatchmakingSocketController.java](../server/src/main/java/com/example/botfight/controller/MatchmakingSocketController.java#L1083)).
The executor queue is bounded, so rejection is a real overload path. The building
and loadout timeout dedupe sets follow the same add-only pattern.

**Change needed:** make these keys represent in-flight work, not lifetime history.
Remove them in `finally`, roll back on executor rejection, and retain an
authoritative phase/claim check so already completed rounds cannot rerun. Apply a
bounded lifecycle to timeout keys as well. Define whether transient simulation
failure retries automatically or deterministically terminates the match.

**Tests:** executor rejection, fail-once-then-retry, successful cleanup, duplicate
event while in flight, stale timeout callback after phase advance, and long-run
key-count stability.

## P2 findings

### AUD-04 — Queue monitor covers database work

Final acceptance calls match creation while still inside synchronized
`acceptMatch`; match and participant persistence complete before the lock is
released
([MatchmakingService.java](../server/src/main/java/com/example/botfight/service/matchmaking/MatchmakingService.java#L437),
[MatchLifecycleService.java](../server/src/main/java/com/example/botfight/service/match/lifecycle/MatchLifecycleService.java#L137)).
Ranked join also performs rating reads under the same monitor.

**Change needed:** claim a pending match into a `STARTING` state under the queue
lock, do database work outside it, then publish success or restore/cancel state
with a short locked transition. Test with blocked persistence while unrelated
queue operations continue.

### AUD-05 — Party and custom-lobby invite maps retain terminal/expired entries

Custom-lobby invitations are inserted into an in-memory map
([CustomLobbyService.java](../server/src/main/java/com/example/botfight/service/customlobby/CustomLobbyService.java#L230)).
An expiry cleanup method exists
([CustomLobbyService.java](../server/src/main/java/com/example/botfight/service/customlobby/CustomLobbyService.java#L500))
but has no caller. Party cleanup runs hourly but removes only expired pending
invites; accepted and declined entries remain. Incoming/duplicate checks scan
these maps, so normal repeated inviting grows memory and scan time.

**Change needed:** remove terminal entries immediately, schedule custom-lobby
expiry cleanup, prune on read/write as a fallback, and cap pending invitations
per inviter, invitee, party, and lobby. Test accepted, declined, expired, and
high-volume lifetime behavior.

### AUD-06 — Puzzle simulation lacks global admission control

Puzzle attempts are rate-limited per user, but each accepted request runs a
bounded authoritative simulation synchronously on its request thread. Many
different users can therefore consume CPU concurrently even though no one user
exceeds their limit.

**Change needed:** add a bounded application-wide puzzle simulation admission
limit (and optionally one concurrent attempt per user), return a retryable busy
response, and isolate this work from latency-sensitive match coordination.
Stress-test maximum-complexity puzzles while asserting queue and WebSocket
responsiveness.

### AUD-07 — Profile history contains N+1 database reads

Recent-match mapping bulk-loads participants, then dereferences lazy users while
building DTOs
([ProfileService.java](../server/src/main/java/com/example/botfight/service/profile/ProfileService.java#L476)).
Solved-puzzle mapping dereferences a lazy puzzle for every completion
([ProfileService.java](../server/src/main/java/com/example/botfight/service/profile/ProfileService.java#L516)).

**Change needed:** use DTO projections, explicit fetch joins, or entity graphs for
the exact page data. Add query-count integration tests for full pages so the
number of queries stays constant as row count grows.

### AUD-08 — Public auth responses enumerate email/account state

Registration distinguishes an already registered email, and resend verification
distinguishes missing from already verified accounts
([AuthService.java](../server/src/main/java/com/example/botfight/service/auth/AuthService.java#L58)).
The controller returns these messages directly
([AuthController.java](../server/src/main/java/com/example/botfight/controller/AuthController.java#L237)).
Existing rate limits slow enumeration but do not remove it.

**Change needed:** return equivalent public status/body/timing for known and
unknown emails on resend/recovery-style flows. Registration product requirements
may still require a conflict response, but it should not reveal verification
state. Add response-equivalence tests.

### AUD-09 — Absolute session age is disabled by default

The security property defaults absolute age to zero and the filter treats zero as
disabled. Repository configuration sets only a two-hour inactivity timeout, so a
continuously active session may live indefinitely unless deployment overrides
the property.

**Change needed:** set and document a positive production absolute maximum age,
rotate/invalidate the session at sensitive identity changes, and add a startup or
deployment assertion so a missing override is visible.

### AUD-10 — Chat reporting and moderation do not exist yet

Match and custom-lobby chat validate length and rate-limit sends, but messages are
transient and there is no report entity, retention job, or admin-only workflow.

Recommended minimal design:

1. Give each server-accepted message a stable ID and keep a short-lived,
   server-verifiable message snapshot: sender ID, context type/ID, recipients or
   roster snapshot, timestamp, normalized text, and moderation metadata.
2. A report stores reporter ID, target message ID, reason category, optional
   bounded note, status, timestamps, and assigned/resolving admin. Copy the
   server-side message snapshot into immutable evidence so later chat expiry does
   not erase an open report.
3. Authorize report creation only for users who received/participated in that
   context. Never accept client-supplied sender identity or arbitrary evidence.
4. Use a unique constraint such as `(reporter_id, message_id)` for idempotency.
   Rate-limit globally per reporter and more tightly per reporter/target pair;
   cap open reports per reporter. Return the same result for duplicate clicks.
5. Expose list/detail/resolve/delete endpoints only to admins. Ordinary users may
   receive a generic acknowledgement but must not enumerate reports, reporters,
   admin notes, or actions.
6. Use two retention clocks: short chat-evidence retention unless referenced by
   an open report, and a documented resolved-report retention period. Prefer a
   tombstoned/audited resolution before hard deletion; hard-delete through an
   admin action or scheduled policy.
7. Sanitize rendering, bound every field, record administrative actions, and do
   not place raw message contents in general application logs.

**Tests:** forged message/context, non-recipient reporter, duplicate/spam clicks,
concurrent duplicate insertion, admin authorization, cross-user report access,
retention of open evidence, expiry of unreported chat, and resolved deletion.

### AUD-11 — Replay damage matching is quadratic in current shape count

For every prior shape in recent replay frames, rendering rebuilds and linearly
searches `[...bots, ...entities]`
([SimulationReplay.jsx](../frontend/src/replay/SimulationReplay.jsx#L423)).

**Change needed:** construct one current-shape map keyed by replay shape ID, then
perform constant-time lookups. Add an entity-heavy replay render benchmark or
regression test.

### AUD-12 — Browser simulation rebuilds full strategy state for each bot/tick

The 100 ms practice loop creates the main state snapshot, then calls
`buildStatePayload` again for each non-main bot
([Arena.jsx](../frontend/src/gameArena/Arena.jsx#L1020)).
That helper filters/maps all shapes and copies status/resource data, giving
roughly O(bots × shapes) repeated work per tick.

**Change needed:** index shared shape data once per tick and construct lightweight
actor-specific views from it. Profile a full eight-bot scene with active
entities before and after.

## P3 findings and cleanup candidates

### AUD-13 — Match socket events duplicate participant data

The event DTO contains `player`, `opponent`, and `players`
([MatchmakingEventDTO.java](../server/src/main/java/com/example/botfight/DTO/match/MatchmakingEventDTO.java#L10)),
and the factory populates all three together
([MatchEventFactory.java](../server/src/main/java/com/example/botfight/service/match/event/MatchEventFactory.java#L398)).
Migrate clients to one canonical participant list plus a viewer/user ID, measure
serialized event sizes, then remove legacy fields in a versioned contract change.

### AUD-14 — Published puzzle substring search will not use the current index

The query applies leading-wildcard `LIKE` to lowercased name/description, while
the migration index covers status and puzzle number. This is acceptable for a
small catalog but becomes a scan as the catalog grows. Capture `EXPLAIN ANALYZE`
at realistic size before changing it; use trigram/full-text indexing or a
prefix-only product contract if needed.

### AUD-15 — Legacy persistence and replay paths need an explicit decision

- Party state is documented and implemented as process-memory-only, but party
  repositories, an unused retention constant, and historical party tables remain.
- Active match resolution uses compact replay, while the full replay recorder and
  wrapper appear production-unused and test-referenced only.

Do not drop schema or runtime paths based solely on static reference search.
Confirm migration compatibility, operational/reporting use, serialized contract
consumers, and production data first. Then either delete the dead injections,
types, and tests in one focused change or document the supported purpose so they
stop looking accidental.

### AUD-16 — Large orchestration components are tightly coupled

`Arena.jsx` coordinates editing, tutorial/practice/puzzle/match modes, persistence,
submission, and the simulation loop. `PixiCanvas.jsx` combines renderer lifecycle,
input, and ability-specific presentation branches. Their size is not itself a
defect, but changes to one mode or ability have a wide regression surface.

Extract the simulation loop and mode-specific hooks from `Arena`; introduce a
keyed presentation-definition layer for ability-specific Pixi behavior. Preserve
the current authority boundary: renderer metadata may control presentation, not
gameplay outcomes.

### AUD-17 — Minor client lifecycle/logging cleanup

- Practice autoplay is intentionally open-ended while mounted. Pause it when the
  document is hidden or establish a duration/reset policy to avoid background
  work.
- Successful submissions log the full normalized brain payload to the browser
  console. Remove the production log or gate it behind development mode.

## Controls that should be preserved

- Rated outcomes remain authoritative server simulations; the browser is only a
  preview.
- The authoritative duel loop has fixed 100 ms steps, a 90-second cap, at most
  eight bots, normalized logic limits, bounded repeat checks, and bounded entity
  transition behavior.
- Replay delivery uses compact frames, one-second batches, and bounded reconnect
  lookahead instead of shipping a full replay on every event.
- HTTP and WebSocket payloads have application-level size limits; WebSocket send
  buffers are bounded.
- CORS/origins are allowlisted, STOMP requires authentication and denies
  unmatched destinations, and unexpected REST/STOMP errors are sanitized.
- Match and custom-lobby chat enforce message length and per-user rate limits and
  do not write every message to the database.
- Per-match state transitions use match-scoped locks rather than one global match
  lock.
- Puzzle completion insertion is idempotent through a uniqueness constraint and
  conflict-safe insert.

## Recommended implementation order

1. **Lifecycle integrity:** AUD-01 and AUD-03, including concurrency/rejection
   tests.
2. **Queue availability:** AUD-02 and AUD-04 with load/latency instrumentation.
3. **Unbounded state and CPU admission:** AUD-05 and AUD-06.
4. **Security/privacy and database efficiency:** AUD-07 through AUD-09.
5. **Moderation vertical slice:** AUD-10, including schema, authorization,
   retention, audit trail, and UI.
6. **Measured client/payload performance:** AUD-11 through AUD-14; record baseline
   timings and byte sizes before changing contracts.
7. **Cleanup/refactor:** AUD-15 through AUD-17 in small, behavior-preserving
   changes with existing focused tests.

## Audit limitations

This review used targeted static inspection routed by the repository context
maps. It did not inventory generated/vendor content, inspect cloud runtime
infrastructure, run a production database query plan, execute load tests, or run
the full test suites. Findings labeled as performance risks are structural and
should be quantified under realistic workloads. Legacy-code candidates require
runtime/operational confirmation before deletion.
