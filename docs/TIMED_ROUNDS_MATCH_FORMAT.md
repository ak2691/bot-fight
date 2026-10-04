# Timed Rounds Match Format

Status: proposal, still being considered. Nothing here is implemented. It records the current direction and the reasoning behind it. Verify current code before acting on any of it. Where it conflicts with today's rules in `AGENTS.md` (for example "a timeout is a draw"), this document describes the intended future rules, not the current ones.

## 1. Problem

Today the loop is: build for 3–5 minutes, submit, watch a 20–30 second replay you cannot affect. Building is most of the time and the fight is the exciting part, so matches feel slow, and spectators watch two people silently editing.

Goal: **faster paced, while coding stays the core skill.** No reflex mechanics. The model is **blitz chess**: pure thinking, made fast and tense by a clock.

## 2. Format overview

One continuous fight, split into up to **6 rounds**. There is no best-of series: rounds chain together, and each one builds on the last. Each round is a cycle:

1. **Pick:** fixed (30 s in round 1, 20 s after), not taken from the clock. In round 1, players pick a weapon plus one ability. In rounds 2–6, they pick 1 ability from the offers (3, or 2 in tier 3; see section 5). Both players' picks are revealed to both players.
2. **Build:** both players edit their brain at the same time and in secret. Each player's clock runs until they submit.
3. **Simulate:** one authoritative batch simulation of the next segment. It takes milliseconds.
4. **Watch:** about 30 s of segment playback. **Clocks are paused and editing is locked**, otherwise watching would be free build time.

Repeat until a bot's HP reaches zero or round 6 ends (section 6).

### Phase system changes

This replaces today's fixed-length rounds with fixed pick counts (round 1 picks 3 of 6, round 2 picks 2 of 4, round 3 picks 1 of 3) and fixed timers.

- **Per-player build deadlines:** each player's deadline is when the build started plus that player's remaining clock. The build ends when every player has submitted or run out of clock.
- **The server owns all phase and deadline transitions.**

### 2v2

- **Per-player clocks, not a shared team clock.** A shared clock would let one teammate burn everyone's time, and a player who has submitted should stop their own timer.
- Each player picks their own weapon and abilities, builds their own brain, and sets their own timeout fallback.
- **Open:** can teammates see each other's brains read-only during the build? (Leaning yes.) Are offers shared by all four players or per team?

## 3. Clock

Modelled on a chess time control with a per-move bonus (a Fischer increment).

- **Base clock:** 5:00 per player for the whole match. It was raised from 2:00 because the movement system (section 5a) makes round 1, which builds a whole brain from scratch, much more complex.
- **Increment:** +30 s added at the start of every round, including round 1, so a player starts round 1 with 5:30 and has at most 8:00 of build time over a match.
- **No per-window cap.** A player may spend as much of their clock as they like in one round. The wait is already bounded by the opponent's remaining clock, and the waiting player has plenty to analyze: the frozen position, what the opponent's bot did last segment, and both players' new abilities. Long thinks are a resource, like in chess.
- **Submitting is final**, like a chess move. There is no unlock or take-back. The round starts when both players have submitted.
  - The submit button rejects invalid brains (half-filled conditions, missing targets) and says what's wrong.
  - Misclick protection: a confirm step or hold-to-submit.
- **The server owns the clock.** Deadlines live on the server and the client only displays them (same pattern as `MATCH_TIMING.md`). Allow a small grace period for a submit that is in flight when the clock hits zero.
- Show both clocks to both players and to spectators.
- **Why a large base and a small increment:** the extra complexity lands in round 1. Later rounds integrate one ability into an existing brain. A +1:00 increment was considered, but it adds time to the rounds that need it least and stretches matches.
- **Match length:** each round also has about 1 minute of fixed overhead (pick, replay, holds), about 6 minutes over 6 rounds, and each round lasts as long as the slower player takes.

  | Option | Max build per player | Worst-case match | Typical (about 60% of clock used) |
  |---|---|---|---|
  | 5:00 + 1:00 per round | 10–11 min | about 16–17 min | about 12 min |
  | **5:00 + 0:30 per round (chosen)** | 8 min | about 14 min | about 11 min |
  | 4:00 + 0:30 per round | 7 min | about 13 min | about 10 min |

