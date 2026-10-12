# Lanes programming model

Starting point for the lanes visual programming style. It was written on 2026-10-10 as part 04 of the real-time
"Hotfix" exploration, which was removed on 2026-10-12 (`git log -- docs/realtime-mode` has it). Crews, roles,
nodes, Surge, deploys and the opponent dossier belong to that exploration, not to lanes; read them as examples.

What the brain looks like when you have to change it during a live match.

## What live editing needs

- **A small change is a small edit.** The common patches (a new threshold, one more rule, a different target)
  take under 10 seconds of clicking.
- **Local.** You can change one behavior without understanding the whole brain.
- **Readable as sentences,** so you can scan your own brain quickly and read the opponent's revealed rules.
- **No wiring and no layout.** Order is a list, not positions on a canvas.
- **Safe defaults.** An empty lane still does something sensible, so a half-written brain doesn't lose on its
  own.

Today's node-graph editor suits careful building, but under time pressure it fails all five. The model below is
close to Final Fantasy XII's *gambits* (an ordered list of "condition → action" rules where the first rule that
applies runs) plus modes. The shelved BattleBots design worked out a similar model in detail
(`git show newgameplayoverhaul:docs/design/06-programming.md`); this one adds crews and roles.

## The model

```
CREW BRAIN
├─ Always            cards checked before any role's cards, for every bot ("anyone under 15% HP retreats")
├─ Roles (1–3)       each bot runs one role; several bots can share a role
│  └─ Modes (1–4)    each bot is in one mode of its role at a time
│     ├─ Switches    when [conditions], or after N s in this mode → go to another mode
│     └─ Lanes
│        ├─ Move     a maneuver: Capture, Chase, Kite, Retreat, Guard…
│        ├─ Weapon   when to swing, and at whom
│        └─ Module   when to use the module, and where
├─ Situations        named groups of conditions, reusable anywhere ("Outnumbered")
└─ Variables         a few numbers and true/false values per bot (counters, flags)
```

A beginner's brain is one role, one mode and two or three cards. A strong brain might have three roles with
three modes each and about 40 cards.

## Evaluation

Every tick (100 ms), for each bot, from the same start-of-tick snapshot:

1. **Switches:** the first switch of the bot's current mode whose conditions hold (or whose timer has run out)
   moves the bot to the new mode. At most one switch per tick; time in mode restarts.
2. **Lanes:** in each lane the first card that applies wins: Always cards first, then the current mode's cards,
   top to bottom. A card applies when its conditions hold *and* its action is possible now. A module on
   cooldown isn't possible, so the lane moves on to the next card.
3. **Defaults:** a lane with no winning card uses its default (below).

Both crews decide from the same snapshot, so neither sees the other's decisions for that tick, as today.

- **When a deploy lands,** a bot stays in its current mode if that mode still exists in its role; otherwise it
  enters the role's first mode. Variables that still exist keep their values.
- **When a bot respawns,** it starts in its role's first mode and keeps its variables, so a counter can make it
  take a different route each life.

## Cards

A card is **when** [0–3 conditions, all must hold] → **do** [one action]. With no conditions it reads "Always".
For "or", use two cards with the same action. Each card reads as a sentence with clickable chips:

`When [my HP] [<] [30%] → Retreat [to base]`

A condition compares a reading with a number, with a reach ("the module's reach"), or with another reading of the
same unit; or tests a true/false reading; or names a situation.

### Readings

| Group | Readings |
|---|---|
| Me | HP %, weapon ready, module ready, Surge active, time in mode, time since I took damage, on a node |
| Around me | enemies within N, allies within N, distance to the target, the target's HP %, the target is winding up, the target's module is ready |
| Crew | allies alive, allies in mode [X], lowest-HP ally, an ally on node [X] |
| Enemies | enemies alive, time until the next enemy respawns, enemies on node [X] |
| Nodes | owner, contested, capture progress, my bots on it, their bots on it |
| Match | score difference, time left, time until the next Surge, who has a Surge |

"Allies in mode [X]" is the simplest coordination tool: "if any ally is in Engage, switch to Engage" makes a
crew fight together without any variables.

### Targets

Actions point at something picked by a **selector**:

| Kind | Selectors |
|---|---|
| Enemy | nearest · lowest HP within N · on node [X] · attacking me · attacking my lowest-HP ally · the one my allies target most · has a Surge |
| Node | A / B / C · nearest · nearest not ours · nearest not ours **that no ally is heading to** · most contested · fewest of my bots |
| Place | my base · a Surge pad · a point picked on the map |
| Ally | nearest · lowest HP · in mode [X] |

The "no ally is heading to" filter is built-in coordination: three bots running the same card spread out instead
of crowding one node. Without it, spreading out would need variables, which is too much for a beginner.

