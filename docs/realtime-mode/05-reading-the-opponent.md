# 05 Reading the opponent

Reading the other player is the skill the current format is missing ([01](01-diagnosis.md)). It should be
something a beginner can start doing in their first match and an expert can do faster and deeper than anyone.
Information comes from three places:

1. **Behavior:** what the bots visibly do. Always there; reading it well is the expert skill.
2. **The dossier:** the opponent's rules, revealed in stages as they fire. It does part of the reading for
   beginners.
3. **Deploy announcements:** when the opponent changes something, and roughly where.

## What everyone sees

| Layer | Content |
|---|---|
| Bodies | Position, facing, HP, weapon and module, Surge glow |
| Commitments | Wind-ups (with the shape of the attack or module), cooldown rings |
| Role and mode | A role color stripe and a mode color dot on each bot. Never names (see "Server rules") |
| Tells | When a card wins a lane, the bot flashes a small icon for its action: retreat, guard, chase, mine… |
| Deploys | "Red is uploading patch 3" during the 1.5 s, then "Patch 3: Runner, Move ×2, Module ×1" |

Mode dots are a strong clue: you see exactly when their bots change mode, which hints at the switch conditions.
That's on purpose, since it makes reading possible for beginners while the exact conditions stay secret. If
playtests show it gives too much away, mode dots are the first thing to hide.

## Staged reveals

Each of the opponent's cards appears in your dossier in stages, as it is used:

| Stage | When | You see |
|---|---|---|
| 0 Hidden | It has never won a lane | Nothing. Cards that never fire stay secret: **sleepers** |
| 1 Seen | It has won a lane once | Lane, action and target: `Move: Retreat → base` |
| 2 Understood | It has won a lane 3 separate times, or for 3 s in total | The readings, without numbers: `when [my HP] < ? and [enemies within ?] ≥ ?` |
| 3 Known | 6 separate times, or 8 s in total | Everything: `when my HP < 30% and enemies within 400 ≥ 2` |

"A time" is one continuous stretch of winning. Uses by every bot running the card count, so a card shared by
three bots reveals faster. Switches reveal the same way, counted by how often they fire. Defaults are public, and
so is every card of both starters: **at 0:00 the dossier already holds the opponent's whole starting brain.**

A rule reveals itself faster the more it decides. That's fair: the rules that shape the match become known, and
the rare, situational ones keep their surprise.

**After a patch:**

- a revealed card whose readings or action changed drops back to stage 1;
- a card whose numbers alone changed drops to stage 2: you paid a charge to hide your numbers again, but the
  reader keeps the shape;
- either way it's marked **changed in patch 4**, and a removed card is shown struck through.

So patching costs the patcher some secrecy, and tells the reader exactly where to look.

Experts don't have to wait for stage 3. They can work out "it retreats around 30%" by watching. The dossier makes
the same knowledge available to everyone, later.

## The dossier

- Laid out like your own brain: roles, modes, lanes, cards, each at its reveal stage.
- Each card shows when it last fired; clicking it jumps your replay buffer to that moment.
- A patch history: every opponent deploy, its time, and the cards it touched.
- **After the match** both players see the other's dossier completed for every card that fired. Sleepers that
  never fired stay secret, so a trick that never mattered isn't given away. Every match ends as a lesson: you
  see how the other brain changed and why it beat yours.

## Why not show everything?

An "Open Source" variant, with both brains always fully visible, is worth trying with experts. It would be the
purest move-and-response game, with no guessing at all. It's not the default because:

- reading forty cards under time pressure is a lot for a beginner;
- watching would stop mattering, and watching is where the fun of spotting a pattern comes from;
- there would be no sleepers or bait, so no surprises.

## Deception

All of it is code, so all of it is fair:

- **Sleepers:** rules that fire only when a trap closes, invisible until then.
- **Bait:** a visible weakness that's really a trap. A lone bot on a node, with a card that brings two allies the
  moment an enemy steps in.
- **Decoy deploys:** a small patch that makes the opponent check their dossier and wonder what changed. It costs
  a charge.
- **Deterministic variety:** counters and variables that alternate routes or timing, so a habit is harder to
  spot.

## Exploits last until patched

Bots are deterministic, so a working exploit keeps working until its victim notices and patches it. That sets the
rhythm of a match: find a hole, profit, the opponent patches, the patch has holes of its own. It's also why the
"changed" marks matter: after a patch you know where the new hole might be.

## Server rules for information

- **The dossier is built on the server** from the authoritative simulation. The client never receives the
  opponent's brain, only their revealed cards, so a modified client can't learn more than it should.
- **Each player gets their own view of the frames:** tells and mode dots, never card IDs.
- **Spectators** see full information only with a delay of a few minutes; without a delay they see only what the
  players see. Otherwise a player could watch their own match from a second account to read their opponent's
  brain.
- **Moderation:** opponents and spectators see system labels (role colors, "Mode 2", action icons), never names
  a player typed. Player-written names shown to others would be one more chat channel to moderate.