- **Log clock used per round per player** from the first playtests, so the base and increment can be tuned from evidence. If late rounds feel rushed, raise the increment.

### Running out of clock

Each player chooses a fallback setting while building:

- **Submit current code:** submit the current brain if it's valid, otherwise last round's brain.
- **Submit last round's code:** always resubmit the previous brain.

The new ability is still added to the loadout either way. A brain written generically ("if any ability slot is ready and the target is in its range, use it") can use a new ability with no edits. That is an emergent skill this format rewards.

**AFK protection:** a player who makes no edits for a long stretch is auto-submitted using their fallback setting.

## 4. What carries over between segments

- **The full arena state is frozen and resumed:** HP, positions, rotations, cooldowns, statuses, and in-flight projectiles and entities. There are no position resets.
- **Cooldowns are not reset**, except the newly picked ability, which starts ready.
- **The code carries over.** Players edit their existing brain; they don't start from scratch.
- **Custom variables keep their last-frame values.** The server saves them in the snapshot and loads them back. For each variable the player can choose:
  - **keep:** the value at the last frame;
  - **reset:** the variable's declared default.

  Players cannot type an arbitrary starting value, which would let a bot set state it didn't earn. If that is ever allowed, it must be validated against the variable's type and bounds.
- **Variables changed during the build:** a newly added variable starts at its default, a deleted one is dropped, and one whose type changed resets to its default.
- **A running action chain ends at the round boundary** (section 5d). An ability that is already winding up continues as usual.

## 5. Kit, weapons, and abilities

### Loadout over a match

| Slot | Source |
|---|---|
| Dash | Always present (base, uses stamina) |
| Sprint | Always present (base, uses stamina) |
| Weapon | Picked in round 1 |
| Abilities 1–6 | One per round, rounds 1–6 |

The maximum is **8 abilities** (dash + weapon + 6 abilities). Sprint is a movement mode, not counted as an ability. Many matches will end by KO before round 6, so they never reach the full 8.

### Base kit: dash, sprint, weapon

- **Dash** stays a base ability, now paid for with stamina (section 5a).
- **Sprint** is new, also paid for with stamina (section 5a).
- **Lock On is gone from the base kit.** It removed the facing game entirely, so turning is now a stamina decision: fast turn (section 5a). Its definitions stay in the code so old replays still render.
- **Basic Strike (34) is replaced by the round 1 weapon pick.** Every bot gets a melee weapon, so a separate generic strike is redundant.

The base kit plus the round 1 picks is everything a bot has in segment 1, so the base kit shapes every opening. Balance it first.

## 5a. Movement and stamina

### Goal

Round 1 (one weapon and one ability each) shouldn't be a 50/50. Movement should be the main way to outplay, and it should be a **decision** skill, not a mechanical one. **Distance between the bots must matter**: there must be reasons to stay far, stay close, close the gap, sprint mid-fight, save sprint, and save stamina even while taking damage.

### How an instantly-reading bot gets outplayed

A bot sees the present perfectly, but it can't see the future and can't undo commitments. Movement becomes a puzzle when reacting to the current tick is too late, so the better *predictor and planner* wins. Three ingredients create that:

1. **Commitment:** actions that lock you in for a while (wind-ups, recovery, slow turning). A perfect reader is useless while committed.
2. **One shared resource:** sprinting, dashing and the wind-up cancel all spend one stamina pool, so every use takes something away from another option. The opponent's stamina is visible, so baiting them into spending it is a strategy.
3. **Hidden intent:** the opponent's code is the only secret. Feints and baits exploit code that reacts the same way every time.

### Decided

