# 10 Micro: fighting inside the macro

Written 2026-10-10 with [09](09-macro.md). Macro decides *whether, where and when* a crew fights; micro decides
how a fight goes once it starts. Micro is close to what today's game already is, so the question is mainly how to
fit it under the macro, not how to reinvent it.

## What micro should be

- **Map-aware.** Good micro uses the map: kiting toward allies, retreating along the route away from enemies,
  turning on a chaser when help arrives, fighting at your own node where you respawn close.
- **Decisive only when macro is even.** If both crews arrive with the same numbers and power, micro decides.
  Otherwise macro should mostly decide.
- **Not the live-editing focus.** Fights are too fast to patch during. Micro is mostly prepared before the match
  and tuned between fights.
- **A low floor:** a beginner shouldn't need to program micro at all.

## Options beyond rule cards

| Approach | How it works | Floor | Ceiling | Readable? |
|---|---|---|---|---|
| **Built-in stances** | Brawl, Kite, Hold, Skirmish, Retreat, each with a few sliders (distance, retreat HP, aggression) | Very low | Low | Very: the stance shows as an icon |
| **Custom stances** (today's brain editor) | A stance written with the current behavior-tree editor, made before the match | High | Very high | Through behavior only |
| Utility scoring | Each possible action gets a score from weighted factors (my HP, enemy wind-up, ally distance…); highest score wins. The player sets the weights | Medium | High, subtle | Poor: hard to explain why it did something |
| **Crew tactics** | Built-in group behaviors: focus fire, peel (protect the weakest ally), collapse (everyone converges), bait-and-pull | Low | Medium | Very |
| **Reflexes** | A few event rules that interrupt any stance: "on enemy wind-up in reach → dodge", "on stun → mine at my feet" | Low | Medium | Partly |
| Rule cards (from [04](04-programming-model.md)) | The ordered "when → do" list | Low | Medium | Medium |

## Recommendation: plan → stance → reflexes

```
PLAN (macro, patched live)          decides the goal and when to commit
  └─ picks a STANCE (micro)         how to fight: built-in with sliders, or custom
       └─ REFLEXES (shared)         a few fast interrupts that work in any stance
  + CREW TACTICS                    group behaviors the plan can call (focus, peel, collapse)
```

- **Beginners** only write plans and pick built-in stances: "When outnumbered → Retreat stance", "When engaging
  → Brawl stance". No micro code at all.
- **Intermediate players** tune stance sliders and add reflexes.
- **Experts** write custom stances in the current behavior-tree editor before the match (about 3–4 stances in
  a loadout), then switch between them from the plan. Live patches touch the plan, stance sliders and reflexes;
  rewriting a custom stance mid-match is allowed but slow, which is fine.

This reuses today's work: a custom stance *is* a current brain scoped to one fight. The runtime, the editor and
most readings carry over. What's new is the readings micro needs from the map.

## Readings micro needs from the map

| Reading | Enables |
|---|---|
| Nearest ally, and its distance and direction | Kiting toward help |
| Allies arriving within N s | Turning on a chaser: the counter-ambush |
| Escape direction (away from seen enemies, toward our node or base) | Retreating along the right route |
| Am I at an owned node / inside our vision | Fighting where you respawn close and can see |
| Enemy tier, my tier | Taking or refusing a trade |
| Enemies seen near me vs. last seen nearby | Not walking into a hidden third bot |
| Wall or pillar between me and the enemy | Breaking line of sight, blocking pushes |

Matching built-in movements: **kite toward**, **retreat via** (route choice), **hold at** (a chokepoint),
**cut off** (stand between a fleeing enemy and its nearest ally or node).

## Crew tactics

These are where macro and micro meet, and where three bots beat three individuals:

| Tactic | What the crew does | Beats | Beaten by |
|---|---|---|---|
| Focus fire | Everyone attacks the same target (the lowest HP or the highest tier) | Spread-out fights | Peel, baits that pull focus onto a tank |
| Peel | Bots guard the weakest ally and attack whoever hits it | Divers and assassins | Ignoring the weak bot and taking the node |
| Collapse | All bots converge on one spot when a trigger fires (an ally engages, an enemy is caught alone) | Isolated bots | Being baited into a collapse while another node falls |
| Bait and pull | One bot shows itself, retreats toward hidden allies, the crew turns | Chasers | Not chasing; scouting before chasing |
| Cut off | One bot blocks the enemy's escape route while others engage | Retreat-heavy plans | Grouping |

Each is one action in a plan card, so even beginners can use them.

## Which current mechanics stay

| Mechanic | Keep? | Why |
|---|---|---|
| Wind-ups, hits checked when the attack lands | Yes | The core of fighting decisions, and the tells |
| Facing and hit arcs | Yes | Flanking matters; surprise attacks from behind reward macro |
| Knockback | Yes | Pushing bots off nodes ties micro to the objective |
| Cooldowns | Yes, shortened by tier 2 | Ties power to micro |
| Dash on its own channel | Yes, as a module | Engage and escape |
| Stamina, sprint, fast turn | Optional. Leave out at first | With three bots and charge as a resource, a second resource per bot is a lot. Bring it back for custom stances if fights feel shallow |
| Wind-up cancel (feints) | Optional, for custom stances | Expert depth, invisible to beginners |
| Chains | Only inside custom stances | Sequences belong to micro, not to plans |

## How micro shows up to the opponent

- The current stance shows as an icon on each bot, so it's readable at a glance.
- Custom stances show only as "Custom 1, 2, 3", read from behavior.
- Reflexes show only through what they do.

So micro stays mostly hidden in its details, while the decision to fight, which is macro, is always readable.
