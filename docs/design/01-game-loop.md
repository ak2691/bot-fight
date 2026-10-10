# 01 Game Loop

## The fantasy

You are a robot builder. You have a garage, a parts shelf and a weight limit. You bolt together a robot,
teach it how to fight, and enter it in the weekly cup. You don't drive it: like an autonomous sumo robot or
a self-driving car, it acts on its own, so everything it does is something you built or taught. When it wins,
*your* plan won. When it loses, the replay shows you exactly why, and you go back to the garage.

## Core loop

```
        ┌──────────── improve ◄──────────────┐
        ▼                                     │
   BUILD (parts) ──► PROGRAM (brain) ──► TEST (sandbox, test drive, house bots)
                                              │
                                              ▼
                                     COMPETE (gauntlet, cup, ladder, challenges)
                                              │
                                              ▼
                                   WATCH (replay, brain trace, highlights)
```

Each pass through the loop takes minutes, and every step is fun on its own: building is a toy box, testing
is a lab, competing is an event, watching is a show.

## The rhythm

| Cadence | Activity | Why it exists |
|---|---|---|
| Any time | Garage: build, program, sandbox, test drive | The craft |
| Daily | **Daily Gauntlet**: a PvE puzzle against house bots, same for everyone | A 10-minute habit; works with any number of players |
| Weekly | **Weekly Cup**: Monday brief → Thursday lock → Stage 1 → Friday twist and 24 h adapt → Stage 2 → Sunday finals | The main event: stakes, adaptation, spectacle |
| Continuous | **Practice ladder**: your bot fights others in the background | Live feedback between cups |
| With friends | **Challenges** (and later scrim rooms) | Rivalry and fun without stakes |
| Every 6 weeks | **Season**: new arenas, balance patch, rotating content, season rewards | Freshness |

## Player journey

**First 10 minutes.** The Academy opens on a test drive: you drive a preset bot with the keyboard and feel
the physics (treads shove, wheels slide). Mission 2 hands you a bot that just sits there; one rule later
("Approach the opponent") it charges. Mission 3 adds "hit when they're in range". You have a fighting robot
and you understand how it works.

**First hour.** You finish the Academy (10 short missions): sensors, pushing into hazards, modes ("Hunt"
and "Retreat"), reading a spinner with the camera. You pick a preset (say, *Anvil*, a wedge with a hammer),
tweak its brain, and earn a bronze medal in today's Gauntlet.

**First week.** You enter your first cup in the Rookie division. Stage 1 goes 3–3. On Friday the twist is
"Ice Rink: grip halved" and your wedge slides everywhere; you spend an evening adding a mode that stops
charging on ice and waits for the opponent instead. Stage 2 goes 4–2. You get a Builder Rating and a
"Mechanic" title, and a friend challenges your bot.

**First month.** You own three bots for different arenas, keep a gauntlet streak, have a rival you're 7–5
against, and you're studying replays of last week's finalists for ideas.

**Veteran.** You build anti-meta bots on Monday, prepare for all three announced Stage 2 twists, win a cup,
publish your champion to the archive, and watch newcomers copy it and get beaten by next week's twist.

## Where the fun comes from

1. **Creation and identity.** Your bot has a name, paint, a record and trophies. It's yours, and it
   persists for months.
2. **Spectacle.** Physics produces moments people want to watch and share: a spinner sending a bot across the
   arena, a flip into the pit, a hammer pin followed by a ram into the saws.
3. **Plans working.** The core satisfaction: "I predicted they'd charge, so I built a mode that sidesteps and
   pushes them into the wall", and then watching it happen.
4. **Reading the opponent.** Before the fight your bot sees the opponent's build (it can pick its starting
   mode accordingly). Between cup stages you study the field's replays. In a fight, the camera reads their
   weapon. Counter-play happens at every level.
5. **Mastery.** Ratings, titles, medals, achievements and a growing understanding of the physics.
6. **People.** Rivalries, challenges, cup finals as an event, shared replays.

## Interactions that make fights interesting

These come from the rules in [03](03-physics.md) and [04](04-weapons.md), not from special cases. Each one is a
decision a player can make, exploit or defend against.

| Interaction | What creates it |
|---|---|
| **Weight vs. agility.** Heavy bots win pushing contests and rams but accelerate and turn slowly. | Mass in F = ma; push = min(motor, grip × weight) |
| **Treads vs. wheels.** Treads win shoves; wheels win races; mecanum can strafe but gets bullied. | Drivetrain grip, force and top speed |
| **Wedge vs. spinner.** A wedge face halves spinner hits and lifts the spinner bot so it can be pushed. | Wedge rules |
| **The spin-up window.** After a big hit a spinner is weak for ~2 s. Punish it then. | Spinner energy model; the camera can read spinner speed |
| **Gyroscopic turning.** A spinning spinner turns slowly. Circle it. | Turn rate × 0.6 while spinner > 50% |
| **Pin and punish.** A hammer hit pins the target for 0.4 s: long enough for a ram or a second weapon. | Hammer pin |
| **Throws into hazards.** Flippers launch light bots farther; launch them into walls, saws or the pit. | Flipper impulse ÷ target mass; airborne landing rules |
| **Carry to danger.** A clamp grabs and drives the opponent into a hazard. | Grab constraint |
| **Bare sides.** Armour is per face; a bot with a heavily plated front has a weak side. | Per-face fittings, camera reads the facing side |
| **The camera's weak spot.** Reading the opponent means pointing your lightly plated camera face at them. | Camera face can't take a heavy plate |
| **Hide and seek.** Pillars block sensors; a bot that loses sight relies on last-known positions. | Line-of-sight rules |
| **Charge management.** Boost, weapons and the camera share one battery. A bot that boosts everywhere can't swing. | Shared charge |
| **Rams hurt both bots.** Ram with a spiked or plated face into their bare side, never face to face with a spinner. | Mutual impact damage with face modifiers |
| **Line up and push.** Getting behind an opponent relative to a hazard sets up a push. | The Line up maneuver |

## Not another LeetCode

| LeetCode trait | Botfight answer |
|---|---|
| Abstract problems | A physical robot in an arena; everything is visible and intuitive |
| Text and syntax | Visual rules in plain sentences; no typing |
| A rating is the only reward | Trophies, medals, cosmetics, titles, bot careers, achievements, highlights |
| Solitary | Friends, rivalries, challenges, cup finals as a shared event |
| Pass/fail | A fight to watch: near misses, comebacks, highlight reels |
| Problems are static | Twists, rotating arenas and seasons keep the best answer moving |
| Grind | Short loops: a daily puzzle in 10 minutes, a cup that needs one evening |

The design rule: **every competitive feature has a spectacle or identity counterpart.** Ratings come with
titles and a history graph; cup results come with a finals event and bot trophies; a good build comes with a
shareable bot card.

## Competitive integrity in one paragraph

All rated fights run on the server with the shared deterministic engine. Bots are locked versions, so nobody
can change a bot mid-contest. Code is private unless its owner publishes it; opponents see behaviour,
never brains. Copying is short-lived because every cup has a twist and every season rotates content. One cup
entry per account; collusion is countered by server-chosen pairings and anomaly checks. Details:
[08](08-competition.md).
