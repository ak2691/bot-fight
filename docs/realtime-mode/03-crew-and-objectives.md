# 03 Crew and objectives

One bot or several, what each bot carries, and what the players are fighting over.

## One bot or a crew?

| Option | What it is | For | Against |
|---|---|---|---|
| **Single bot** | One bot each, as today | Easiest to read and to build on the current engine; strong identity | Watching one bot live, players want to steer it, and deploy limits feel like handcuffs. Fights stay 1v1 duels, where cooldown and range comparisons dominate (the "90%" problem). One bot can only be in one place, so the map adds little |
| **Crew of three, one brain** (recommended) | Three bots per player, all running one brain, split into roles | Code is the natural way to control more bodies than you can watch, so nobody wishes they could drive. Depth moves from comparing kits to positions, numbers and timing. Three bots running the same rules show them three times as often, so they're easier to read. Splitting a crew across nodes creates real mind games (below) | More to watch; kits must shrink; roles and coordination are new ideas to learn |
| Commander and drones | One strong bot plus spawned helpers | A hero's identity with some RTS feel | Two programming models in one match |
| Economy and production | Gather resources, build more bots | A full RTS | Snowballs, long matches, the highest floor of all |

**Recommendation: a crew of three sharing one brain.** The single bot is still the right *first prototype*
([08](08-prototype-plan.md)), because it tests the riskiest question (is live patching fun?) on the current
engine. Crews come once that answer is yes.

A beginner's crew brain is still a single list of cards that all three bots run. They will crowd onto the same
node, which makes a perfect second lesson: give them roles, or use a target like "the nearest node no ally is
heading to" ([04](04-programming-model.md)).

## The bot

Small kits, so comparing loadouts takes a minute at the start instead of most of the match:

| Part | Starting value |
|---|---|
| HP | 100. Respawns make each life matter less than in a single-life duel |
| Movement | One speed, about today's walk |
| Facing | Turns automatically toward its weapon target, otherwise along its path; turn speed still limits it |
| Weapon | One of today's four: Slash, Thrust, Cleave, Smash |
| Module | One ability with a meaningful cooldown, from a pool of about 8 |
| Kept | Wind-ups (the tells), hit arcs, cooldowns, knockback |
| Left out at first | Stamina, sprint, fast turn, wind-up cancel, chains, per-round picks |

A kit never changes during a match, apart from temporary Surges. Nobody has to rebuild their reading of the
opponent because a new ability arrived.

Module roles worth having, with existing abilities to check as candidates (current behavior is in
[`../ABILITIES.md`](../ABILITIES.md); they would need retuning for 100 HP and three-bot fights):

| Role in Hold | Why it helps reading and baiting | Candidates |
|---|---|---|
| Escape or engage | Commits or saves a bot; "they used it, now they're exposed" is readable | Dash (19) |
| Trap | Rewards predicting where bots will go, the core skill | Proximity Mine (11), Snare Bomb (29) |
| Push off a node | Acts on the objective directly | Repelling Blast (8), Wind Burst (18) |
| Pull | Drags a bot away from its group or off a node | Tether Bolt (28) |
| Stop | A short window for a 2v1 | Stun (6), Frost Ring (26) |
| Sustain | Creates "retreat and heal" habits that can be read and punished | Basic Heal (10) |
| Block | Baits attacks; a bot that leans on it becomes predictable | Absolute Guard (23) |

## Objective options

| Objective | The rule in one sentence | Forces contact | How often it repeats | A beginner's first rule |
|---|---|---|---|---|
| **Hold** (recommended first) | Own nodes to score points over time | Yes: nodes are fixed places | Every node fight | "Capture the nearest node" |
| Data Run | Carry data from the center to your base; dying drops it | Yes: at the center and along the routes | Every time data appears | "Pick up data, then go home" |
| Relic | One object; whoever carries it scores | Very: six bots, one object | Constantly | "Get the relic" |
| Elimination | Destroy the whole crew; best of several rounds | Yes | Once per round | "Attack the nearest enemy" |
| Capture the flag | Bring their flag to your base | Partly | Once per capture | Several rules at once |

