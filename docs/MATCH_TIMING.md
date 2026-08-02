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
  testing-room preparation lasts up to two seconds but never extends beyond
  that authoritative selection deadline.
- During testing-room preparation the client displays "Both players have
  selected, preparing testing room." Testing then displays 30 seconds.
  `testingEndsAt` is two seconds later than the visible deadline so an in-flight
  final submission can still be accepted before the server creates its fallback.
- After both submissions are accepted, the client enters `SIMULATION_LOADING`.
  This phase has no deadline: the backend calculates the complete authoritative
  replay before publishing a playback schedule.
- Once calculation finishes, the server publishes `SIMULATION_PREPARING` with
  the initial replay buffer and a relative `simulationPreparingDurationMs`
  countdown (normally 3,000 ms). This presentation countdown is anchored at
  event receipt and reduced by the estimated downstream network delay; it does
  not require server/client clock timestamps. The simulation calculation is
  never scheduled from, or delayed by, this playback countdown.
- Replay starts after that local preparation countdown and is retimed to a
  five-second presentation. The terminal replay batch reaches the final frame
  at that deadline and carries the authoritative result payload, so the client
  reveals it when the terminal frame is displayed. Replay batches may arrive
  buffered before their display time; the client must not shift the local
  preparation countdown when a WebSocket event arrives late. Immediate
  non-replay outcomes such as surrender or a disconnect still use
  `MATCH_RESULT_READY` because there is no terminal replay batch to carry their
  result.
- Replay batches carry only their match identity, ruleset, and authoritative
  playback snapshot batch. Player, bot-brain, draft, and other editor metadata
  belongs to phase or round-configuration events and must not be repeated in
  every replay batch.
- The post-result hold ends at `roundReadyAt`, normally three seconds after
  `resultRevealsAt`. The backend schedules `MATCH_ROUND_READY` for that
  deadline; the client switches to the next ability selection when that event
  arrives and does not run its own post-result hold timer.
- Terminal match chat closes at `matchChatEndsAt`, normally 30 seconds after
  `resultRevealsAt`. The backend schedules removal of the chat window at that
  instant, broadcasts the closure notice, and rejects later messages.
- Connection recovery uses `disconnectEndsAt`.

The server remains authoritative for all expiry checks and scheduled tasks.
Adding an authoritative lifecycle deadline requires an absolute server deadline
in its event, client clock normalization, a deadline-based 250 ms update loop,
and a server test covering delayed event delivery or an already-expired
deadline. A client-only presentation countdown may instead carry a bounded
relative duration, as `SIMULATION_PREPARING` does.
