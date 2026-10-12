# Roster design

Draft, 2026-10-12. This is the concrete roster: what stays, what's cut, what moves tier, and the new
abilities, with their behaviour and starting numbers. It builds on:
- [`ABILITY_ROSTER.md`](ABILITY_ROSTER.md): the ability rules (impact, a readable tell, missing costs
  something, one job each, tier bands);
- [`ABILITY_ENGINE_FIT.md`](ABILITY_ENGINE_FIT.md): what the engine can express, and the gaps G1–G5;
- [`FIXED_KIT_FORMAT.md`](FIXED_KIT_FORMAT.md): a kit is a weapon plus one ability per tier, revealed
  before round 1. The weapon and Tier 1 unlock in round 1, Tier 2 in round 3, Tier 3 in round 5.

It describes **behaviour and numbers, not code**. Implementation is left to Haiku prompts, written
when each batch is ready (section 7). Every number is a starting point for playtests and golden
scenarios, not a final value.

Engine tags used below:

| Tag | Meaning |
| --- | --- |
| **data** | writable today with existing vocabulary |
| **G2** | needs conditions (`when`), prompt 7 |
| **G3** | needs status reactions and charges, prompt 8 |
| **G4** | needs status sources with a position, prompt 8 |
| **G5** | needs `seek` to the owner, prompt 9 |

---

## 1. Balance frame

**Base numbers.** Bots have 225 HP and walk 15 units per tick (150 per second; sprint 225). The arena
is 1200 × 1200. A match is six 15-second segments (90 s). A bot needs about 4 ticks (400 ms) to
sidestep its own width, which is the yardstick for "dodgeable".

**Weapons set the baseline.** All four weapons deal about 9–10 damage per second while in range:

| Weapon | Hit | Cycle (wind-up + active + cooldown) | DPS | Character |
| --- | --- | --- | --- | --- |
| Slash (1) | 8, 120° arc, 92 reach | 0 + 300 + 500 = 800 ms | 10 | fast, short |
| Thrust (35) | 10, long rectangle (190) | 100 + 300 + 700 = 1100 ms | 9 | reach |
| Cleave (36) | 15, wide arc (112) | 500 + 300 + 700 = 1500 ms | 10 | slow, readable, big hits |
| Smash (37) | 11 + 120 knockback | 300 + 300 + 700 = 1300 ms | 8.5 | spacing |

They stay as they are. They're balanced against each other, and Overcharge (Tier 3) is tuned
against them.

**What a landed cast should be worth** (from the roster rules, with fixed kits of three):

| Tier | Unlocked | Cooldown | Casts per match (roughly) | A landed cast is worth |
| --- | --- | --- | --- | --- |
| 1 | round 1 | 5–8 s (10 for lingering traps) | 8–12 | 20–30 damage, or a setup that leads to it |
| 2 | round 3 | 8–12 s | 4–6 | 35–45 damage, or a strong control window |
| 3 | round 5 | 15–17 s | 2 | 60–80 damage, or a near-guaranteed combo |

A Tier 3 cooldown of 15–17 s gives about two casts in the 30 s after it unlocks. That makes each one
an event the opponent has to play around.

**Bigger hits get bigger tells.** Every increase in payoff comes with a longer wind-up, a visible
object, or a status brains can see. A number is never raised alone. **Wind-ups all look the same**
([`SOLVED_MATCHUPS.md`](SOLVED_MATCHUPS.md), accepted direction): a long wind-up is a tell by its
length, not by an ability-specific telegraph. Ability-specific visuals start at release.

**Combos are capped by the kit.** A kit holds one ability per tier, so the strongest chains are
T1 + T2 + T3 into a weapon. Section 6 checks those chains.

---

## 2. Summary of changes

| | Keep | Retune | Move | Cut | New |
| --- | --- | --- | --- | --- | --- |
| **Tier 1** | Fireball, Snare Bomb | Sniper, Grenade, Frost Ring, Tether Bolt | Wind Burst (from T2), Repelling Blast (from T2) | Concussive Shot, Basic Heal, Proximity Mine | Lunge (replaces Heavy Slash), Shotgun Blast (replaces Pistol), Boomerang, Parry |
| **Tier 2** | Vampiric Beam | Stun, Silence Pulse, Hunter Drone, Phase Strike (+ Backstab), Disruptive Beam (+ counter-hit) | Rewind (from T3) | Rail Shot, Gravity Grenade, Reactive Armor, Repeller Drone | Overdrive, Tar Pit |
| **Tier 3** | — | Orbital Strike, Singularity | — | Absolute Guard, Null Zone | Overcharge (replaces Overclock), Execute, Fan of Blades, Tether Link |