### Move maneuvers

The engine handles pathing, facing and spacing; the player picks the intent.

| Maneuver | Settings | What the bot does |
|---|---|---|
| Capture | node | Goes to the node and stays inside it |
| Go to | place | Goes there |
| Chase | enemy | Closes to weapon reach |
| Kite | enemy, distance | Keeps that distance, backing off as needed |
| Retreat | to base, to our nearest node, or away from an enemy | Leaves |
| Guard | ally or node, radius | Stays near it, between it and the nearest enemy |
| Follow | ally | Stays behind it |
| Flank | enemy | Approaches from the side away from its allies |
| Strafe | enemy, direction | Circles at the current distance |
| Hold | — | Stands still |

Today's low-level actions (Walk in a direction, Face) can stay as "advanced" cards for experts.

### Weapon and module actions

- **Weapon:** Swing at [enemy selector]. The swing starts only when the target is in reach and inside the arc.
- **Module:** Use, aimed as the module allows: a Mine at my position, Dash toward or away from a target, Tether a
  target, and so on.

## Defaults

| Lane | When no card applies |
|---|---|
| Move | Hold |
| Weapon | Swing at the nearest enemy in reach |
| Module | Nothing. Each module comes with a suggested card to drag in |

Defaults appear as dimmed cards at the bottom of each lane. A bot with an empty brain stands still and defends
itself: weak but not embarrassing, and it makes the first lesson obvious (it needs to move). Experts can turn a
default off ("swing only when my cards say so") to control timing, for example to save a swing for a target that
is winding up.

## Sequences and variety

- **Sequences** use timed switches instead of chains: Bait → after 1.5 s → Strike → after 0.5 s → Regroup.
  Bring chains back only if experts can't express what they need.
- **Variables** (up to 6 per bot, numbers and true/false) cover counters and memory. They also let experts be
  less predictable *while staying deterministic*: alternate routes each life, attack every second time, change a
  threshold after being punished.

## Limits

| Item | Limit |
|---|---|
| Roles | 3 |
| Modes per role | 4 |
| Cards per lane per mode | 6 |
| Always cards per lane | 4 |
| Switches per mode | 4 |
| Conditions per card | 3 |
| Situations | 10 |
| Variables per bot | 6 |
| Cards in total | 60 |

The limits keep a brain readable by its author and by an opponent reading its revealed parts.

## The editor during a match

Desktop: the arena on the left (about 60% of the width), the brain on the right, a deploy bar along the bottom.

- **Click a bot to edit it.** The brain jumps to that bot's role and current mode and highlights, live, the card
  winning each lane. When a bot does something wrong, the card responsible is already in front of you.
- **Chips:** click one to change it; drag a number to adjust it.
- **One-click toggle** to switch a card off: the fastest patch there is ("stop doing that").
- **Quick add:** `/` opens a search over card templates. Typing "retreat hp 30" offers
  `When my HP < 30% → Retreat to base`. It searches templates; it isn't a text language.
- **Deploy bar:** charges, upload status, and what the draft changes compared with the live brain
  ("2 changes: Runner / Move, Runner / Module"). Over the 3-change limit, it shows which changes go now and which
  wait for the next deploy.
- **Try it on the last 20 s:** pick a moment in the replay buffer and re-run it with your draft against the
  opponent's recorded movement. The opponent doesn't react, so it's only a rough check, but it answers "would
  this have dodged that?". It runs in your browser and never counts for anything.
- **Dossier tab:** the opponent's revealed cards (Hotfix part 05, in git history).

Phones: editing during a live match on a small screen is hard. Options are tabs (Arena / Brain / Dossier) with
the deploy bar always visible, or phones only in a slower casual queue. Decide after the desktop version plays
well.

## How it relates to today's brain

- Today's runtime already does much of this: roots checked every tick, IF / ELSE IF where the first match wins,
  one action per category per tick, priorities and variables. Lanes are close to action categories, and a mode
  is roughly a variable that gates which cards apply. Cards could probably compile into today's format, so a
  prototype wouldn't need a new runtime. Confirm this in code before relying on it.
- New pieces: crew, node and Surge readings; selectors with filters; maneuvers (pathing around pillars, Kite,
  Guard, Flank); roles; defaults; the card editor.
- The behavior-tree canvas could stay for the round-based mode and puzzles, if those stay.

## Open questions

- A typed rule language for speed? The BattleBots design decided against a text view; quick add is the middle
  ground.
- Automatic role changes during a match ("the healthiest bot becomes the Hunter")? Not in a first version.
- Variables shared by the whole crew? Readings like "allies in mode [X]" may be enough.
