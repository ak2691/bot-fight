# Timed Rounds Match Format

Status: proposal, still being considered. Nothing here is implemented. It records the current direction and the reasoning behind it. Verify current code before acting on any of it. Where it conflicts with today's rules in `AGENTS.md` (for example "a timeout is a draw"), this document describes the intended future rules, not the current ones.

## 1. Problem

Today the loop is: build for 3–5 minutes, submit, watch a 20–30 second replay you cannot affect. Building is most of the time and the fight is the exciting part, so matches feel slow, and spectators watch two people silently editing.

Goal: **faster paced, while coding stays the core skill.** No reflex mechanics. The model is **blitz chess**: pure thinking, made fast and tense by a clock.

## 2. Format overview

One continuous fight, split into up to **6 rounds**. There is no best-of series: rounds chain together, and each one builds on the last. Each round is a cycle:

1. **Pick:** 20 s, fixed, not taken from the clock. In round 1, players pick a weapon plus one ability. In rounds 2–6, they pick 1 ability from the offers (3, or 2 in tier 3; see section 5). Both players' picks are revealed to both players.
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

- **Base clock:** about 2:00 per player for the whole match.
- **Increment:** +20 s added at the start of every round, including round 1, so a player starts round 1 with 2:20.
- **No per-window cap.** A player may spend as much of their clock as they like in one round. The wait is already bounded by the opponent's remaining clock, and the waiting player has plenty to analyze: the frozen position, what the opponent's bot did last segment, and both players' new abilities. Long thinks are a resource, like in chess.
- **Submitting is final**, like a chess move. There is no unlock or take-back. The round starts when both players have submitted.
  - The submit button rejects invalid brains (half-filled conditions, missing targets) and says what's wrong.
  - Misclick protection: a confirm step or hold-to-submit.
- **The server owns the clock.** Deadlines live on the server and the client only displays them (same pattern as `MATCH_TIMING.md`). Allow a small grace period for a submit that is in flight when the clock hits zero.
- Show both clocks to both players and to spectators.
- Numbers (2:00, +20 s, 20 s pick) are placeholders to tune in playtesting. 2:00 + 6 × 20 s = 4:00 of total build time may be tight for integrating up to 6 abilities. The cheapest fix is more time: for example, 3:00 base + 30 s per round, or an increment that grows in later rounds, when brains are most complex.

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

## 5. Kit, weapons, and abilities

### Loadout over a match

| Slot | Source |
|---|---|
| Dash | Always present (base) |
| Lock On | Always present (base) |
| Weapon | Picked in round 1 |
| Abilities 1–6 | One per round, rounds 1–6 |

The maximum is **9** (dash + lock-on + weapon + 6 abilities). Many matches will end by KO before round 6, so they never reach the full 9.

### Base kit: dash and lock-on

- **Dash** stays a base ability. Possibly shorten its cooldown.
- **Lock On stays for now.** It's the simplest option and already works as an ability.
- **Not adopted for now:**
  - a fast-rotate replacement for lock-on (a temporary turn-rate multiplier);
  - sprint;
  - a stamina resource.

  These add a resource system and overhead the format doesn't need yet. Revisit once the loop is proven.
- **Basic Strike (34) is replaced by the round 1 weapon pick.** Every bot gets a melee weapon, so a separate generic strike is redundant.

The base kit plus the round 1 picks is everything a bot has in segment 1, so the base kit shapes every opening. Balance it first.

### Weapons

- **Round 1 offers every weapon.** The weapon is the one consistent choice and gives each player an identity for the match. Abilities still bring the randomness.
- **All weapons are melee:** low cooldown, steady damage, at most about 300 units of reach. Long-range, low-cooldown attacks are excluded, because:
  - kiting at maximum range is trivial to code perfectly, so it would dominate;
  - against instantly reacting bots, slow projectiles are always dodged by good code, and instant hits are guaranteed free damage.
- **Anything ranged is an ability with a meaningful cooldown.** If a ranged weapon is ever added, it needs a built-in punish window. The best option is ammo plus reload, which also gives the opponent readable state (`opponent.reloading`).
- **Keep weapon damage modest.** With a larger HP pool and multi-segment fights, sustained damage adds up. If weapons hit hard, every fight is decided by weapon damage and abilities stop mattering.
- **Weapons differ by trade-offs, not raw strength.** Candidate set (all hypothetical):

  | Weapon | Identity |
  |---|---|
  | Slash (existing, id 1) | The baseline: reliable short-reach swing |
  | Spear | Slightly longer reach, presumably lower damage per second |
  | Axe | Wind-up before the hit, low cooldown, slightly more damage. The wind-up is readable, so the opponent's code can react to it |
  | Daggers | Two quick swings per use |

  **Check:** Heavy Slash (id 7, tier 1) may overlap with Axe. Decide whether it stays an ability, becomes the Axe, or is reworked.

### Current weapon-like abilities become real abilities

These are the current low-cooldown ranged "weapons." They move out of the weapon role and become tier 1 abilities with longer cooldowns:

| Today | Becomes |
|---|---|
| Fireball (5) | A Fireball ability: longer cooldown, bigger hitbox |
| Gun (3) | Sniper: long range, long cooldown |
| Pistol (12) | Shotgun blast: short-range burst, a different feel from Sniper |

**IDs and replays:** these changes alter the behavior behind existing ability IDs. Old replays re-simulated with new behavior would diverge. Either give reworked abilities new IDs, or bump the ruleset version (for example `duel-v1` to `duel-v2`) so old matches keep replaying under the old rules. The format change likely warrants a ruleset bump anyway.

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
- The open items in section 5: the final weapon set, Heavy Slash vs. Axe, and new IDs vs. a ruleset bump for reworked abilities.
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
