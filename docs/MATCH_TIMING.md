# Match timing contract

Match lifecycle timing is authoritative on the server. Phases that can expire
or transition carry either an absolute UTC `Instant` deadline or an explicit
relative duration when the phase is a client-only presentation countdown. The
client converts these into monotonic local deadlines.

## Client network-delay conversion

The browser performs nine sequential four-timestamp probes with `/api/time`
when a matchmaking WebSocket connection is established and repeats the burst
periodically:

1. Record client send time `t0`.
2. The endpoint records server receive time `t1`.
3. The endpoint records server transmit time `t2`.
4. Record client receive time `t3`.
5. Calculate network delay as `(t3 - t0) - (t2 - t1)`.
6. Keep the five valid probes with the lowest network delay and use their
   median network delay.
7. Estimate downstream delivery time as `networkDelay / 2`.

The `(t2 - t1)` term removes time spent processing the time request from the
network-delay estimate. Sampling is single-flight, fresh per connection,
repeated every 30 seconds, and expires after 60 seconds. No client/server clock
offset is calculated or retained.

For an event carrying a server deadline, the client calculates:

```text
remainingAtPublish = endsAt - serverNow
initialRemaining = remainingAtPublish - estimatedDownstreamDelay
localDeadline = performance.timeOrigin + performance.now() + initialRemaining
```

Later countdown reads use only the monotonic browser clock:

```text
max(0, localDeadline - (performance.timeOrigin + performance.now()))
```

Countdown displays may round that value up to whole seconds, but lifecycle
checks and phase transitions must use the unrounded milliseconds. The browser
should sample the deadline at a short interval (currently 250 ms) rather than
subtracting a duration from event receipt time.

If network-delay sampling is unavailable, the client uses zero estimated
downstream delay. This can make a countdown late by the actual delivery time,
but it cannot introduce a wall-clock offset error.

## Match lifecycle deadlines

- Match acceptance displays a 20-second window. The server keeps the
  provisional pairing open for 22 seconds, reserving the final two seconds as
  submission grace. The client subtracts the estimated one-way network delay
  and the two-second grace from `matchAcceptanceEndsAt` for its visible
  countdown. The server creates the persisted match and emits `MATCH_STARTED`
  only after both acceptance requests succeed; a provisional pairing has no
  database match yet.
- There are no guaranteed offers. Every offer comes from the match seed: the same offers for every
  player (2v2 too), minus the abilities a player already owns.
- **The pick phase is 30 seconds in round 1 and 20 seconds in rounds 2 to 6.** Round 1 picks a weapon
  (Slash, Thrust, Cleave or Smash) and one of three tier 1 abilities; each later round picks one ability
  (three offers in rounds 2 to 4, two in rounds 5 and 6; rounds 1-2 draw from tier 1, 3-4 from tier 2,
  5-6 from tier 3). `loadoutSelectionEndsAt` is the authoritative deadline: the visible 30 or 20 seconds
  plus the hidden two-second submission grace (32 or 22 seconds after the phase begins). **This
  intentionally replaces the old 60/62-second ability-selection contract**; the grace is unchanged.
  If every player locks in early, building-room preparation lasts up to two seconds but never extends
  beyond that authoritative deadline. A player who has not picked when it passes gets a deterministic
  auto-pick: Slash as the weapon in round 1, and the first offer in offer order. The event field keeps
  its existing name for wire compatibility; its meaning is the active selection phase's deadline. The
  pick phase never touches a player's clock.
- During building-room preparation the client displays "Both players have selected, preparing
  building room."
- **Building runs a per-player chess clock.** A player's clock starts at 5:00 (1v1), 7:00 (2v2) or the
  custom lobby's base (30 seconds to 10 minutes), and gains the increment (30 seconds; custom lobbies
  choose 0 to 60 seconds) at the start of every build, round 1 included. The clock only runs while that
  player is building: the pick, the replay and the result hold are free, and a player who has submitted
  stops their own clock. The server owns the clocks; the client only displays them.
  - Each player's `buildEndsAt` (on their `players[]` entry) is the absolute instant their clock reaches
    zero. `clockRemainingMs` is the clock as it stood when the build began, or what was left once they
    submitted. The event's `buildingEndsAt` is the instant the **last** player's build can still be
    accepted (their deadline plus the grace), so it is also when every build is over.
  - A submit deducts the time spent since the build began from that player's clock. A submit that
    arrives after the visible deadline but inside the two-second grace is accepted and leaves the clock
    at zero.
  - A player's `timeoutFallback` is `CURRENT` (the default) or `PREVIOUS`, set on a submission or with
    the `/app/matchmaking.timeoutFallback` message while building. With `CURRENT` the client
    auto-submits its current brain just before its clock reaches zero and the server keeps that player
    open for the grace so it can arrive; if the submission is invalid, or nothing arrives, the server
    submits last round's brain. With `PREVIOUS` the server resolves the player exactly at their visible
    deadline with last round's brain and the new loadout (an empty brain in round 1).
  - The build ends when every player has submitted or run out. A player who runs out is resolved at
    their own deadline, even while a teammate or opponent is still building; resolving one player never
    cuts anyone else's clock short.
