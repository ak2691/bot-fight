# Solved matchups: problem, direction, and what to avoid

Status: discussion summary, 2026-10-11. Nothing here is decided beyond what the
"Direction" section marks as accepted. Use it to check new match-design ideas
before exploring them.

## 1. The problem

Two players can meet in the same matchup and face the same problem every time.
A strong answer to "Tether Bolt + Hammer vs Thrust + Windblast" can be found
once, shared, and copied from a second monitor with little thought. Catching
copiers isn't the goal. The game itself should make copying weak.

The reference is **competitive programming**: you learn tricks and algorithms,
but every new problem asks you to work out which tricks apply under new
constraints. Today the game is closer to meeting a problem you've already
solved, or looking up the solution and copying it line by line.

### Why it happens

| Cause | Effect |
| --- | --- |
| The fight is deterministic, starts identically, and kits are revealed in full | The same two brains always produce the same fight, so a "book" can go all six rounds deep |
| Bots read everything exactly and instantly, including which ability the opponent is winding up | For any known behaviour there's one best reaction, which can be written down and published |
| A brain is a complete policy, not a move | One brain can answer every situation, so it can be written once and never edited |
| Saved brains load instantly (fixed kit format) | Lowers the skill floor, but also makes copying immediate. A deliberate trade-off to keep in mind |
| Little macro (by design) | No long-term strategic layer to hide depth in; all depth must come from the mechanics |

Chess is also deterministic and in theory solvable. It's protected by **depth**
(too deep to solve in practice) and **breadth** (positions never repeat), not by
design against cheating. Its cheating problem is handled by detection.

## 2. Vision constraints (fixed)

- A programming game focused on **mechanics** (micro), not macro strategy.
- **One game mode** for now.
- **Deterministic, with no luck**, in the fight or in the brain.
- **Abilities keep their identity.** Their values never change randomly, and
  neither do bot stats.
- **Nothing outside combat varies**: no maps, terrain or environmental events.
- **No artificial limits** on players: no brain or edit budgets, no per-match
  charges.
- The format stays: a continuous fight in six 15-second segments, ended by KO
  or an HP decision.

## 3. Success criteria (agreed)

1. A copied brain should not beat a player who adapts it during the match more
   than about half the time.
2. Many kits see regular high-level play. Some meta always exists; it must stay
   wide.
3. Between two good players, the same matchup plays out noticeably differently
   from match to match. **The full test is a mirror match**: two good players
   with the exact same kit. If both load the best known brain, the fight is
   symmetric and draws. The game is unsolved only if **no brain is unbeatable**,
   so winning a mirror always means out-thinking the other player.
4. No luck, no outside factors, no artificial limits.

## 4. Direction

### Accepted

- **Hide which ability is winding up until it releases.** On screen, all
  wind-ups already look the same, so bots shouldn't know more than a viewer
  does. "They're winding up something" stays readable. How long the wind-up has
  lasted, distance and facing remain honest clues to deduce from.
- **`In View [from → to, arc]`** replaces Angle To and Direction To. It's
  easier to understand than angles. **Approach Angle stays.** The other
  movement measurements are undecided.
  - *Implemented* as the `selectable.inView` condition: the arc is 1 to 360
    degrees, centred on From's facing, and the test is inclusive. Angle To
    and Direction To are removed.

### Principles for anything new

- **Every option loses to something.** At the moment before a wind-up releases,
  the attacker either releases or feints (cancel, 25 stamina) and the defender
  either dodges (dash, 30 stamina) or holds. Each choice beats one and loses to
  the other. These cells must stay decisive (a whiff is punished, a wasted dodge
  costs real stamina and position), or one option dominates.
- **Safe options must cost something that accumulates**: space, stamina or
  time. Backing off wins one exchange but gives ground toward the edge and the
  zone. The zone, the arena edges and the HP decision force engagement, so those
  costs come due.
- **Information must arrive too late to simply react to.** If a tell gives
  enough time to respond, "wait and react" becomes a free universal answer.
- **Variety comes from inside combat**: from the interaction of mechanics and
  the players' choices, never from outside the fight or from chance.
- **Breadth is a balance goal.** Matchup lookup only works if the meta collapses
  to a few kits. With roughly 2,200 possible kits, a wide meta leaves nothing
  worth copying wholesale.

### Undecided

- **Reaction delay:** bots read the opponent about 200 ms late. It stops perfect
  reactions, but on its own it adds no match-to-match variety.
- **Engine fairness for mirrors:** hits on the same tick resolve in roster order
  (`resolveActivationVerbsForRoster` in `ecs/abilities/verbs.js`), which may
  favour one slot in exact trades. Check too whether coordinates are mirrored
  for team two. Both must be symmetric before any mirror result is meaningful.

### Still open

No idea yet gives "a new problem every match" within all the constraints in
section 2. The remaining lever is the **depth and breadth of the combat
itself**: more interactions where no single answer is right, and a wider
viable meta.

## 5. What not to go for

| Idea | Why it was rejected |
| --- | --- |
| Random ability values | Abilities lose identity; it can't be balanced fairly for both players |
| Random bot stats (speed, HP, stamina) | Changes how abilities work: ranged is weak when fast, mobility pointless when walking is fast |
| Seeded start positions and facing | Barely matters; reactive brains settle back into the same rhythm |
| Obstacles and map layouts (shelved design, in git history) | A decision about the map, not about combat: how to get past a wall, not wasting abilities on it |
| Tight brain budget or edit limits | Restrictive, more headache than fun |
| Per-match ability charges | Less fun |
| Player-chosen chance (`Chance %` conditions) | Luck |
| Short simultaneous turns ("WeGo") | A complete brain still never needs editing |
| Revealing brains after each round | Swapping strategies makes the read irrelevant |
| Match conditions or alternative scoring (hit count, control point, signature damage) | Interesting, but more modes are hard to keep updated. One game mode for now |
| Live input or human piloting | Shelved earlier (`TIMED_ROUNDS_MATCH_FORMAT.md` section 11): it becomes a mechanics or netcode game |

## 6. How to check a new idea quickly

Ask in this order, and stop at the first "no":

1. Does it stay within section 2 (no luck, nothing outside combat, abilities
   fixed, no limits, one mode)?
2. **Can a player still write a brain once and never need to change it?** If
   yes, it doesn't address the problem.
3. In a mirror match, does it make an unbeatable brain less likely?
4. Is it fun? Does it add decisions about fighting, not chores around the
   fight?