Pools after the change: **12 / 9 / 6**. Last Stand (roster "maybe") is **not included**: it needs an
HP-floor building block with no other user, and the owner hasn't decided on it.

**IDs.** Cut and replaced abilities keep their IDs retired forever. New abilities take new IDs:

| New ability | ID | Replaces |
| --- | --- | --- |
| Lunge | 38 | Heavy Slash (7) |
| Shotgun Blast | 39 | Pistol (12) |
| Boomerang | 40 | — |
| Parry | 41 | — |
| Overdrive | 42 | — |
| Tar Pit | 43 | — |
| Overcharge | 44 | Overclock (33) |
| Execute | 45 | — |
| Fan of Blades | 46 | — |
| Tether Link | 47 | — |

Loadout codes: each new ability needs an unused one-letter code; the implementer picks them.

---

## 3. Tier 1: the core loop (12)

| Ability | Status | What it does | Numbers | Tell / cost of missing | Engine |
| --- | --- | --- | --- | --- | --- |
| **Sniper** (3) | retune | A long ray after a long aim | 35 damage (was 40), ray 1200, wind-up 900, cooldown 8 s (was 9) | the 900 ms wind-up is the read; a dodge wastes 8 s | data |
| **Grenade** (4) | retune | A thrown blast with falloff | 30 → 18 damage (was 40 → 25), cooldown 7 s (was 12) | visible in flight | data |
| **Fireball** (5) | keep | A projectile that burns | 20 + burn 2/s for 5 s (30 total), cooldown 5.5 s | visible projectile | data |
| **Frost Ring** (26) | retune | Point-blank "stay there" | 15 damage, slow 2 s, push 60, radius 120, cooldown 7 s (was 8.7) | short range: you must be close | data |
| **Tether Bolt** (28) | retune | Hooks a target into weapon range | 12 damage (was 10), slow 1.2 s, pull 250 toward you, wind-up 300, cooldown 7 s (was 7.7) | visible bolt; a miss leaves you without a gap-closer | data |
| **Snare Bomb** (29) | keep | A trap that's stronger if shot | stepped on: 25 + slow 2.2 s + stun 0.2 s; destroyed: 40 + slow 3 s; cooldown 10 s | a visible object; the "shoot it" trade-off is the read | data |
| **Wind Burst** (18) | move from T2 | A ranged push | 18 damage (was 20), push 250, wind-up 300, cooldown 6 s (was 7) | visible projectile | data |
| **Repelling Blast** (8) | move from T2 | A point-blank "get off me" | 18 damage (was 20), push 300, radius 110, cooldown 8 s (was 10) | no wind-up, but short range | data |
| **Lunge** (38) | new | Crouch, leap forward, stab | crouch 200 ms (tell), then leap 150 in one tick, then a stab (rectangle 120 × 40): 18 damage + bleed 2/s for 4 s (26 total); cooldown 6 s | the crouch; a whiff lands you 150 units into the enemy with no attack | data (attached entity) |
| **Shotgun Blast** (39) | new | A close-range spread | 7 pellets in a 40° fan, 5 damage each, 60 units per tick, 300 ms life (about 180 range); wind-up 200, cooldown 6 s. Point blank about 35, at mid range 10–15 | the wind-up; useless at range | data |
| **Boomerang** (40) | new | Two hit windows, out and back | flies straight 450 units (45 per tick), then homes back to you at 45 per tick (20° turn) and is caught; 12 damage per pass (24 if both land); cooldown 6 s | the visible return path is a dodge puzzle | **G5** |
| **Parry** (41) | new | A timed counter | a 300 ms stance (`parry` status). The next attack that hits you in it does nothing, and its attacker is stunned 800 ms (a projectile stuns its shooter, at any range). 1 charge; cooldown 8 s, success or not | brains see the `parry` status; a whiff costs 8 s and leaves you open | **G3** |

