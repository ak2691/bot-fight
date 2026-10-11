# 08 Prototype plan

## Principle

Test the fun before building the architecture. Botfight has changed direction twice, so the next step should be
cheap and give a clear answer. The riskiest assumptions, most dangerous first:

1. Editing your bot during a live match is fun, not stressful.
2. Players really read and answer each other: the read–exploit–patch loop happens.
3. Crews and nodes add depth without overload.
4. New players learn it in about 5 minutes.

Each stage tests one of them with as little new code as possible, and each can end the idea
([07](07-why-this-and-risks.md#when-to-stop)).

## Stage 1: solo live loop in the browser (days)

In the practice room, browser only, nothing rated:

- the fight runs continuously at real speed instead of in segments;
- a deploy button swaps your brain in after 1.5 s, limited by charges;
- one hill in the center (the Duel variant): +1 point per second while you're alone on it; respawn after 6 s;
- a house bot that switches between 3–4 prepared brains every 60–90 s, announced like a deploy, each with a
  different weakness to find.

Keep today's bot, kit and brain editor as they are. The editor is slow for this, but if live patching is fun even
with it, it will be more fun with cards.

The engine already allows the core of this: `createFight(setup)` returns a fight whose `step(overrides)` accepts
new normalized brains, and its options "may be replaced per step"
([`arenaPreviewSimulation.js`](../../frontend/src/gameArena/modelPayloads/arenaPreviewSimulation.js)). New work:
a real-time loop, the hill score (it can be computed outside the engine from each frame), and respawn (probably a
small engine hook that resets a dead bot's HP and position).

**It answers:** Is live patching fun? How long does a useful patch take? Do players watch or edit? What breaks
first?

## Stage 2: two players live (1–2 weeks)

- A server-hosted live Duel between two people.
- The deploy protocol (below), announcements, tells, and a simple dossier (stages 1 and 3 only).
- A minimal match screen: arena, editor, deploy bar, event feed.

**It answers:** Does read–exploit–patch happen between people? How many deploys answer something the opponent
did? Does a match feel like a conversation, or like two people solving puzzles side by side?

Test with think-aloud sessions: players say what they're doing and why. After each match ask: "What did your
opponent's bot do? What did you change because of it? Was there a moment you felt clever?"

## Stage 3: crews and Hold

- Three bots per side, roles, nodes A / B / C, Surges.
- The card editor ([04](04-programming-model.md)) with a first set of maneuvers and selectors.
- The full staged reveals ([05](05-reading-the-opponent.md)).

**It answers:** Do crews add depth or just noise? Do Blotto-style mind games appear? Can players follow six bots?

## Stage 4: onboarding and ranked

The tutorial match, starters, house crews and exploit puzzles ([06](06-floor-and-ceiling.md)), then ratings and
spectating.

## What to measure

| Measure | Why |
|---|---|
| Deploys per match, and the time between them | Is the loop alive? |
| Share of deploys that answer the opponent (from think-aloud and from what changed) | Interaction or solitaire? |
| Time from an exploit starting to its victim patching it | The exploit window |
| Time in the editor against time watching | Attention balance |
| Score at 2:00 against the final result | Do openings decide too much? |
| "Stressful or fun?" after every match | The biggest risk |
| Matches abandoned | |

## Architecture sketch (stage 2 onward)

```
browser ──deploy──► Spring ──validated deploy──► live match host (Node, the shared engine)
   ▲                auth, match membership,          ticks every 100 ms, applies each deploy
   │                charges and limits, brain         at its stamped tick, works out tells
   │                validation (the worker's rules)   and reveals for each player
   └────────────── frames for each player, in batches ◄──────┘
```

- **Live match host:** a stateful process per match that runs the shared engine in real time, with a tick
  schedule kept from a monotonic clock. It could be a new task type in `sim-worker/` (today it only answers
  requests) or a small separate service.
- **Deploys:** the client sends its draft. Spring checks authentication, match membership, charges, the 3-change
  cap and the minimum gap (all enforced on the server, never trusted from the client) and runs the existing brain
  validation. The host stamps the apply tick (current tick + 15), tells both players, and applies it at that
  tick. The client never chooses the tick.
- **Frames:** sent to each player in batches, with that player's information only: tells and revealed cards,
  never the opponent's brain.
- **Latency matters little:** nobody has reflex inputs, and the 1.5 s delay covers network delay, so both players
  see a deploy land at the same game time.
- **Determinism and audit:** a match is its seed, map, starters, loadouts and **deploy log** (tick, player,
  brain). Re-running the log reproduces the match exactly. It's the same "brain schedule" idea the segmented
  simulation uses today, with deploy ticks instead of segment boundaries, and it fits the plan that replays are
  re-simulated rather than stored.
- **Disconnects:** the bots keep running their last deployed brain; on reconnect the client catches up from the
  host.
- **Cost:** see [07](07-why-this-and-risks.md#risks).

## What the current code gives us

| Current piece | Use in Hotfix |
|---|---|
| Engine: fixed 100 ms ticks, seven stages, brains replaceable between steps | The live loop. Needs several bots per side, map objects (nodes, pads, pillars), respawn, scoring |
| `shared/gameplay/*.json` abilities and weapons | Weapons and modules |
| Brain runtime: priorities, first match wins, one action per category, variables | Probably the compile target for cards |
| Brain schema and the worker's `/validate` | Deploy validation, with a new schema version |
| Planner (aim prediction, angles) | A base for the maneuvers |
| Pixi arena and interpolation | Live rendering, with a bigger map and a camera |
| Puzzles page | Exploit puzzles |
| Spring: auth, matchmaking, WebSocket, ratings, chat moderation | Unchanged in principle |
| Behavior-tree canvas, chains | Not used in Hotfix |
| Stamina, sprint, fast turn, wind-up cancel | Off in Hotfix at first |
| The six-segment match loop | Not used in Hotfix |

## If adopted: contract changes

The always-on rules in `AGENTS.md` describe the six-segment format. Adopting Hotfix means updating them for this
mode:

- match format and ending: score, time limit, draws;
- match authority: a live host instead of a batch simulation (still on the server, still deterministic);
- audit data: the deploy log;
- hostile input: deploys, charges, and per-player views of information.

## Open decisions, in the order they're needed

| Before | Decision |
|---|---|
| Stage 1 | Deploy limits for the test: charges or a cooldown |
| Stage 2 | Reveal stages and announcement content; where the live host runs |
| Stage 3 | Crew of three or one bot; Hold or another objective; leave stamina and chains out of this mode |
| Stage 4 | Public starters only in ranked? Does Hotfix replace the six-segment format or sit beside it? |
