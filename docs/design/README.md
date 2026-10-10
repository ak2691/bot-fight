# Botfight MVP Design

Status: complete MVP design, nothing built. Written 2026-10-10 from the owner's decisions of 2026-10-09/10.
It replaces the earlier overhaul notes (`GAMEPLAY_OVERHAUL.md`, `GAMEPLAY_PARTS.md`,
`GAMEPLAY_OVERHAUL_ARCHITECTURE.md`); their decisions are folded in here. How today's codebase maps onto this
design is in [`../GAMEPLAY_OVERHAUL_MIGRATION.md`](../GAMEPLAY_OVERHAUL_MIGRATION.md). The current engine and
code are not constraints: this design can be built fresh, reusing infrastructure where it helps.

## The pitch

**BattleBots you program.** Build a robot from parts anyone understands (a frame, a drivetrain, a battery,
armour plates, a weapon, sensors), give it a brain made of plain rules and modes, and send it into the arena.
Bots fight with real-feeling physics: heavy bots shove, spinners store energy and explode into hits,
flippers throw opponents into pits, hammers pin. You never touch the controls during a fight. You win by
building and programming a better robot, then improving it after every loss.

## Design pillars

1. **Build it, program it, watch it fight.** Creation, then spectacle. The fight is the reward for the work.
2. **Physical and readable.** Everything that happens has an intuitive cause: heavier pushes harder, faster
   hits harder, a spun-down spinner is harmless. No hidden rules a non-engineer couldn't guess.
3. **Strategy over syntax.** Players own *predict* and *plan*; the engine owns *perceive* and *control*.
   Nobody writes trigonometry or motor code.
4. **Few pieces, deep combinations.** A handful of parts, five weapons, one programming model. Depth comes
   from how they interact, like chess's six piece types.
5. **Always a next step.** A daily puzzle, a weekly cup, a rival to beat, a rank to climb, a bot to improve.
6. **Fair and deterministic.** The server simulates every rated fight. The same inputs always give the same
   fight, so every result can be replayed and explained.

## Documents

| Doc | Covers |
|---|---|
| [01 Game loop](01-game-loop.md) | Fantasy, core loop, player journey, sources of fun, interactions, not-LeetCode |
| [02 Building](02-building.md) | Parts, faces and mounts, weight cap, derived stats, presets, garage |
| [03 Physics](03-physics.md) | Engine model: time, determinism, drive and acceleration, collisions, impact damage, airborne, hazards, win rules |
| [04 Weapons](04-weapons.md) | Spinner, hammer, flipper, clamp, wedge: mechanics, numbers, tells, matchup web |
| [05 Sensors](05-sensors.md) | Built-in sensing, rangefinders, camera, what bots can observe |
| [06 Programming](06-programming.md) | The brain: modes, lanes, rules, switches, readings, maneuvers, evaluation, editor, debugging |
| [07 Arenas and twists](07-arenas-and-twists.md) | Arena format, hazards, generator, rulesets, twist catalogue, rotation, automation, vetting |
| [08 Competition](08-competition.md) | Weekly Cup, Daily Gauntlet, practice ladder, Builder Rating (Glicko-2), seasons, joining and pairing |
| [09 Social and progression](09-social-and-progression.md) | Friends, challenges, scrim rooms, sharing, XP, trophies, achievements, Academy |
| [10 Architecture](10-architecture.md) | Shared engine and content packages, worker, Spring services, data model, pipeline, frontend, testing |
| [11 MVP plan](11-mvp-plan.md) | Scope, milestones, playtests, metrics, risks |

## Glossary

| Term | Meaning |
|---|---|
| **Bot** | A player's persistent robot: a build plus a brain, with a name and a record |
| **Bot version** | An immutable snapshot of a bot's build and brain; contests lock versions, never live bots |
| **Build** | The bot's physical configuration: frame, drivetrain, battery, face fittings, weapons, sensors |
| **Face** | One of the bot's four sides (front, rear, left, right); each carries one fitting |
| **Fitting** | What a face carries: bare, a plate, a wedge, or a face-mounted weapon |
| **Mount** | A weapon slot on the frame; every weapon uses one |
| **Charge** | The battery's resource (0 to capacity), spent by weapons, boost and the camera |
| **Brain** | The bot's program: start rules, situations, and modes |
| **Mode** | A named state of the brain with its own rule lanes and switches |
| **Lane** | One output of the brain (Move, one per weapon, Systems); in each lane, the first matching rule wins |
| **Rule** | `when` conditions (all must hold) → `do` an action |
| **Switch** | A rule that changes mode, on conditions or after time in mode |
| **Situation** | A named, reusable group of conditions |
| **Reading** | A value the brain can test (distance to opponent, my charge…), supplied by sensors |
| **Maneuver** | A Move action (Approach, Retreat, Circle, Turn to, Go to, Line up, Brake) executed by the engine |
| **Game** | One fight between two bot versions on one arena setup, up to 120 s |
| **Match** | Several games between the same two bots (a cup match is 4 games) |
| **Cup** | The weekly two-stage contest |
| **Ruleset** | Every rule a twist can change (weight cap, damage multipliers, bans, grip…) |
| **Twist** | A change to the ruleset or arena for a contest |
| **House bot** | A bot written by the developers, used for the Academy, gauntlets, filling small cups and rating anchors |
| **Gauntlet** | The daily PvE challenge against house bots |

