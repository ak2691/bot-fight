# 01 Diagnosis

Why the current format lacks interaction, why its skill floor is high, and what a fix has to do.

## What "interaction" needs

Two players are interacting when each can:

1. **See** what the other player did;
2. **Respond** to that specific thing, with enough time and the means to do it;
3. **Count on it still being true** when the response lands.

Chess has all three. The move is on the board, you have your clock, and the position doesn't change until you
move.

## Why the current format misses all three

| Need | In the current format |
|---|---|
| See | The opponent's move is a whole brain, and it is hidden. You see one 20 s sample of what it does, then it changes |
| Respond | Both players submit at the same time without seeing the other's new brain. At best you answer last round's brain |
| Still true | Every round adds an ability to both bots, and brains get rebuilt around it. Your counter aims at a brain that no longer exists |

In game-theory terms, each round is a simultaneous-move game with a huge hidden move. A player has two sensible
options: guess (cover the cases you think are likely and hope), or ignore the opponent (build the best bot
against an average opponent). Ignoring the opponent is what the owner noticed: the match feels like solving a
puzzle alone, with the other player as a random variable.

It also explains why "compare our loadouts" is about 90% of the thinking. A loadout is the only information that
is both **visible** and **stable**: you can see the opponent's abilities, and they don't change until the next
pick. Everything about the opponent's *decisions* is either hidden or out of date.

The current format already tries to help (the frozen position, one new ability per round, watching the last
segment), and by the owner's estimate reading the opponent matters maybe 5–10% of the time. The problem isn't
tuning. It's the structure: the move is too big, too hidden, and made at the same moment as the opponent's.

## What a fix has to do

- **Smaller moves:** a change to a few rules, not a new brain.
- **Visible moves:** the opponent knows *that* you changed something right away, and learns *what* over time.
- **Fast feedback:** a change shows its effect within seconds, and the situation it answers comes back often
  enough to test it.
- **No resets:** stop replacing everyone's kit each round. Things that change mid-match (power-ups) should
  change for one player at a time, in plain view.

A real-time format with limited deploys can do all four, if the deploy is designed as the move
([02](02-live-loop.md)) and the opponent's rules can be read ([05](05-reading-the-opponent.md)). Real time alone
isn't enough: if each deploy were a hidden full rewrite, it would be the same blind game, just faster.

## Why the skill floor is high

The owner's measure is how much tutorial a new player needs before they understand what they're supposed to do.
Today that's a lot, because:

1. **Complexity comes first.** Before seeing a single fight, a player must build a brain for everything the
   fight might contain. They only learn what mattered after it's over.
2. **Many ideas at once.** In one sitting a new player meets the behavior tree and its left-to-right order,
   IF / ELSE IF, roots, action categories, conditions with entity pickers and pair values, custom variables,
   chains, a weapon pick, ability picks from tiers, wind-up / active / cooldown, stamina, sprint, fast turn, Dash,
   wind-up cancel, facing and hit arcs, the chess clock and segments. That's close to twenty ideas before the
   first good match.
3. **Slow, coarse feedback.** One 20 s replay after minutes of building. When the bot does something wrong, it's
   hard to tell which rule did it.
4. **The blank page.** Round 1 starts from an empty brain, the hardest moment for a beginner.
5. **Too much to watch.** Up to eight abilities per bot by the end of a match, each with its own timing.

A live format can reverse the first point: the player only has to fix *the next problem they can see*. That
works only if the bot already works when the match starts, the opening is calm, and the kit is small
([06](06-floor-and-ceiling.md)). Without those, real time makes the floor worse, not better.

## What to keep, shrink and drop

| Current piece | In this mode | Why |
|---|---|---|
| Deterministic, server-authoritative engine | Keep | Exploits are reliable, replays exact, results trustworthy |
| Data-driven abilities and weapons | Keep, use a subset | Weapons and a few abilities become the kits |
| Wind-ups and commitment | Keep | They are the tells that make reading possible |
| Condition vocabulary (distance, HP, angles, ready, winding up…) | Keep, regroup | It becomes the card editor's readings |
| Behavior-tree canvas | Not for live editing | Too slow to change under pressure; cards replace it ([04](04-programming-model.md)) |
| Chains | Leave out at first | Timed mode switches cover sequences |
| Stamina, sprint, fast turn, wind-up cancel | Leave out at first | Per-bot resource management is too much with three bots in real time |
| Six segments, blind build phases, per-round picks | Not in this mode | They cause the simultaneity problem |
| Up to eight abilities per bot | One weapon and one module per bot | Both the overload and the "compare loadouts" problem come from kit size |
