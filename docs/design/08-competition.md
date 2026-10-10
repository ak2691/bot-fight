# 08 Competition

| Mode | Opponents | Cadence | Stakes |
|---|---|---|---|
| **Daily Gauntlet** | House bots (PvE puzzle) | Daily | Medals, streaks, XP |
| **Weekly Cup** | Players | Weekly, in stages | Builder Rating, trophies, titles |
| **Practice ladder** | Players' ladder bots | Continuous | Ladder rating (practice only) |
| **Challenges** | Friends | Any time | Rivalry records ([09](09-social-and-progression.md)) |

## Match format

- A **game** is one fight on one **arena setup** (arena + spawn layout), up to the ruleset's time limit
  ([03](03-physics.md#how-a-game-ends)).
- A **cup match** is **4 games**: the week's arena, its 2 spawn layouts, each played with spawns swapped. The
  match score is games won (draws count ½); more wins the match; equal is a drawn match.
- A **finals match** is best of 7 games, cycling through the spawn layouts and swaps.

Bots never tire and the engine is deterministic, so more games per match cost only compute, and four games
remove spawn-side luck.

## Weekly Cup

### Schedule (UTC)

| When | What |
|---|---|
| **Mon 00:00** | **Brief** published: the week's arena, the **Cup rule**, banned parts (if any) and the **3 candidate Stage 2 twists**. Entries open. |
| Wed 18:00 | Reminder to players who haven't entered (or whose auto-entry bot is invalid this week) |
| **Thu 18:00** | **Lock.** Stage 1 runs: 6 Swiss rounds (about an hour) |
| Thu ~19:00 | Stage 1 standings published to entrants; your own replays are available |
| **Fri 18:00** | Stage 1 standings and **all Stage 1 replays** public. The **Stage 2 twist** is drawn from the 3 candidates (from the season seed, so it's auditable). **Adapt window** opens: 24 hours |
| **Sat 18:00** | Adapt window closes. Stage 2 runs: 6 more Swiss rounds, continuing from Stage 1 points |
| Sat ~19:00 | Final standings published. Finals are simulated and kept hidden |
| **Sun 18:00** | **Finals Premiere:** the bracket is revealed match by match on the finals page (quarter-finals, then semi-finals, then the final, about 20 minutes apart). Afterwards, everything is public |

### Entering

- Pick a bot and a version (the latest saved by default). It's validated against the cup's ruleset (weight cap,
  bans); errors say exactly what to change. The entry can be changed any time until the lock.
- **Auto-enter (optional):** your designated main bot is entered every week with its latest valid version at the
  lock. If it's invalid under the week's rules, you're told on Monday and Wednesday.
- One entry per account.

### Adapting

During the adapt window each entrant may submit **one replacement version**, validated against the Stage 2
ruleset. Without one, the Stage 1 version plays on. Stage 2 candidates never ban parts or lower the weight cap, so
every Stage 1 entry stays valid.

### Pairing

- **Round 1** pairs by rating: entrants are sorted by Builder Rating, cut into bands of 8 neighbours, and paired at
  random within each band (seeded). Newcomers meet newcomers.
- **Rounds 2–12** use Swiss score groups: within each group, the top half by rating plays the bottom half; no
  rematches; if a group is odd, one player floats down to the next group.
- **Odd field:** the lowest-ranked player who hasn't yet had one plays a **house bot** instead of a bye. The match
  counts normally for the player; house bots are left out of standings and finals.
- **Small fields:** with fewer than 8 players, house bots fill the field to 8. With 13 or fewer in total, the cup
  is a round-robin (rounds split across the two stages) instead of Swiss.

### Scoring and tiebreakers

Match points: win 3, draw 1, loss 0. Ties are broken, in order, by:

1. Opponents' match-win percentage (each opponent floored at 0.33, as in Magic tournaments)
2. Game-win percentage
3. Total damage-taken margin (damage dealt minus taken, over all games)
4. Head-to-head
5. Earlier entry lock time

No random tiebreaks.

### Finals

The top 8 players after Stage 2 (house bots excluded), seeded 1v8, 2v7, 3v6, 4v5; single elimination; best of 7
games with the Stage 2 versions.

### Divisions

Above 64 entrants, the cup splits into an **Open** and a **Rookie** division with separate pairing pools,
standings and finals (same rules and twists). Rookie is for players with fewer than 5 cups entered and a
provisional rating; a top-8 finish or 5 cups graduates you.

### Visibility

| Data | Visible to |
|---|---|
| Your own games and brain trace | You, as soon as each game is simulated |
| Stage 1 standings and replays | Entrants Thu evening; everyone from Fri 18:00 |
| Stage 2 standings | Everyone, Sat evening |
| Stage 2 and finals replays | Everyone, after the Finals Premiere |
| Opponents' brains | Never, unless the owner publishes the bot ([09](09-social-and-progression.md#sharing)) |

## Builder Rating

The headline rating belongs to the **player** (players change bots; the rating measures the builder).

| Property | Choice |
|---|---|
| System | **Glicko-2** |
| Rating period | One cup |
| Results | Every cup match (Swiss and finals) with a fractional score: games won (+½ per drawn game) ÷ games |
| Start | Rating 1500, deviation 350, volatility 0.06 (system constant τ = 0.5) |
| Provisional | Until the deviation drops below 110 (about 3 cups) |
| Missed cups | The deviation grows each missed cup, as Glicko-2 does for empty periods |
| Season start | Every deviation +30 (capped at 350), so ratings can move again; ratings never reset |
| House bots | Fixed ratings with small deviations: anchors that keep the scale stable while the player base is small |
| After each cup | Rating change with a per-match breakdown, and a **performance rating** for the cup (the rating at which your results would be expected) |

**Why Glicko-2, not Codeforces-style or plain Elo:** Codeforces rates you by rank in a field where everyone faces
the same problems. Here we have real head-to-head match results, players play different numbers of matches, and
newcomers need to find their level quickly. Glicko-2 handles all three, and its deviation makes "provisional" a
real, honest concept. "Everyone starts at 1000 and the highest wins" doesn't work for a one-week event: Elo depends
on the order of games and needs many games to settle.

### Titles

| Rating | Title |
|---|---|
| below 1200 | Tinkerer |
| 1200–1399 | Builder |
| 1400–1599 | Mechanic |
| 1600–1799 | Engineer |
| 1800–1999 | Veteran |
| 2000–2199 | Champion |
| 2200+ | Grand Champion |

The current cup winner holds a **Reigning Champion** badge until the next finals.

## Practice ladder

- Each player may place up to **2 bots** on the ladder.
- Every 10 minutes, the scheduler pairs active ladder bots with ratings within 200 of each other (widening when the
  pool is small). Each pairing plays 2 games (spawns swapped); each bot plays at most 12 games a day.
- Games use **this week's arena and Cup rule**, so the ladder doubles as practice for the cup. (In patch week, the
  season defaults.)
- Each ladder bot has its own Glicko-2 **ladder rating**, shown only on the ladder page. It never affects the
  Builder Rating.
- Owners see their own replays and traces. The public ladder page shows names, build cards and records; never code.

## Daily Gauntlet

A puzzle anyone can play in ten minutes, the same for everyone, independent of how many players are online.

- A new gauntlet at **00:00 UTC**, from the season file ([07](07-arenas-and-twists.md#automation)).
- **Fully visible:** the house bots' builds and brains, the arena and the ruleset are all open, and the gauntlet is
  playable in the sandbox. Like a chess puzzle, the challenge is solving it, not guessing.
- **Submit** any bot version legal under the gauntlet's ruleset; resubmit as often as you like until the day ends
  (up to 50 times); your best score counts.

| Type | Goal | Score |
|---|---|---|
| **Combat** (most days) | Beat 3 house bots of rising difficulty, one game each on a fixed spawn | Per win: 1000 + speed bonus (KO wins: 300 × (1 − KO time ÷ 120)) + health bonus (200 × HP % left) |
| **Obstacle run** | Reach the goal zone through hazards, maybe pushing a crate onto a switch plate | Faster is better |
| **Sumo** | Ring out 3 house bots | As Combat |
| **Survival** | Last 60 s against a hunter bot | Time survived, then damage dealt |

**Medals:** Bronze (1 win), Silver (2), Gold (3), **Platinum** (Gold with a score at least the vetted reference
solution's). **Streaks** count consecutive days with Bronze or better. Leaderboards: global top 100 and friends. No
rating effect.

## Joining and pairing: edge cases

| Case | Handling |
|---|---|
| Entering after the lock | Not possible; the page points to the Daily Gauntlet and next week's cup |
| Bot deleted after entering | The entry stands (it's an immutable version); the bot is hidden from the garage |
| Account suspended mid-cup | Remaining matches are forfeited (opponents win 4–0); the suspended account's rating isn't updated |
| Simulation failure | Games retry automatically; a stage never publishes partial results; a delay over 2 hours notifies entrants |
| Ties at the finals cut | Tiebreakers above; fully deterministic |
| Multiple accounts | Email verification, one entry per account, rate limits, and collusion review |
| Collusion (bots recognizing each other and one throwing) | Pairings are server-chosen; repeated lopsided results between the same owners on the ladder or in cups are flagged for review |
| Copied bots | Private code and weekly twists keep copying short-lived. Held in reserve if it becomes a problem: clone detection by behaviour (run high-rated bots through a fixed deterministic benchmark and compare behaviour hashes; list clones as variants credited to the earlier bot) |
| Spoilers | Finals results stay hidden until the premiere; notifications never reveal results |
| Mobile | Every flow works on a phone |

## Rewards

Cups give XP per match and stage, trophies to the top 8 and the winner, and titles through rating. Gauntlets give
medals, streaks and XP. Details: [09](09-social-and-progression.md#progression).