## Decision log

| Date | Decision |
|---|---|
| 2026-10-09 | Pivot from live timed rounds to persistent garage bots and contests |
| 2026-10-09 | Weekly Cup with two stages and a twist between them; Swiss pairing; top-8 finals |
| 2026-10-09 | Weight-cap budget; shared energy; sensors limit what code can read; armour and chassis exist |
| 2026-10-10 | Free to replace the engine; 2D top-down simulation; Pixi now, three.js possible later |
| 2026-10-10 | Bodies collide and push; ramming, wall slams and hazards deal damage; arenas vary |
| 2026-10-10 | Melee only; abilities, projectiles and modules dropped; chassis has weapon mounts |
| 2026-10-10 | One drivetrain pick; test drive in the garage; no manual control in competition |
| 2026-10-10 | Programming model: modes with rule lists; no text view; AI help allowed (can't be stopped) |
| 2026-10-10 | Sensors report only what is physically observable; camera draws charge while on; rangefinder reports whether it detects something |
| 2026-10-10 | This document set: everything else in it is the design team's proposal, open to owner changes |

## References

| Source | What it informed |
|---|---|
| [Halite design paper (Spector & Truell)](https://ar5iv.arxiv.org/html/1710.07738) | Simple to start, hard to master, always a next step; dominant strategies kill competitions; live leaderboards; starter bots |
| [CodinGame leagues](https://www.codingame.com/blog/?p=858), [ranking variance](https://forum.codingame.com/t/how-is-the-rank-for-single-finished-bot-programming-computed/194147) | League bosses as milestones (house bots); rule changes can break players' code; short-event ratings are noisy |
| [Battlecode](https://battlecode.org/about), [2019 postmortem](https://battlecode.org:443/assets/files/postmortem-2019-oak.pdf) | Mid-competition balance changes force adaptation (the Stage 2 twist) |
| [Magic tiebreakers](https://blogs.magicjudges.org/rulestips/?p=1414), [top-8 cut](https://apps.magicjudges.org/forum/post/46946) | Swiss with opponents' match-win % (0.33 floor) into a top 8 |
| [BattleBots rules](https://runamok.tech/rules/BB_season3_rules.html), [NHRL format](https://wiki.nhrl.io/wiki/index.php/2023_Tournament_Format) | Qualifiers into elimination brackets; judges' decisions; hazards and weapons |
| [Robot sumo rules](https://www.appstate.edu/~marlandes/sumo/SumoRules20.pdf) | Fully autonomous robots; ring-out; search–track–attack state machines |
| [Dean Kamen on FIRST](https://spectrum.ieee.org/dean-kamen-on-first) | A changing game so veterans can't coast and there's no single solution |
| [Slay the Spire daily climb](https://kotaku.com/slay-the-spires-daily-challenges-keep-getting-better-1823780588), [Spelunky daily](https://spelunky.fandom.com/wiki/Daily_Challenge_Mode_(HD)) | Shared daily challenges; modifiers as trade-offs; skill over luck |
| [Tavern Brawl design](https://www.hearthstonetopdecks.com/game-designer-pat-nagle-talks-about-tavern-brawls-design/) | Mixing cheap and expensive content; reruns |
| [Screeps seasons](https://wiki.screepspl.us/Seasonal_World), [Trackmania Weekly Shorts](https://doc.trackmania.com/create/map-review/weekly-shorts-guidelines/), [Codeforces Div 4](https://codeforces.com/blog/entry/77028) | Seasonal mechanics announced ahead; beginner-friendly weekly content; newcomer divisions |
| [Waymo: safe AI for driving](https://waymo.com/blog/2025/12/demonstrably-safe-ai-for-autonomous-driving), [FSMs in the Urban Challenge](https://arxiv.org/pdf/2003.01149) | Sense → perceive → predict → plan → control; state machines for the planning layer |
| Armored Core, Mario Kart 8 | Weight and energy budgets as visible bars; few picks that move stat bars |

## Numbers

Every number in these documents is a **starting value**. Balance is measured with the deterministic harness
([07](07-arenas-and-twists.md#vetting), [11](11-mvp-plan.md)) and tuned through data files, never by
changing rules in code. Where a number appears in more than one doc, the owning doc is: parts
[02](02-building.md), physics [03](03-physics.md), weapons [04](04-weapons.md), sensors [05](05-sensors.md).
