# 02 The live loop

How a match runs, what a deploy is, and why its limits matter. Mode rules (nodes, score, respawn) are in
[03](03-crew-and-objectives.md).

## A match at a glance

| Phase | Time | What happens |
|---|---|---|
| Pick | 30 s before the start | Each player picks a starter (a public brain plus a loadout for each bot) and may swap weapons and modules. Both picks are revealed at the end |
| Opening | 0:00–1:00 | Bots leave their bases and take nodes. The first fight is usually around 0:20 |
| Middle | 1:00–6:00 | Node fights, respawns, a Surge every 90 s. Most patches happen here |
| Final | 6:00–8:00 | Node points are doubled. Late patches and all-ins |
| End | 8:00, or when a player reaches the score limit | Higher score wins; equal is a draw |

There's no waiting: something is always happening, and your bots keep acting while you think.

## Starting brains

| Option | Fair? | Floor | Ceiling | Notes |
|---|---|---|---|---|
| **Public starters** (recommended for ranked) | Yes: everyone picks from the same 4–6 brains | Low: no blank page, the crew works from second 0 | High: the match is about how you change it | Both players know each other's starting brain |
| Private saved brains | Players with more preparation time start ahead | Low for whoever owns a good brain | High, but part of the skill moves outside the match | Fine for casual and custom games. The round-based format rejected prepared libraries for the same reason |
| Blank slate | Yes | High: the hardest moment for a beginner | Rewards typing the same basics fast, every match | A fun casual variant ("Cold Start", [03](03-crew-and-objectives.md)) |

With public starters, information in a match has a shape:

- at 0:00 everything is known: both starters are public, like the starting position in chess;
- every patch adds hidden information;
- reveals ([05](05-reading-the-opponent.md)) bring it back into the open as the patched rules fire.

That arc, from full information to fog and back, is where reading happens. Starters rotate by season so no
opening stays solved. Players can save patch ideas as notes or drafts outside a match; they just can't bring a
private brain into ranked.

## The deploy is the move

You edit a **draft** whenever you like; it doesn't affect your bots. **Deploying** sends it.

| Rule | Starting value | Why |
|---|---|---|
| Charges | Hold up to 3, start with 2, regain 1 every 20 s | Limits deploys without forcing a rhythm: you can patch twice quickly after spotting something |
| Patch size | Up to 3 changed cards per deploy | Each move stays small and readable, like a chess move. A big change takes several deploys, as a tech switch takes time in an RTS |
| Upload delay | 1.5 s from deploy to effect | A deploy can't be used as a reflex |
| Minimum gap | 3 s between deploys | Two quick deploys can't act as one big one |
| Announcement | The opponent sees "Blue is uploading patch 4" during the delay, then which roles and lanes changed, not what changed | Your move is visible even when its content isn't |
| Rollback | Any earlier version can be deployed again for one charge, whatever its size | Undoing a bad patch shouldn't be punished twice |
| Force mode | A deploy can put a role's bots into a chosen mode at once (counts as one change) | A direct lever for beginners ("everyone defend"); experts write the same switch as a condition and save the charge |

**What counts as one change:** adding, removing, editing, moving or toggling one card or switch. Adding a mode
counts its cards and switches. Changing a bot's role is one change.

**Charges or a cooldown?** The owner's first idea was a flat 10 s cooldown. That allows up to 48 deploys in
8 minutes and pushes a steady drip of small patches. Charges allow about 25, let a player save up for a key
moment, and make *when* to deploy a decision of its own. Both are worth a playtest; I'd start with charges.

## Why the limits matter: the reaction horizon

If deploys were instant and free, the best play would be to deploy "go left" whenever you wanted to go left: a
clumsy joystick, with the programming reduced to typing commands. Kung Fu Chess, a real-time chess variant, is
playable for the same reason: each piece has a cooldown after it moves, otherwise the fastest clicker would win.

The limits create a **reaction horizon** of a few seconds. Anything faster has to be in your code already:

