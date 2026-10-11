# Real-time mode exploration ("Hotfix")

Status: exploration only. Nothing here is decided or built. Written 2026-10-10.

The current game (six 20-second segments with blind build phases,
[`../TIMED_ROUNDS_MATCH_FORMAT.md`](../TIMED_ROUNDS_MATCH_FORMAT.md)) has two problems: a high skill floor, and
very little real interaction between the players. The programmable-BattleBots pivot was shelved (its design is
kept on branch `newgameplayoverhaul` under `docs/design/`). These docs explore the owner's next idea: a real-time
mode in which players change their bots' code while the match is running.

"Hotfix" is a working title: shipping a fix to a live system while it's on fire.

**Update (later 2026-10-10):** after owner feedback, [09 Macro](09-macro.md) and [10 Micro](10-micro.md) are the
current direction. Opponents read intent from macro (where bots go, which wells drain, who glows) under fog of
war, not from revealed cards; power comes from temporary Charge at wells and a timed Core; micro is stances
under a plan layer. Where they disagree with 03–05, 09 and 10 win.

## The idea

> You can't steer your bots. You can only change their minds, and your opponent can do the same.

A real-time 1v1 on a small map, about 8 minutes long. Each player has a crew of three bots that act on their own,
using a brain made of simple rule cards. The match never stops for building. At any moment you can edit your
brain and deploy the change, and it reaches your bots 1.5 seconds later. Deploys are limited, your opponent is
told when you deploy, and the rules your bots use are revealed to your opponent bit by bit as they fire. You win
by holding capture points.

A match is a loop: **read** the other player's rules from how their bots behave, **exploit** a weakness until
they notice, and **patch** your own weaknesses before they are exploited. Bots are deterministic, so an exploit
keeps working until its victim patches it. Finding holes and closing them is the game.

## Short answers