**One job each.** Several Tier 1 tools push or slow, so they're checked against each other:

| Ability | Its job |
| --- | --- |
| Frost Ring | keep them here (slow) |
| Repelling Blast | get them off me (point-blank push) |
| Wind Burst | push from range |
| Tether Bolt | bring them to me |

Sniper, Shotgun, Boomerang, Fireball and Grenade all deal ranged damage, but each is a different dodge
problem: a long aim, a short range, a return path, a slow projectile, and a falloff blast. That's
the variety Tier 1 should have.

---

## 4. Tier 2: fight swingers (9)

| Ability | Status | What it does | Numbers | Tell / cost of missing | Engine |
| --- | --- | --- | --- | --- | --- |
| **Stun** (6) | retune | A short-range lockdown | 10 damage + stun 1.2 s, rectangle 184, wind-up 200, cooldown 10 s (was 9.6) | the wind-up and short reach | data |
| **Silence Pulse** (15) | retune | Shuts their abilities off | adds 10 damage (was 0); silence 2 s; wind-up 1000; cooldown 10 s | a 1 s wind-up; the wave is visible | data |
| **Hunter Drone** (17) | retune | Pressure they must answer | drone with 50 HP, shot 6 (was 5) once a second, 6 s life (36 max); cooldown 10 s (was 8) | a visible drone; it can be shot down | data |
| **Phase Strike** (25) | retune + Backstab | Blink through the target, then strike from behind | blink + 15 damage as today; then, 200 ms later, a follow-up hit for 10, plus 15 more if you're still behind them (25 total); cooldown 7 s (**was 1.5 s, far too low for Tier 2**) | the target can turn to face you during the 200 ms to deny the bonus | **G2** (follow-up as an attached entity) |
| **Disruptive Beam** (30) | retune + counter-hit | Punishes a wind-up | 20 damage + slow 1.5 s; **stun 1 s only if the target was winding up** (the plain 300 ms stun is removed); wind-up 200, cooldown 9 s (was 8) | the beam; the bonus only pays on a read | **G2** |
| **Vampiric Beam** (32) | keep | Sustain that needs a hit | 25 → 15 damage by distance, heals what it deals; cooldown 10 s | wind-up 300 | data (then G2 for `damageConfirmed`) |
| **Rewind** (21) | move from T3 | Mark, then snap back | marks your position and HP on cast; 3 s later you snap back to them; cooldown 14 s (was 18) | brains see the `rewind` status and the zone at the mark | data |
| **Overdrive** (42) | new | Free movement for an engage or escape | `overdrive` status for 2.5 s: every stamina cost ×0 (dash, sprint, fast turn, cancel); no wind-up; cooldown 12 s | brains see the status; when it ends you have whatever stamina you had left | data |
| **Tar Pit** (43) | new | A zone that pins them | thrown to the target's position (within 300); a 130-radius pool for 4 s: slow while inside, 3 damage every 500 ms (up to 24); wind-up 300, cooldown 11 s | a visible pool; walk out of it | data |

**Overdrive risk.** Dash has a 300 ms cycle, so 2.5 s of free stamina is up to 8 dashes (1200 units
of movement). That's the point, but it's the first thing to watch in playtests. If it's too strong,
shorten the duration before touching the cooldown.

---

## 5. Tier 3: ultimates (6)