- After both submissions are accepted, the client enters `SIMULATION_LOADING`.
  This phase has no deadline: the backend calculates the complete authoritative
  replay before publishing a playback schedule. Simulation runs on a dedicated
  executor and uses a match-scoped claim; it must not occupy the lifecycle
  scheduler or serialize state transitions for unrelated matches.
- Once calculation finishes, the server publishes `SIMULATION_PREPARING` with the initial arena state,
  `serverNow`, and the absolute replay deadlines. A three-second server-authored preparation window
  preserves the arena entrance animation before playback begins. Each round's replay is one 20-second
  segment of a single continuous fight (positions, HP, statuses, cooldowns, stamina and entities carry
  over; only brains, loadouts and custom variables change), so a replay is at most 20 seconds long and
  shorter when a team is knocked out.
- Authoritative replay frames are delivered in one-second windows with two
  seconds of lookahead. The first window is sent two seconds into preparation,
  so the two-second buffer is built through consecutive one-second messages,
  not an initial two-second burst. Every window has an absolute publication
  timestamp derived from `playbackStartsAt`; delivery never waits for a client
  acknowledgement and never derives the next deadline from the prior send.
- Replay uses the original authoritative simulation `elapsedMs` values, relative to the start of the
  segment. The terminal window completes frame delivery without disclosing whether the match has
  ended. A reconnect receives the authorized replay prefix and original `playbackStartsAt`, allowing the
  client to select the current frame from server-authoritative elapsed time. The match ends when a
  team is eliminated during a segment, or after round 6, when the team with the higher total HP wins
  (`HP_DECISION`; equal totals, or both teams falling on the same tick, are a draw). The server then
  publishes a separate `MATCH_RESULT_READY` at `resultRevealsAt`; no terminal flag is included in replay
  or result payloads. Immediate non-replay outcomes such as surrender or a disconnect also use
  `MATCH_RESULT_READY`.
- The post-result hold ends at `roundReadyAt`, normally three seconds after
  `resultRevealsAt`. The backend schedules `MATCH_ROUND_READY` for that
  deadline; the client switches to the next ability selection when that event
  arrives and does not run its own post-result hold timer.
- Terminal match chat closes at `matchChatEndsAt`, normally 30 seconds after
  `resultRevealsAt`. The backend schedules removal of the chat window at that
  instant, broadcasts the closure notice, and rejects later messages.
- A disconnect detected during replay does not start its 30-second grace period
  until `resultRevealsAt`. A terminal result remains reconnectable for that
  post-replay window, and reconnecting after playback receives the explicit
  `MATCH_RESULT_READY`. The already-authoritative simulated winner is not
  replaced by a replay-time disconnect.

The server remains authoritative for all expiry checks and scheduled tasks.
Adding an authoritative lifecycle deadline requires an absolute server deadline
in its event, client clock normalization, a deadline-based 250 ms update loop,
and a server test covering delayed event delivery or an already-expired
deadline. A client-only presentation countdown may instead carry a bounded
relative duration, as `SIMULATION_PREPARING` does.

## Round-transition regression checklist

Run this sequence whenever round lifecycle, loadouts, building sessions, clocks or submission
ownership changes. A match has six rounds, so the transitions that matter are 1 to 2, 2 to 3, 4 to 5
and 5 to 6 (the tier and offer-count changes), and the last one:

1. Finish round one and verify `MATCH_ROUND_READY` for round two has `loadoutSelected: false`; the
   weapon and first ability are carried as the base, the round-two offers are an empty draft, and no
   weapon offers are sent (`timedRounds.weaponOffers` is empty after round 1).
2. Let round one's pick expire without selecting anything. The server must deterministically add Slash
   plus the first offer, enter `PREP`, and allow a bot submission even if the client still holds the
   pre-timeout brain. The server-owned finalized loadout must be the loadout used by the submission and
   simulation.
3. Repeat for rounds two, three, five and six: start with no pick for that round, add exactly one offer
   on timeout (the first offer, never one the player already owns), and submit successfully. Rounds
   five and six offer two abilities, rounds one to four three. Do not stop after proving only the
   round-two transition.
4. Check the clocks across rounds: each build adds the increment to the clock the previous round left,
   a player who submitted early keeps the time they saved, and a player whose clock ran out starts the
   next round with only the increment.
5. Exercise reconnect during the result hold, at `MATCH_ROUND_READY` and mid-build; the resumed round
   must expose the same active deadline, the same per-player `buildEndsAt`, and the same draft state.
6. End a match both ways: a knockout mid-segment (no further rounds, completion reason `SIMULATION`),
   and six rounds with no knockout (`HP_DECISION`, with the winning team or a draw).

Recurring mistakes to guard against:

- Reusing the previous encoded loadout as if it were the new round's draft;
- Letting one player's expiry (or submit) change another player's clock or deadline;
- Running a clock outside BUILDING, or adding the increment twice for one build;
- Creating the next deadline when replay preparation finishes instead of when
  the next selection phase actually activates;
- Treating a client-echoed loadout as authority after the server auto-picks;
- Testing only the first non-opening round, which lets round-three state leaks
  survive unnoticed (and now rounds five and six too); and
- Verifying timer values without verifying `loadoutSelected`, inherited picks,
  automatic pick counts, and submission ownership together.