| Question | Short answer | Doc |
|---|---|---|
| Why does today's format feel like "semi-hope chess"? | Each move is a whole hidden brain, both players submit blind at the same time, and every round's new ability makes what you saw out of date | [01](01-diagnosis.md) |
| Does real time fix interaction? | Only if a deploy works like a chess move: small, limited, announced, and quick to show its effect | [02](02-live-loop.md) |
| One bot or units? | A crew of three sharing one brain. Code is the natural way to control more bodies than you can watch; with one bot in real time, players will just want to drive it | [03](03-crew-and-objectives.md) |
| What objective? | Three capture nodes, respawns and timed power-ups. Easy to state, forces contact, and repeats often enough to learn the opponent's habits | [03](03-crew-and-objectives.md) |
| What should programming look like? | Ordered rule cards in lanes and modes (like Final Fantasy XII's gambits), high-level maneuvers, sensible defaults, and editing by clicking a bot in the arena | [04](04-programming-model.md) |
| How do you read the opponent? | Their rules reveal themselves in stages as they fire, and their deploys are announced. Rules that never fire stay secret | [05](05-reading-the-opponent.md) |
| Skill floor? | Start from a working public brain and fix the next problem you can see. The first match teaches the game in about 5 minutes | [06](06-floor-and-ceiling.md) |
| Skill ceiling? | Policy design, reading, baiting, deception, deploy timing, splitting the crew, and attention | [06](06-floor-and-ceiling.md) |
| Why this over other RTS games? | You don't make decisions; you write the rules that make them, and you play against the rules your opponent wrote | [07](07-why-this-and-risks.md) |
| How would we build it? | Test the riskiest part first (is live patching fun?) with one bot on the current engine, browser only, then add the server and crews | [08](08-prototype-plan.md) |

## Recommendations

1. **The deploy is the move.** Deploys are small (up to 3 cards), limited (charges that refill), delayed
   (1.5 s) and announced. This turns blind simultaneous building into move and response.
2. **Ranked matches start from public starter brains**, picked before the match and shown to both players.
   Both players know each other's starting brain, like the starting position in chess. No blank page for
   beginners, no private libraries for experts.
3. **A crew of three bots sharing one brain**, split into roles.
4. **One mode first: Hold.** Three capture nodes, 6 s respawns, a power-up (Surge) every 90 s, 8 minutes.
5. **Small kits:** HP, one weapon and one module per bot. Leave stamina, sprint, fast turn, chains and wind-up
   cancel out of this mode at first. Keep wind-ups: they are the tells that make reading possible.
6. **Rule cards instead of the node graph** for live editing, with high-level maneuvers ("Capture the nearest
   free node", "Kite at 250") and defaults so an empty lane still does something sensible.
7. **Readable opponents:** staged reveals of fired rules, a dossier, deploy announcements, and both brains shown
   after the match.
8. **Teach with problems, not lessons:** the tutorial is a live match against house bots in which each minute
   shows one problem to fix.
9. **Test the fun before the architecture.** The engine already accepts a new brain between ticks, so a
   browser-only prototype can answer "is this fun?" within days.

## Documents

| Doc | Covers |
|---|---|
| [01 Diagnosis](01-diagnosis.md) | Why today's format lacks interaction, why the floor is high, what to keep |
| [02 The live loop](02-live-loop.md) | Match flow, starting brains, the deploy, the reaction horizon, attention, an example match |
| [03 Crew and objectives](03-crew-and-objectives.md) | One bot or a crew, the bot kit, objective options, Hold, power-ups, variants |
| [04 Programming model](04-programming-model.md) | Roles, modes, lanes, cards, readings, targets, maneuvers, defaults, the live editor |
| [05 Reading the opponent](05-reading-the-opponent.md) | What everyone sees, staged reveals, the dossier, deception, server rules |
| [06 Skill floor and ceiling](06-floor-and-ceiling.md) | The first match, starters, house bots, order of concepts, depth, measures |
| [07 Why this, fun and risks](07-why-this-and-risks.md) | The new kind of strategy, other games compared, fun, risks, when to stop |
| [08 Prototype plan](08-prototype-plan.md) | Staged prototypes, playtests, architecture sketch, reuse, open decisions |
| [09 Macro](09-macro.md) | Power vs. position vs. pressure, Charge and wells, the Core, fog, reading through macro, abilities |
| [10 Micro](10-micro.md) | Plan → stance → reflexes, crew tactics, map-aware readings, which current mechanics stay |

## Decisions for the owner

1. A crew of three, or one bot? ([03](03-crew-and-objectives.md))
2. Hold first, or another objective? ([03](03-crew-and-objectives.md))
3. Deploy limits: charges or a fixed cooldown, and the 3-card cap. ([02](02-live-loop.md))
4. How much of the opponent's brain is revealed, and when. ([05](05-reading-the-opponent.md))
5. Ranked from public starters only, or from private saved brains? ([02](02-live-loop.md))
6. Leave stamina, sprint, fast turn and chains out of this mode? ([03](03-crew-and-objectives.md))
7. Does Hotfix replace the six-segment format or sit beside it? ([08](08-prototype-plan.md))

Every number in these docs is a starting value for playtests.

## Glossary

| Term | Meaning |
|---|---|
| Crew | A player's three bots |
| Brain | The crew's program: roles, modes, lanes and cards |
| Role | A part of the brain run by one or more of the crew's bots (Anchor, Runner…) |
| Mode | A named state within a role; each bot is in one mode at a time |
| Lane | One output of a bot: Move, Weapon or Module. In each lane, the first card that applies wins |
| Card | One rule: when [conditions] → do [action] |
| Switch | A card that moves a bot to another mode |
| Draft | Your edited brain, not yet deployed |
| Deploy | Sending your draft to your bots; it takes effect after the upload delay |
| Charge | What a deploy costs; charges refill over time |
| Patch | The changes in one deploy |
| Tell | What a bot visibly shows when it commits to something: a wind-up, an action icon |
| Dossier | Your view of the opponent's brain, filled in as their cards reveal themselves |
| Sleeper | A card that hasn't fired yet, so the opponent can't see it |
| Starter | A public brain and loadout every player can start from |
| Node | A capture point in Hold |
| Surge | A timed power-up |