| Ability | Status | What it does | Numbers | Tell / cost of missing | Engine |
| --- | --- | --- | --- | --- | --- |
| **Orbital Strike** (22) | buff | A marked spot, then a big blast | targeted within 400; a visible marker for 1200 ms, then one blast (radius 140): 55 damage + stun 0.5 s; cooldown 16 s (was 18) | the marker is the tell: step out | data (rework its phases) |
| **Singularity** (27) | buff | Pull everyone in, then detonate | pull 12 per tick (was 10) for 1 s, then 60 → 30 damage by distance (was 35 → 15); cooldown 17 s (was 18) | the pull itself is the tell: sprint or dash out | data |
| **Overcharge** (44) | new | Your damage is doubled for your next weapon hits | `overcharge` status for 8 s with 4 charges: **all** your damage is ×2 while it lasts (an `outgoingDamage` modifier, so abilities too), and each **weapon** hit spends a charge; it ends at 0 charges or after 8 s; wind-up 300, cooldown 16 s | brains see the status and its charges; wasted if you can't get into range | **G3** |
| **Execute** (45) | new | A kill shot | wind-up 600 (a long, visible tell); a long strike (rectangle 220 × 50): 25 damage, plus 60 if the target is below 30% HP (67 HP) for 85; cooldown 15 s | the wind-up; above 30% it's a weak hit | **G2** |
| **Fan of Blades** (46) | new | A ring of blades that come back | 8 blades in a ring, out 300 units, then home back to you; 12 damage per blade per pass. A bot usually takes 2–3 blades per pass: about 24–36 out and the same back (up to about 70) | the ring is visible; step between blades | data for one way; **G5** for the return |
| **Tether Link** (47) | new | Forces a fight | a bolt (visible, wind-up 300). On hit the target is `tethered` for 4 s: whenever it's more than 200 from you, it's pulled 30 toward you each tick, and it takes ×1.2 damage. Cooldown 16 s | the bolt can be dodged; brains see `tethered` | **G2 + G4** |

**Overcharge value check:** 4 doubled weapon hits add 32 (Slash), 40 (Thrust), 60 (Cleave) or 44 (Smash).
An ability that lands inside the window is doubled too (KISS: one `outgoingDamage` modifier, not a
weapon-only rule), worth roughly another 15–30. Cleave is the strongest pairing, but its 500 ms wind-up
makes each of those hits readable. Watch the total in playtests; shorten the 8 s window first if it's
too strong.

**Fan of Blades** can ship one-way first (data) with 16 damage per blade. When G5 lands it becomes
the returning version above.

---

## 6. Combo and counter check

The kit limits a bot to one ability per tier, so these are the strongest chains to test:

| Chain | Worst case | Answer |
| --- | --- | --- |
| Tether Bolt → Stun → weapon | about 12 + 10 + 1.2 s of weapon (about 12) = 34 | the bolt is dodgeable; Parry punishes the Stun |
| Stun → Execute | Execute's 600 ms wind-up fits in the 1.2 s stun: 10 + 85 on a low target | intended: an ultimate finishing a combo. Only below 67 HP, and Stun's own tell starts it |
| Tar Pit → Orbital Strike | slowed in the pool, then the marker: about 24 + 55 | Overdrive or Dash out of the pool; the marker is visible for 1.2 s |
| Tether Link → Overcharge | impossible: both are Tier 3 | — |
| Tether Link + Cleave | 4 s at most 200 apart with ×1.2 damage: about 4 Cleave hits (72) | Parry the Cleave; Repelling Blast resets distance (the leash pulls you back, slowly) |
| Singularity → Frost Ring | pulled in, then slowed point-blank | the pull is visible for 1 s |
| Parry vs everything | an 800 ms stun on any attacker | Parry's 300 ms window is visible as a status. Feint (Cancel Wind-up costs 25 stamina) to bait it |

**Counters each new ability has:**
- Lunge: the crouch, plus Repelling Blast or Smash on landing.
- Shotgun Blast: range.
- Boomerang: watch the return path.
- Parry: feint or wait it out.
- Overdrive: wait the 2.5 s.
- Tar Pit: walk out early.
- Overcharge: keep out of weapon range for 8 s.
- Execute: stay above 30% HP, or Parry it.
- Fan of Blades: stand between blades.
- Tether Link: dodge the bolt, or fight back.

---

## 7. Implementation batches (for later Haiku prompts)

Each batch is one prompt, written when its engine work is in. Prompts 6–10 come first.

