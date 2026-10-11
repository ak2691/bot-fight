# 06 Skill floor and ceiling

## Targets

- A new player understands what they're supposed to do **within 5 minutes**, inside a real match, not before it.
- They change something and see it work **within the first 2 minutes**.
- They beat house bots in their first session.
- What separates players is judgment (what to change, and when), not hand speed or memorized ability numbers.

## Why real time can lower the floor

Today complexity comes first: build everything, then find out what mattered. In a live match it arrives when it's
needed: a bot does something visibly wrong, the player clicks it, changes one card, and watches it work. That's
how most people learn to program, by changing a running thing and seeing what happens.

It works only if:

- the crew already works at 0:00 (starters, defaults);
- the first problems are slow and obvious (house bots, a calm opening);
- each fix is one or two cards;
- nobody has to hold the whole brain in their head.

Real time can also *raise* the floor, through pressure and too much to watch. Most of this doc is about
preventing that.

## The first match (tutorial)

A real match against a house crew ("Drills") that moves slowly and has one obvious habit. In the tutorial only,
the player's crew starts with an empty brain. Each step is prompted by something the player can see:

| Time | What the player sees | What they do | What they learn |
|---|---|---|---|
| 0:00 | Their crew stands still while the Drills take nodes | Drag "Capture nearest node" into Move, then deploy | Cards, lanes, deploying |
| 0:45 | All three bots crowd the same node | Change the target chip to "nearest node no ally is heading to" | Editing a chip; the crew shares one brain |
| 1:30 | Their bots fight to the death and walk back from base | Add `When my HP < 30% → Retreat to base` | Conditions, card order |
| 2:30 | The dossier shows a Drills card: "after respawning, go to node A first" | Put one bot on Guard at node A, or a mine there | Reading the opponent and exploiting a habit |
| 3:30 | "Drills deployed patch 1" | Watch what changed, adjust | Patches are visible; adapting |
| ~5:00 | Win | | |

Modes, roles, situations and variables aren't in the first match. Each comes later through a short challenge, at
the moment the player first needs it.

## Starters

Public starter brains, each a working brain of 8–12 cards with a weakness a player can find:

| Starter | Plan | Weakness |
|---|---|---|
| Anchor | Each bot holds its own node; retreats to heal under 35% HP | Never fights for Surges; retreats at a readable threshold |
| Blitz | All three move together to the nearest node they don't own | Leaves nodes empty; its route is predictable |
| Split | One bot per node; the nearest ally helps a contested node | Can be overloaded 2v1; the helper can be baited away |
| Hunter | Two bots hunt the weakest enemy, one holds B | Chases into traps; loses the node count |

Starters are also the beginner's textbook: four short, readable brains with clear ideas.

## House bots and exploit puzzles

- **House crews** each have one deliberate habit to find. Beating them is practice in reading.
- **Exploit puzzles:** a short scenario against a house crew with a hidden weakness: find it and win within
  2 minutes. They fit the existing puzzles page and work as a daily puzzle, the same for everyone.
- **Patching house bots** in the beginner queue switch to prepared brains on a schedule, announced like real
  deploys, so new players practice noticing patches before they face people.

## Help during a match (beginner queue only)

- **Why bubbles:** hover a bot to see the card it's running.
- **Death recap:** "Runner died to 2 enemies on node C while running 'Capture nearest node'. A card that could
  help: Retreat when outnumbered." One click opens the card.
- **Repeated-problem hints:** after the same kind of death three times, suggest a card.

None of this appears in ranked.

## The order of concepts

| Stage | New ideas |
|---|---|
| Match 1 | Cards, lanes, deploying, one condition, the dossier |
| Matches 2–3 | Numbers and comparisons, card order, toggling, deploy limits |
| Matches 4–6 | Modes and switches (Fight / Retreat), Surge timing |
| Matches 7–10 | Roles, coordination selectors, allies in mode |
| Later | Situations, variables, sleepers, bait, deploy timing |

## Where the depth comes from

| Skill | What experts do |
|---|---|
| Policy design | Write rules that are right in every future case, not only the last one |
| Reading | Work out the opponent's rule from behavior before the dossier reveals it |
| Exploiting | Turn a read into the smallest patch that profits from it |
| Robustness | Leave fewer holes; vary habits so they're hard to spot |
| Deception | Sleepers, bait, decoy deploys |
| Tempo | When to deploy, when to save charges, deploying just before a Surge |
| Allocation | Splitting the crew across nodes (the Blotto game in [03](03-crew-and-objectives.md)) |
| Attention | When to watch, when to edit, what to ignore |

None of these is hand speed, and none is memorizing ability data: kits are small and stay the same for a whole
match.

## Matchmaking

- New players: the tutorial, then the beginner queue against patching house crews until they've won a few, then
  people.
- Ratings as today. Separate ratings per mode if Duel and Hold both exist.

## Measuring the floor and the ceiling

| Measure | Target |
|---|---|
| Tutorial finished | More than 80% of new players |
| First deploy | Within 90 s of the first match starting |
| Deploys per match, new players | 3 or more |
| First win against house bots | First session |
| Rating spread after 20 matches | Wide: skill shows |
| Experts against intermediates with the same starter | Experts win by a lot |
