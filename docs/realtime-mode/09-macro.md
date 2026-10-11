# 09 Macro: power, position and pressure

Written 2026-10-10 after owner feedback. This replaces the power-up and reveal parts of
[03](03-crew-and-objectives.md) and [05](05-reading-the-opponent.md) where they disagree.

## What the owner wants from macro

- **Intent shows through macro.** Opponents read each other from where bots go, not from code dumps. What
  objective they head for, whether they're visible anywhere important, whether they're farming power or
  invading.
- **Power is temporary and matters.** Short matches, so an upgrade should give a real edge for a while.
- **Power costs something.** Getting it means giving up objectives or map control; rushing objectives means
  risking being underpowered.
- **The meta leans slightly toward power,** but not so far that farming is always right.
- **Fights are decided mostly by macro:** being stronger, arriving first, outnumbering, cutting off escape.
  Close, even brawls can come down to micro, as in any game.

## Three things a crew can spend time on

Every second, each bot is doing one of three things. The game is how you split them, and reading how the
opponent splits them.

| Spend time on | Gives | Costs |
|---|---|---|
| **Power**: collecting charge at wells, taking the Core | Stronger bots for a while | Time away from nodes; bots are off the front and predictable at wells |
| **Position**: holding nodes and the space around them | Points, vision, a forward respawn | Bots stand still in known places; they don't get stronger |
| **Pressure**: invading, ambushing, stealing their wells, hunting farmers | Denies the opponent's power and kills their tempo | Your nodes are thinner; a failed invade is a disaster deep in their side |

This makes a triangle, similar to economy / rush / tech in an RTS:

```
            POWER (greed)
           ▲            ╲
  beats    │             ╲  loses to
           │              ▼
   POSITION (tempo) ◄──── PRESSURE (aggression)
                   beats
```

- **Power beats Position.** A crew that holds nodes early gets a points lead, but a crew that farmed comes back
  at tier 2 and takes nodes back faster than the lead grew.
- **Pressure beats Power.** Farmers sit at predictable wells, far from help. Invaders catch them, kill them and
  take half their charge.
- **Position beats Pressure.** Invaders aren't on nodes. A crew that holds the map scores freely, sees the
  invasion coming through node vision, and meets it with numbers.

Each player usually mixes all three (one bot farming, two holding), so the triangle is about *proportions and
timing*, not three fixed strategies.

## Power systems considered