| Timescale | Examples | Handled by |
|---|---|---|
| Under 2 s | A wind-up, a dodge, a target dying | The brain, always |
| 2–20 s | A node fight, a Surge contest, enemies respawning | The brain, with rules you wrote or patched earlier |
| Over 20 s | The opponent's habits, how they split their crew, their patch history | You: read, then patch |

The design target: **most important events fall in the middle band**. They're too fast to steer by deploy, but
frequent and visible enough to prepare for. That's what makes conditional rules the right tool instead of
commands. If playtests show players steering by deploy, the events are too slow or the limits too loose.

## The loop

```
   watch ──► explain ──────────► change ──────────► deploy ──► check
     ▲       "why did their       "write the          1.5 s     "did it work?
     │        bot do that?"        smallest counter"            what did they change?"
     └─────────────────────────────────────────────────────────────────┘
```

A cycle takes about 60–90 s, so a match has 4–6 of them. Because bots are deterministic, an exploit you find keeps
working until the other player patches it. The time between finding a hole and its owner closing it is the
**exploit window**, and managing it is a core skill:

- exploit quietly (a small edge that's hard to notice) or loudly (big gains that force a quick patch);
- patch now (spend a charge, give some secrecy away) or later (keep the charge, keep losing a little);
- deploy first (gain sooner) or second (answer their patch).

Patches can also be **prepared**: write a draft for the next Surge while waiting, and deploy it 5 s before the
Surge appears, so the opponent sees its effect too late to answer.

## Attention

While you edit, you aren't watching. That tension belongs to the game, the way an RTS player splits attention
between economy and army, but it shouldn't feel like a punishment:

- the arena stays visible while editing (side by side on desktop);
- an event feed and short alerts: "Node B lost", "Runner died to a Mine", "Red deployed patch 3";
- a **replay buffer**: rewind the last 60 s on your own screen while the match continues, to see what happened
  while you were busy;
- your bots keep running their last deployed brain while you think. A disconnect is handled the same way.

No pauses in ranked. A casual queue could give each player one 20 s timeout, or run at 0.75× speed.

## Pacing targets

| Item | Starting value |
|---|---|
| Match length | 8:00, or earlier by score limit |
| Travel between neighbouring nodes | About 5 s |
| A 1v1 fight | 6–10 s; a 2v1 about 3–5 s |
| Respawn | 6 s |
| Surge | Every 90 s from 1:00 |
| Read–patch cycle | 60–90 s |

## An example match

Ana picks the **Split** starter (one bot per node; the nearest ally helps a contested node). Ben picks **Blitz**
(all three bots travel together to the nearest node they don't own). Both know both brains.

- **0:25.** Ben's group takes Ana's node A. Ana knows Blitz always heads to *the nearest node it doesn't own*,
  so she can predict its whole route.
- **0:40, Ana's patch 1 (2 cards).** The bot on the next node in that route drops a mine and retreats when two or
  more enemies come near. Then, with a second small patch, her other bots stop helping it and take whatever
  Ben's group leaves behind. Ben's group walks from empty node to empty node while Ana scores elsewhere.
- **1:50, Ben reads it.** His dossier now shows Ana's new cards: `Module: Mine…` and
  `Move: Retreat when [enemies within ?] ≥ ?`. **Ben's patch:** one bot leaves the group to chase whoever
  retreats.
- **2:40, Ana's sleeper.** "When exactly one enemy is chasing me and an ally is within 600 → turn and fight",
  plus a switch that sends the ally to help. The chaser walks into a 2v1 twice before Ben understands why: the
  card fires only when the trap closes, so it was invisible until then.
- **3:55, Ben's prepared patch.** Eight seconds before the Surge appears, his group switches to "Take the
  Surge". He gets it and breaks Ana's center. Ana loses her lead.
- **6:00 onward, double points.** Ana pulls her bots together to hold two nodes instead of three alone. Ben is
  low on charges and can't answer in time. Ana wins by 40.

Every swing came from reading the other player's rules and answering them, not from guessing.
