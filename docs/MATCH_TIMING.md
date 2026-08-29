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
- Ability selection displays 60 seconds. `loadoutSelectionEndsAt` is the
  authoritative deadline 62 seconds after the phase begins, including the
  hidden two-second submission grace. If both players select early,
  building-room preparation lasts up to two seconds but never extends beyond
  that authoritative selection deadline.
  This WebSocket countdown is a critical timing contract: do not change the
  60-second visible interval, 62-second server interval, or two-second grace
  without an explicit timing-contract change.
- During building-room preparation the client displays "Both players have
  selected, preparing building room." Building then displays the server-owned
  round duration: 300 seconds (5 minutes) for 1v1, 360 seconds (6 minutes) for
  2v2, or the custom lobby's configured duration. Custom durations are bounded
  to 30 seconds through 600 seconds (10 minutes), with 300 seconds as the
  default.
  `buildingEndsAt` is two seconds later than the visible deadline so an in-flight
  final submission can still be accepted before the server creates its fallback.
- After both submissions are accepted, the client enters `SIMULATION_LOADING`.
  This phase has no deadline: the backend calculates the complete authoritative
  replay before publishing a playback schedule. Simulation runs on a dedicated
  executor and uses a match-scoped claim; it must not occupy the lifecycle
  scheduler or serialize state transitions for unrelated matches.
- Once calculation finishes, the server publishes `SIMULATION_PREPARING` with
  the initial arena state, `serverNow`, and the absolute replay deadlines. A
  three-second server-authored preparation window preserves the arena entrance
  animation before playback begins.
- Authoritative replay frames are delivered in one-second windows with two
  seconds of lookahead. The first window is sent two seconds into preparation,
  so the two-second buffer is built through consecutive one-second messages,
  not an initial two-second burst. Every window has an absolute publication
  timestamp derived from `playbackStartsAt`; delivery never waits for a client
  acknowledgement and never derives the next deadline from the prior send.
- Replay uses the original authoritative simulation `elapsedMs` values. The
  terminal window completes frame delivery without disclosing whether the
  series has ended. A reconnect receives the authorized replay prefix and
  original `playbackStartsAt`, allowing the client to select the current frame
  from server-authoritative elapsed time. When a round decides the series, the
  server publishes a separate `MATCH_RESULT_READY` at `resultRevealsAt`; no
  terminal flag is included in replay or result payloads. Immediate non-replay
  outcomes such as surrender or a disconnect also use `MATCH_RESULT_READY`.
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

Run this sequence whenever round lifecycle, loadouts, building sessions, or
submission ownership changes:

1. Finish round one and verify `MATCH_ROUND_READY` for round two has
   `loadoutSelected: false`; inherited prior-round abilities may be carried as
   the base, but round-two offered abilities must be an empty draft.
2. Let round two expire without selecting anything. The server must deterministically
   add exactly two round-two offers, enter `PREP`, and allow a bot submission
   even if the client still holds the pre-timeout brain. The server-owned
   finalized loadout must be the loadout used by the submission and simulation.
3. Repeat immediately for round three: start with no round-three picks, add
   exactly one offer on timeout, and submit successfully. Do not stop after
   proving only the round-two transition.
4. Exercise reconnect during the result hold and at `MATCH_ROUND_READY`; the
   resumed round must expose the same active deadline and draft state.

Recurring mistakes to guard against:

- Reusing the previous encoded loadout as if it were the new round's draft;
- Creating the next deadline when replay preparation finishes instead of when
  the next selection phase actually activates;
- Treating a client-echoed loadout as authority after the server auto-picks;
- Testing only the first non-opening round, which lets round-three state leaks
  survive unnoticed; and
- Verifying timer values without verifying `loadoutSelected`, inherited picks,
  automatic pick counts, and submission ownership together.