| System | How it works | Good | Bad |
|---|---|---|---|
| A. Buff camps (League's red / blue buff) | Fixed camps grant a named buff for 60 s | Very simple, very readable | Few decisions: take it when it's up |
| **B. Charge** (recommended) | A per-bot meter filled at wells, decaying slowly, partly lost on death | Continuous trade-off, naturally temporary, rewards kills, readable as a glow | Needs tuning so decay doesn't feel like a chore |
| C. Energy and a forge | Collect energy, walk home, buy an upgrade | Real economy decisions; trips home are ambush chances | Too many steps for 8 minutes; a shop UI to learn |
| **D. Timed big event** (recommended, with B) | A Core appears at fixed times; taking it powers the whole crew | Forces everyone to the same place at a known time; great spectacle | On its own, there's nothing to do between events |
| E. XP levels | Bots level up from kills and time | Familiar | Permanent: snowballs, and the leader only gets stronger |

**Recommendation: Charge (B) for steady power and the Core (D) as the big timed swing.** Buff camps (A) are
what Charge looks like at its simplest; if Charge tests badly, fall back to A.

## Charge

Each bot has a **charge meter, 0–100**.

| Rule | Starting value | Why |
|---|---|---|
| Gaining | Standing in a well: +10 per second | Farming takes real time away from the front |
| Wells | Each well holds 60 and refills at 2 per second | Farming the same well twice in a row isn't worth it; you have to move |
| Decay | −1 per second | Power is temporary; banking it for later doesn't work. A tier lasts about 30 s past its threshold |
| Death | Lose all charge; the killer gains half of it | Killing a powered bot is a big swing; farmers have something to lose |
| Tier 1 at 30 | +15% damage | A small, early edge |
| Tier 2 at 60 | +15% speed, module cooldown −30% | The "power spike": strong enough to win even fights |
| Tier 3 at 90 | Overdrive: hits knock back, capture speed ×2 | Converts power into objectives, so farming pays off on the map |

**Visibility:** a bot's tier shows as a glow ring when it's in vision. Exact charge is private. The opponent's
code can read "enemy tier" for bots it can see, and "last seen tier" for ones it can't.

**Aim:** a tier 2 bot should beat a tier 0 bot of the same kit about 70–75% of the time, and a tier 1 bot about
60%. That's "a decent advantage" without making the fight a formality.

### Why tier 3 captures faster

Without it, power and position never meet: a farmer would be strong but still need as long as anyone to take a
node. Doubling capture speed at tier 3 makes the payoff for greed show up on the scoreboard, which is what tips
the meta slightly toward power. It's also readable: a glowing tier 3 bot heading for your node is a threat
everyone understands.

## Wells and the map

```
              Blue base
        [home well]   [home well]
   (deep well)   A ──── B ──── C   (deep well)
        [home well]   [home well]
              Red base
```

- **Home wells:** two per side, in your half, near your base. Safe-ish and small. Farming them costs time but
  little risk, unless the opponent invades.
- **Deep wells:** two on the midline flanks, beyond A and C. Bigger (90 charge, faster gain) but contested and
  far from bases. Taking one is both power and map control.
- **Invading** means going for the enemy's home wells or catching their farmers. It's the surprise-attack
  fantasy: a well is a known place where an enemy bot will be.

### Well levels are public

Everyone can see every well's current level, even through fog. This is indirect scouting, like seeing that
the enemy jungle camps have been cleared in League:

- "Their left home well is empty and refilling" → a bot farmed there in the last 30 s.
- "Their wells are full at 1:30" → they haven't farmed; their bots are somewhere else. Where?
- "Our deep well dropped" → someone is stealing it right now.

This is the main way intent leaks without anyone seeing the bots.

## Position: what nodes give

Points alone make holding nodes feel thankless. Nodes also give:

| Benefit | Why |
|---|---|
| Points: +1 per second | The win condition |
| Vision in a radius around the node | Map control is information. You see invasions coming |
| Forward respawn: bots respawn at an owned node instead of the base | Map control is tempo. Your dead bots return to the fight faster |

**Overload:** owning all three nodes for 15 s in a row wins the match on the spot. It gives a crew that has
built a power lead a way to end the game, and gives the trailing crew something urgent to stop.

## The Core

- Appears at **2:30** and **5:00** at alternate deep-well sides. Its location is announced 20 s ahead.
- Taking it means channelling for 6 s with one or more bots (faster with more), interrupted by damage.
- Reward: **+40 charge for every living bot in the crew** and 10 s of vision of all enemies.

It forces a decision two minutes in: farm before the Core so you can fight for it, or take nodes while the
opponent farms and concede the Core. It's also the clearest macro read in the game: who is moving toward the
Core spot 15 s before it appears?

## How the lean toward power works

The trade-off has to be close enough that both choices are reasonable. Rough numbers for one bot:

- Farming a home well to tier 2 takes about 6 s there plus 8 s of travel = **14 s away from the nodes**.
  That's about 14 points not scored, or a node that might flip.
- A tier 2 bot then wins its next even fight about 70–75% of the time, and kills give it half the victim's
  charge. One won fight is worth a node flip (6+ s of the enemy's absence plus capture time).
- Decay gives the power about 60–90 s of real value. That's the window to cash it in.

The lean is a tuning target, measured rather than guessed. Write house plans for each corner of the triangle
(Greedy, Tempo, Invader) and batch-simulate them against each other, the same deterministic matchup-table
method planned for weapons. Targets to start from:

| | vs Greedy | vs Tempo | vs Invader | Average |
|---|---|---|---|---|
| Greedy | – | 58% | 45% | 51.5% |
| Tempo | 42% | – | 55% | 48.5% |
| Invader | 55% | 45% | – | 50% |

Greedy is slightly best on average but has a clear counter, which is "leaning slightly toward power".

## Reading the opponent through macro

| What you notice | What it means | Typical answer |
|---|---|---|
| Their home wells drained at 0:40 | Two bots farmed early; they'll spike around 1:30 | Take nodes now, or invade their other well |
| A tier 2 glow heading toward B | They're cashing in their power | Give up B, take A or C, or meet it 2v1 |
| No enemy seen for 10 s and their wells are full | They're grouping or invading | Pull farmers back, check your home wells |
| Our deep well dropping without vision | Someone is stealing it | Send the nearest bot, or accept it and take their node |
| Bots moving toward the Core site at 2:10 | They're contesting the Core | Contest with numbers or punish the empty nodes |
| Their bots always leave a node at the same HP | A code habit | A patch that chases at that HP |

The deploy announcement still matters: "they patched" tells you to watch whether their macro changes. Card-by-card
reveals during the match ([05](05-reading-the-opponent.md)) are no longer needed. Showing both brains after the
match stays, for learning.

## Fog of war

- Each bot sees a radius around itself; owned nodes add vision.
- Outside vision, enemies show as a fading **last-seen ghost** with their last tier.
- Code can only read what its crew sees (plus public information).
- **Always public:** well levels, node owners and capture progress, the Core timer and who takes it, the score,
  and deploy announcements.

## Programming the macro

The plan layer is where most live patching happens. It decides what each bot is *for*, and when to commit.

Plan cards are ordered "when → do" rules like the cards in [04](04-programming-model.md), with macro goals as
actions:

| Goal | Example |
|---|---|
| Farm | `When my charge < 60 and our nearest home well ≥ 40 → Farm it` |
| Hold | `Always → Hold node B` |
| Contest | `When the Core appears in < 15 s and our crew tier ≥ theirs → Go to the Core` |
| Invade | `When their left home well ≥ 50 and 2+ enemies are seen at C → Invade their left well` |
| Regroup | `When 2+ enemies are seen within 600 of me and no ally is near → Regroup at our nearest node` |
| Commit | `When our bots here ≥ theirs and my tier ≥ theirs → Engage` |

**Commit rules** are the heart of it: they turn "I know my strengths" into code. Readings that matter:

- my tier, our crew's average tier, their **seen** tiers and **last seen** tiers;
- allies and enemies seen within a distance;
- time until the Core; time until my charge decays below a tier;
- well levels (theirs and ours), node owners, the score difference.

Because the opponent's power is only partly known (fog, last-seen), commit rules are judgment, not
calculation. A bot that only fights when it can *see* it's stronger can be baited by a hidden third bot.

## What to do with the current abilities

| Option | Verdict |
|---|---|
| Remove abilities; weapons only | Too flat: no traps, no engage tools, little for macro to set up |
| **One module per bot, picked before the match** | Recommended. A crew of three modules is a composition (a Dash scout, a Mine trapper, a Stun engager) that the opponent sees and plans around |
| Abilities as map pickups | Adds randomness and "new ability" problems mid-match |
| Abilities unlocked at tiers | Brings back "the kit changed, rewrite your code" |

Tiers **strengthen** the module (cooldown −30% at tier 2) instead of adding new ones, so power changes *when*
your code should fight, not *how* it's written. About 8 modules from the current pool are enough
([03](03-crew-and-objectives.md#the-bot) lists candidates). Modules that interact with macro are the best fit:

- **Mine / Snare:** trap a well or a route you predict the enemy will use;
- **Dash:** scouting and escaping an invasion;
- **Tether / Repel:** pull a bot off a node or out of a Core channel;
- **Stun:** the surprise-attack opener.

## Snowballing and comebacks

Power snowballs: kills give charge, charge wins fights. Brakes:

- **Decay** stops a lead from being banked.
- **Bounty:** killing a tier 3 bot gives +15 points on top of the usual half of its charge, so hunting the
  strongest bot is always tempting.
- **The Core** comes twice, giving the trailing crew two scheduled chances.
- **Forward respawns** help whoever holds nodes, which is often the crew that *didn't* farm, balancing
  Greedy against Tempo.
- **Overload** needs all three nodes for 15 s, which a crew that's behind can interrupt with one bot.

## Alternatives kept in reserve

- **Data Run economy:** charge must be carried home to be "installed", dropped on death. More ambush routes,
  more steps. Try if Charge feels too passive.
- **Forge choices:** at tier 2, choose Damage or Speed. Adds a decision but also a UI. Try if tiers feel
  samey.
- **Core siege win condition** (destroy their base) instead of points: more dramatic, slower, harder to
  balance. Not for the first version.

## Open questions

- Should the Core give charge, or something only it gives (a crew-wide shield, a temporary 4th bot)?
- Are deep wells too strong if they also give map control?
- Is Overload too swingy in an 8-minute match?
- How many wells? Fewer wells means more fights over them; more means more freedom to farm safely.