- **Stamina:** one pool, about 100. It regenerates 20/s (2 per tick) after 800 ms without spending.
- **Exhaustion:** reaching 0 stamina means about **1.5 s with no regeneration**. There is **no movement slowdown**.
- **Facing never affects movement speed.** Walking and sprinting are the same speed in every direction. Facing only matters for where attacks go.
- **Sprint:** about +50% movement speed, in any direction. It drains 30 stamina/s (3 per tick). **Attacking cancels sprint.**
- **Fast turn:** a setting on every Rotate action (like sprint on Walk). It turns twice as fast (24° per tick instead of 12°, still scaled by the hit-stagger rotation multiplier) and drains 20 stamina/s (2 per tick), **only on ticks where the bot actually rotates**; a bot already facing its target pays nothing. Below 2 stamina, or while exhausted, the bot turns at the normal speed for free. It can drain in the same tick as sprint, and attacking does not end it.
- **Dash on stamina:** each dash costs about 30 stamina instead of having a fixed cooldown. Dashes can be chained in short bursts (a 300 ms gap between them) while stamina lasts. It's still strong, but now it's a budget decision rather than "use it when it's ready."
- **Wind-up cancel (feint):** cancel your own wind-up for 25 stamina, with no restart lock (the ability can start again on the next tick; the stamina is the cost). This is how you bait an attack that's too fast to bait by movement alone: code that dashes on every enemy wind-up can be feinted into exhaustion. The counter-skill is "only dodge if they still have the stamina to feint."
- **Hits are checked when the attack lands.** The hitbox is checked at the active frame, after the wind-up, so moving out of range during the wind-up makes the attacker whiff (fighting-game "footsies"). For a bot this becomes a prediction problem: will the target still be in range when my swing lands?
- **Recovery:** for now, an ability's existing active time acts as its recovery window. The owner plans a separate refactor of active and recovery time later.

All numbers are starting points for prototyping. The simulation ticks every 100 ms, so every duration, delay, cooldown and timer is a whole multiple of 100 ms and per-second rates are whole amounts per tick (never values like 750 or 250 ms).

### Open

- ~~**Turning:** fast turn for stamina, and whether Lock On becomes a stamina spend or keeps a cooldown.~~ **Decided:** Lock On leaves the base kit and fast turn (2x step, 2 stamina per rotating tick) replaces it.
- **Optional depth, added one at a time only if fights still feel shallow:**
  - **brace:** spend stamina to reduce incoming damage, which gives stamina a defensive use;
  - **back hits:** bonus damage from behind, which rewards flanking;
  - **corner pressure:** already partly provided by the arena edges and the zone.

### Reasons for each distance decision

| A reason to… | Comes from |
|---|---|
| Stay far | Outside their weapon's reach; regenerating stamina; waiting for them to commit and whiff |
| Stay close | Inside a longer weapon's reach, where it is awkward (Slash under a Thrust's tip); pressuring them toward edges |
| Close the gap | They're exhausted, in their active or recovery time, or cornered |
| Sprint mid-fight | Chase a retreating opponent, or reposition while they're committed to an attack |
| Save sprint | Sprinting into range can't end in an attack (attacking cancels it), and arriving with no stamina leaves no dash to escape a counter |
| Save stamina while taking damage | Spending it now (dodges, feints) can mean exhaustion and a bigger follow-up; sometimes taking a small hit to keep your escape is better |

### Example: round 1, Thrust vs. Slash

- **Thrust** (reach about 220) wants to sit between Slash's reach (about 122) and its own. Its code must time thrusts against where the Slash bot *will be* during a rush, not where it is now, and keep enough stamina to get away.
- **Slash** must get through Thrust's reach. A good bot baits a thrust (step in, step out, or feint), then sprints in during Thrust's active time. A naive one rushes in and eats thrusts.
- Both manage one pool: a Slash bot that dashes in and burns its stamina gets kited, and a Thrust bot that panic-dashes away gets cornered.

### What code must be able to read

| | Values |
|---|---|
| Self | stamina, exhausted, sprinting, turning fast, in active/recovery time |
| Opponent | stamina, exhausted, sprinting, turning fast, in active/recovery time, winding up (and which ability), velocity and heading, facing angle relative to me |
| Reach | my weapon's reach and theirs |

Prediction helpers: only **lead aim** is added (section 5b). "Time until in range" and similar helpers are not, so prediction stays a coding skill.

### Staging

1. **Prototype in the browser practice arena first** (non-authoritative, cheap to discard). Add stamina, sprint, stamina-based dash, the wind-up cancel, and hit checks at the active frame. Then write a few bots against each other to see whether real outplays appear.
2. If it plays well, lock in the core and implement it on the server with parity tests.
3. Add optional depth one mechanic at a time.