| Batch | Contents | Needs | Golden impact |
| --- | --- | --- | --- |
| **R1: cuts, moves, retunes** (done 2026-10-12: 12 IDs retired, `retiredIds` in abilities.json; procedural entity renderers for `orbitalMarker` and `orbitalBlast`; golden scenarios changed or removed as listed in the R1 report) | cut 9 abilities (data, catalogue, server pools; IDs retired); move Wind Burst and Repelling Blast to Tier 1 and Rewind to Tier 2; apply every "retune" number above; Orbital Strike's marker-then-blast phases | nothing | large: cut abilities leave scenarios and numbers change. Regenerate and review |
| **R2: new data abilities** (done 2026-10-12: Lunge `l`, Shotgun Blast `b`, Overdrive `O`, Tar Pit `a`; preset `overdrive`; visuals `lunge`, `shotgunBlast`, `pellet`, `lungeStab`, `tarGlob`, `tarPit`, the `overdrive` status aura. Catalogue icons are a separate art stage, exempted in `abilityCatalogueIcons.test.js`. The one-way Fan of Blades was not built: the run plan ships the returning version with Boomerang, see R5) | Lunge, Shotgun Blast, Overdrive, Tar Pit; new presets `overdrive`; new visual types | nothing | new scenarios only (4 abilities plus the Lunge vs Repelling Blast counter; no existing golden changed) |
| **R3: conditional abilities** (done 2026-10-13: Execute `E` (tier 3, bonus check before the base hit so the 30% threshold reads pre-hit HP); Phase Strike's second activation hit replaced by the attached `backstab` follow-up (10, +15 from behind); Disruptive Beam's plain stun removed, a 1 s stun when the target is winding up; Vampiric Beam already heals only on `damageConfirmed`, no change). Visual `execute` (the strike, with its bonus X when the finisher lands; the X reads `abilityVisual.bonus`, set by the hit). The `backstab` and `counterHit` visuals were added in the R4 run. Golden: 5 new scenarios; Phase Strike and Disruptive Beam scenarios changed as intended (`ranged-sniper-pistol-rail`, `concussive-silence-beam`, `rewind-phase`) | Execute, Phase Strike Backstab, Disruptive Beam counter-hit, Vampiric Beam onto `damageConfirmed` | prompt 7 (G2) | Phase Strike and Disruptive Beam scenarios change (intended) |
| **R4: reaction abilities** (done 2026-10-12: Parry `p`, Overcharge `G`, Tether Link `V`; presets `parry`, `overcharge`, `tethered`; visuals `parry`, `overcharge`, `counterHit` and `tetherChain` (status-driven), `tetherLink` (bolt), `backstab` and Execute's bonus X from the hit (`onConditionalHit`). The tether's distance check has no `of`: the validator rejects it on `distance`. Golden: five new scenarios, no existing golden changed. The run plan's Part 1 (Execute, Backstab, counter-hit) was already built as R3; this run closed its visual gaps and kept the circular Backstab hitbox, see the notes) | Parry, Overcharge, Tether Link; presets | prompt 8 (G3, G4) | new scenarios only (plus the R3 Execute finisher description fix) |
| **R5: homing abilities** (done 2026-10-12, labelled R3 in the run plan: Boomerang `B` and Fan of Blades `N` (returning, 8 blades in a ring, 800 ms out so the phase lands on the 100 ms tick, 40 per tick, 20° turn). Visuals `boomerang` and `blade` are shared by both phases. Golden: three new scenarios, including the Boomerang counter; no existing golden changed) | Boomerang; Fan of Blades becomes returning | prompt 9 (G5) | new scenarios only (the one-way Fan of Blades had no scenario) |

**Every batch also covers:**
- **Tells:** each new status (`parry`, `overdrive`, `overcharge`, `tethered`) appears in the brain's
  "Has Status" list and in the status catalogue.
- **Visuals:** a renderer per new visual type. The designs, with live previews and copyable
  PixiJS code (procedural, no sprites), are in [`visuals/ability-visuals.html`](visuals/ability-visuals.html).
- **Catalogue text** without hard-coded numbers (fit doc, D2).
- **Server pools** follow `tier` in the data; nothing to edit by hand beyond the cuts.
- **Golden scenarios** for each new ability, including one "counter" scenario (for example, Parry
  against Stun).

---

## 8. Open questions for the owner

- **Parry against projectiles:** this draft stuns the shooter at any range (simple, and range is the
  shooter's risk). The alternative is to only cancel the projectile.
- **Repelling Blast and Wind Burst both in Tier 1:** 12 Tier 1 abilities is the largest pool. If it
  feels crowded, Repelling Blast is the first candidate to fold into Smash's identity (melee push).
- **Execute's shape:** a long melee strike (this draft) or a beam.
- **Overdrive's duration:** 2.5 s is a guess; it's the ability most likely to need tuning.
- **Rewind in Tier 2:** it's close to a "safe button". It stays because it costs your position, but
  it's the first to revisit if it plays passively.