Hold is the easiest to state, has the most even tempo, and the best first rule. **Data Run** is the best second
mode: it adds greed ("carry one more, or go home?"), routes that can be ambushed, and a clear reason to fight.
Relic is fun, but the carrier's few rules would decide too much. Elimination is today's game with more bots.
Capture the flag has too many states for a first mode.

## Hold: starting rules

- **Map:** mirrored, roughly twice the width of today's arena. Bases at the north and south ends. Three nodes,
  **A**, **B** and **C**, run across the middle, each the same distance from both bases. A few pillars shape the
  paths and block pushes.
- **No fog of war:** everything is visible to both players and to their code. Fog would add scouting, but also
  a layer of sensors to program; it's a later variant.
- **Capture:** a node changes owner after one side has had bots in it, and the other side none, for 4 s.
  Progress pauses while both sides are inside and drains while nobody is. More bots don't capture faster.
- **Score:** +1 point per second for each node you own and +5 per kill. Node points are doubled from 6:00. First
  to 1000 wins; otherwise the higher score at 8:00 wins; equal is a draw. Holding two nodes all match wins
  around 7:10; a close match goes to time.
- **Respawn:** 6 s at your base, plus 2 s of protection after leaving it.
- **Surges:** two pads on the midline, beyond A and beyond C, so taking one means leaving the node line for a
  few seconds. A Surge appears at 1:00 and every 90 s after, alternating pads. Standing on it for 1 s takes it:
  +30% damage and +15% speed for 25 s. The timer is on the HUD, and code can read "time until the next Surge".

### Why power-ups are temporary

The owner's sketch had bots collecting items and growing over a match. Permanent items would snowball, and they'd
bring back the old problem in a new form: every new item changes how that bot should be programmed. Temporary
Surges give the map timed contests to plan around (like item timing in Quake duels: knowing when the big item
comes back is half the skill) without changing anyone's kit. If an economy is wanted later, Data Run is its
place: banked data could buy one upgrade per bot at fixed times.

## Why three nodes and three bots make mind games

Splitting a crew across nodes is a version of the **Colonel Blotto** game: two players divide their forces
between several battlefields, and whoever brings more to a battlefield wins it. There's no single best split;
whatever you choose, some other split beats it. In a normal RTS you make that choice by hand, in the moment.
Here you write a *policy* that makes it ("reinforce the contested node", "go where they have the fewest bots"),
and policies can be read and exploited:

| Policy | Its weakness | The exploit |
|---|---|---|
| Reinforce whichever node is contested | Always reacts the same way | Contest B with one bot to pull their crew in, then take A with two |
| Go where enemies are fewest | Never takes an even fight | Show a few bots, keep the rest behind a pillar, close the trap |
| Each bot holds its own node | Every node is a 1v1 | Bring two to one node, win the 2v1, roll to the next |
| Group up and push together | Leaves nodes empty | Avoid the group and take what it leaves |
| Retreat below 30% HP | A predictable exit | Chase anything around 35% |

Every counter has a weakness of its own, so a match keeps moving.

## Comebacks and snowballing

- Respawns are short, so a lost fight costs time, not the match.
- A kill is worth only 5 points (5 s of one node).
- Doubled points in the final two minutes keep the end open.
- A player who is behind has had more reason to study the opponent's rules, and can turn that into a patch.
- If playtests show early leads decide too much: shorter respawns for the trailing side, or Surges appearing
  nearer the trailing side.

## Variants

| Variant | Use |
|---|---|
| **Duel** | One bot each, one hill in the center, one Surge pad. The first prototype, and maybe a permanent quick mode |
| **Cold Start** | Blank brains and a 60 s setup during which bots can't leave the base; casual |
| **Data Run** | The second mode (above) |
| **2v2** | Two players per side, each with a crew of two; later |