Settle the movement core **before** weapon tuning, so weapons aren't balanced twice.

## 5b. Bot language changes

Decided after auditing the current conditions and actions. Goal: more useful information without automating the decisions this format wants players to make.

### Add

- **Lead aim** on Rotate: Face Target (and ability aiming where it applies): aim at the current position, a predicted position N seconds ahead, or **Auto**. Auto assumes the target keeps its current velocity, and uses the selected ability's remaining wind-up plus projectile travel time. It is **not** a perfect intercept: changing direction beats it, so it rewards juking and anticipating jukes.
- **Approach Angle:** the angle between the target's movement and the line to me. 0° means coming straight at me, 90° circling, 180° running away. **Raw Move Direction stays** for odd use cases.
- **Is Moving** (true/false), to replace the main use of Speed.
- **Sprint checkbox on Walk:** sprint is an option on the Walk action, not a separate action, so it never competes for the movement channel. Comes with the movement system (section 5a).
- **Opponent "Any Ability Winding Up"** (true/false): the footsies trigger, "they've committed", without one condition per ability.
- **Reach autofill:** next to the number field of Distance and Angle To conditions, a button lists the bot's equipped abilities and fills the number with that ability's **effective** reach (Distance: hitbox length plus the target's 30-unit radius where the hitbox includes it; Angle To: half the arc). It inserts a plain, editable number, not a live link. The UI still needs design.

### Remove

- **Speed** from the picker. Its uses are covered by Is Moving, Is Sprinting, and Dash Active. Old brains that use it keep evaluating (hidden, unchanged units), so nothing breaks silently.

### Considered and not added

- **Hold Distance / stop at distance N:** a precise partial step would break the fixed 15-unit step that everyone else is bound by. Spacing stays the player's job, using a tolerance band.
- **In Range** as a condition: limiting (players want "slightly closer than in range") and it hides arc and facing math. Reach autofill gives the same help while staying editable.
- **Seeded Random:** the game should stay deterministic and skill-based.
- **Time to Impact:** too much hidden calculation, it changes constantly, and it only covers projectiles.
- **Templates:** not now.
- **Closing speed:** Approach Angle plus Distance cover it.

## 5c. Weapons and abilities

### Weapons

- **Round 1 offers every weapon.** The weapon is the one consistent choice and gives each player an identity for the match. Abilities still bring the randomness.
- **All weapons are melee:** low cooldown, steady damage, at most about 300 units of reach. Long-range, low-cooldown attacks are excluded, because:
  - kiting at maximum range is trivial to code perfectly, so it would dominate;
  - against instantly reacting bots, slow projectiles are always dodged by good code, and instant hits are guaranteed free damage.
- **Anything ranged is an ability with a meaningful cooldown.** If a ranged weapon is ever added, it needs a built-in punish window. The best option is ammo plus reload, which also gives the opponent readable state (`opponent.reloading`).
- **Keep weapon damage modest.** With a larger HP pool and multi-segment fights, sustained damage adds up. If weapons hit hard, every fight is decided by weapon damage and abilities stop mattering.
- **Weapons differ by hitbox and timing, not raw strength.** Names describe the motion, not a character identity, and there are no weapon icons for now:

  | Weapon | Hitbox | Character |
  |---|---|---|
  | Slash (id 1) | Arc 120° | Quick, standard attack |
  | Thrust | Long, thin rectangle | Longest reach; needs accurate facing |
  | Cleave | Wide arc 160° | Slower and bigger than Slash, slightly more damage; readable wind-up |
  | Smash | Rectangle box in front | Between Slash and Cleave in size; knocks the target back |

  Numbers, hitboxes and placeholder visuals are in the implementation plan, section 3. All are starting points for the owner to tune.

  **Check:** Heavy Slash (id 7, tier 1) may overlap with Cleave. Decide whether it stays an ability or is reworked.

### Current weapon-like abilities become real abilities

These are the current low-cooldown ranged "weapons." They move out of the weapon role and become tier 1 abilities with longer cooldowns:

| Today | Becomes |
|---|---|
| Fireball (5) | A Fireball ability: longer cooldown, bigger hitbox |
| Gun (3) | Sniper: long range, long cooldown, visible 0.9 s aim |
| Pistol (12) | Shotgun Blast: 7 pellets in a fixed 40° spread; more pellets hit up close. Done last, with the multi-spawn engine; Pistol is unchanged until then |

**IDs:** keep IDs 3, 5 and 12. Nothing re-simulates old matches, and the ruleset bump to `duel-v2` marks the change.

### Weapons vs. abilities

| | Weapons | Abilities |
|---|---|---|
| Role | Baseline sustained pressure | Burst, control, mobility, utility; swings fights |
| Cooldown | Low | Longer, meaningful |
| Range | ≤ 300 units | Any; long range lives here |

### Ability offers

- **Tiers map to rounds**, two rounds per tier, with no reorganizing of the existing pools:

  | Rounds | Offers drawn from |
  |---|---|
  | Rounds | Offers drawn from | Offers |
  |---|---|---|
  | 1–2 | Tier 1 (Slash removed; it's now a weapon) | 3, pick 1 |
  | 3–4 | Tier 2 | 3, pick 1 |
  | 5–6 | Tier 3 | **2**, pick 1 |

  Fights escalate along with the zone, and nobody gets a top-tier ability in round 1. Tier 3 offers 2 instead of 3 because it has only 6 abilities.
- **Shared offers:** both players see the same offers, as today, from the match seed. Both may pick the same ability.
- **No duplicates:** never offer an ability the player already owns. An ability that was offered but not picked may reappear later within its tier.
- **No guaranteed offers for now.** The current queue-time guarantee feature (`QueueAbilityGuaranteePicker`, `MatchAbilityGuaranteeController`, guarantee handling in `MatchLoadoutService`) is removed or disabled in this format.
- **No role tags for now.** Offers stay purely random within the tier. Revisit if "only utility" matches turn out to be a real problem.
- **Pool sizes stay as they are for now.** More abilities will be added to the tiers later. The current focus is the gameplay loop, not new content.

### HP

**A larger HP pool**, so a fight realistically lasts several segments. Tune it so that one strong segment matters but doesn't decide the match on its own.

### Balancing approach

- **Set a target time-to-kill.** For example: weapon only, no dodging, about 3–4 segments to kill. Derive each weapon's damage per second from that, then adjust for its range and how reliably it hits.
- **Run matchup tables with the deterministic simulation.** Write a few simple reference brains ("chase and melee", "kite and poke with abilities", "hold and counter"), then batch-simulate every weapon against every other, and later weapon and ability combinations. Fights take milliseconds, so a whole win-rate table takes seconds. If kiting with ranged abilities beats chasing with melee most of the time, ranged abilities are too strong.

## 5d. Action chains

Decided 2026-10-02. Built before the timed-rounds format work (P3 onward).

### Problem

The brain is re-read from the top every tick: `for (tick…) code();`. That is right for reacting, but it cannot remember "I'm on step 3 of a combo". Sequences today need custom variables, and a branch that depended on "I just hit" stops matching a tick later, so the rest of the combo never runs.

### Two kinds of logic

- **Roots (reactive):** every root is checked every tick, as today. An action under a true condition repeats every tick it can, so roots never need loops, waits, or persisting actions.
- **Chains (sequential):** a named list of steps that runs in order and remembers where it is between ticks. Waits, loops and "until" only exist inside chains.

The chain is the visible boundary between the two. Actions are never attached to other actions in the main workspace.

### Chains

- A chain is defined once, with a name, and started by a **Run chain** action from any branch (reusable, like a function). Renaming changes the label, not the ID.
- **One chain runs at a time.** If several roots run a chain on the same tick, the highest-priority one wins. Run chain has **If a chain is running: Skip (default) | Replace**. Replace ends the running chain and starts this one in the same tick. There is no separate Cancel chain action: Replace is how a root takes over.
- The running chain is **the priority-0 root for the tick it acts**: whatever action its current step issues goes first in that category (movement, rotation, ability, cancel). A step that issues nothing claims nothing, and roots fill every category it didn't use. Nothing is reserved across ticks.

### Steps

| Step | What it does | When the chain moves on |
|---|---|---|
| Use ability (target and aim as in the normal action) | Starts the ability | **Continue: When it ends** (default): once the ability is no longer winding up or active, for any reason: finished, cancelled by any Cancel Wind-up, or silenced. **Right away:** on the tick it starts. If the ability can't start when reached, skip it and process the next step next tick |
| Walk / Rotate (normal settings, including sprint and aim) | Issues it every tick | After N s, or **until** a condition (max N s) |
| Wait | Nothing | After N s, or **until** a condition (max N s), e.g. "Wait until Thrust Ready, max 1 s" |
| If / Else if | Checks adjacent alternatives once | Runs the first matching nested body, then continues after the group. Else if must immediately follow If or Else if. No match or an empty body continues |
| Variable operations | Instant | Same tick |
| Cancel Wind-up (cancel category) | Cancels the bot's own wind-up; does nothing if there's nothing to cancel or too little stamina | Next tick (no ability can start on a cancel tick) |
| Repeat N times, Repeat while (max N s) | Runs its body | After the last pass. **Going back to the top of a loop always waits for the next tick** |
| Run chain | Calls another chain | When it returns |
| Exit loop / End | Leave the nearest Repeat / return from the current chain to its caller | Immediately |

- **Timing:** all durations are whole 100 ms ticks. "For N s" steps occupy exactly N s of ticks. "Until" steps are checked at the start of each tick, and the chain moves on in the same tick when they're satisfied. The chain issues at most one action per category per tick: a step that needs a category the chain already used this tick waits for the next tick.
- **Wait avoids skipping:** put Wait until Ability Ready before Use to give it time to become usable. A bounded Wait still moves on at its maximum, so the Use can still skip if unavailable then.
- **Deliberate cancels are not failures.** Feints are plain steps: Use Cleave (right away), Wait 0.3 s, Cancel Wind-up, Use Cleave.
- **Chains call chains** like functions: no cycles, at most 3 levels deep, still one running chain. End returns from the current chain to its caller, including from inside a Repeat. Exit loop leaves only the nearest Repeat.
- **What ends a chain:** reaching the end, End at the top level, purposeful Replace, stun, death, or a round boundary.
- **Variables:** chains use the brain's custom variables (no locals or parameters yet). Chain conditions read the world at the start of the tick and see the chain's own earlier writes in that tick.

### Time Since Hit

A new ability value, **Time Since Hit (ability)**: seconds since that ability (or an entity it spawned) last damaged or affected an enemy bot. It works in roots and chains, and covers both "start the combo if Slash connected" and "branch if the second hit landed".

### Tick order

1. All roots are checked against the start-of-tick state.
2. Chain control from roots: the highest-priority Run chain (Skip or Replace).
3. The running chain continues from its saved step (instant steps run until a step issues an action or waits).
4. Roots fill the categories the chain didn't use, by priority. Variable writes apply, the chain's first.
5. The simulation steps.

The bot stores only a small call stack (chain, step position, time in step, loop counters per level). Nothing is scheduled ahead, so the state is deterministic, cheap, and easy to show in replays.

### Editor

A Chains list sits beside Roots, with "+ Chain". Opening a chain (from the list, Open on a Run chain node, or "New chain…" in its picker) switches the workspace canvas to that chain with a breadcrumb (Brain › Punish). The chain has one fixed CHAIN header node. Steps lay out top to bottom automatically; If / Else if have nested bodies in blue brackets; Repeat shows as a violet bracket. Else if is available only immediately after If or Else if. Phones use two screens with a back arrow. Mock it up before building.

### Limits

16 chains per brain, 32 steps per chain (nested steps included), Repeat count 1–20, waits and "while" maxima up to 10 s, loop nesting 2, call depth 3. Chain steps count toward the brain budget once, where they're defined.

## 6. Ending the match

- **Zone escalation:** the closing zone (existing `ClosingZoneSystem`) tightens round by round, pushing bots together and forcing a result.
- **Round limit:** after round 6, the bot with **higher HP wins**. This stops degenerate stalls such as two bots healing forever.
- **Draw** only if both bots die on the same tick, or HP is equal at the round limit.
- Match length varies, as it does in most competitive games. The zone and the round limit guarantee the match ends.

**Rule change:** this replaces today's "a timeout is a draw; a win requires defeating the opponent through HP damage." `AGENTS.md`, result handling, ratings, and result screens must be updated if this format is adopted.

## 7. Where the skill comes from

| Skill | When |
|---|---|
| Choosing a weapon identity, then the right ability from each offer | Pick |
| Integrating a new ability under time pressure | Build |
| Making the high-leverage change for this exact frozen position | Build |
| Reading and punishing what the opponent's bot did | Build, and while waiting |
| Writing generic logic that adapts to abilities not yet picked | Every round |
| Managing the clock across the match | Whole match |

Design rule: **experts should win through judgment, not by building more per minute.** Short windows flatten skill when they reward volume and sharpen it when they reward decisions. The frozen position and the one-ability-at-a-time drip keep each window focused on decisions.

Prepared module libraries were considered and **not adopted**: they would move thinking out of the match.

## 8. Architecture

No real-time server is needed. Each fight segment is an ordinary authoritative batch simulation. The full implementation plan is in [`TIMED_ROUNDS_IMPLEMENTATION_PLAN.md`](TIMED_ROUNDS_IMPLEMENTATION_PLAN.md).

- **Approach: a brain schedule, not snapshots.** To produce segment *k*, the server re-runs the whole match from tick 0 with the original seed. It swaps each bot's brain and loadout at each round boundary, and records only segment *k*. This is deterministic by construction, needs no snapshot format, and costs milliseconds (at most 1,800 ticks).
- **Persistence:** store each round's brains, picks, and variable resets plus the seed, so the whole match re-simulates exactly and stays auditable.
- **Server-side checks:** submit ownership, brain validation and bounds, the offered-ability allowlist (a player can only pick from what they were offered), the weapon allowlist, no duplicate abilities, clock deadlines, and one final submit per player per round.
- **Offer generation** stays deterministic from the match seed and round number (as `MatchLoadoutService` does today), now using the tier-per-two-rounds mapping and excluding abilities the player already owns.
- **Duration caps:** the current 90 s duel cap must become a per-match limit (rounds × segment length).
- **Build-phase preview:** the browser testing room is seeded from the frozen frame (positions, rotations, HP), with the opponent as a stationary dummy. It is non-authoritative.

## 9. Spectating

- Both clocks visible, with chess-broadcast-style tension in time scrambles.
- Ability picks revealed as they lock in.
- After each build, a summary of what changed ("Red added Shield and swapped Dash for Blink").
- A logic trace overlay during fights: which branch fired, plus decision callouts.

## 10. Open questions

- The numbers: base clock, increment, pick time, segment length, HP pool, weapon damage, and the zone schedule.
- The open items in section 5c: final weapon numbers and Heavy Slash vs. Cleave.
- The open items in section 5a: optional depth (brace, back hits). Turning is decided (fast turn replaces Lock On).
- Whether players can run quick test fights against the frozen position during the build, and against what (their own brain only, or the opponent's last-segment behavior).
- Edits per window: unlimited within the brain budget, or a per-round edit budget.

## 11. Explored and shelved

These were considered and set aside. They're kept here so the reasoning isn't lost.

### Live coaching signals

Players press 2–4 boolean buttons during the fight, and the brain reads them as state. **Shelved because** most of what a signal does can simply be coded, so signals become a shortcut around logic rather than a new skill. A wrong signal is also punished hard by cooldowns.

If revisited, the worked-out ideas were:

- **Signals as state:** signals are toggles, not one-tick pulses, plus a `sinceMs` value so code can build one-shot behavior.
- **Ownership:** code owns execution, and a signal expresses intent.
- **Cost:** an energy pool (cheap to turn off) instead of a lockout cooldown.
- **Tick stamping:** the server stamps each input for `currentTick + D` on arrival.
- **Lookahead:** it never simulates past `currentTick + D - 1`.
- **Streaming:** frames are sent at wall-clock time, with a display-side jitter buffer only.
- **Reproducibility:** an input log makes the match reproducible.

### RTS-style commands

The human clicks a move target or focus target, rate-limited, and code handles everything else. It gives the human a job code can't do, but it moves the game away from competitive programming.

### Keybind piloting with scripted assists

The human steers and code automates reflexes, which amounts to "building your own hacks." **Rejected:** it becomes a mechanics game, it invites real external input bots, and it needs shooter-grade netcode.
