# Ability roster and engine building blocks

Proposal, 2026-10-10. Nothing here is built yet. **Read with
[`ABILITY_ENGINE_FIT.md`](ABILITY_ENGINE_FIT.md)** (2026-10-11), which checks each ability against the
refactored engine and replaces sections 3c and parts of 3d and 7. It goes with
[`FIXED_KIT_FORMAT.md`](FIXED_KIT_FORMAT.md) (a weapon plus one ability per tier) and
[`ABILITIES.md`](ABILITIES.md) (how the engine works today).

Most of the current abilities were made early, to get content in. Now that a kit holds
only three abilities, each one has to matter. This doc covers three things:
- the rules every ability should follow;
- the few engine building blocks needed to make better abilities;
- a keep, rework and cut pass over the roster.

## 1. Ability rules

1. **Every ability has real impact.** It deals damage, or it sets up or punishes a hit
   (slow, pull, stun, interrupt, a gap-closer). Nothing that just makes you safe. "Negate
   everything for 1.5 s" (Absolute Guard) is out; "time it right and you stun them"
   (Parry) is in.
2. **Every ability has a readable tell:** a wind-up, a visible object, or a status a
   brain can see ("Has Status", "Any Ability Winding Up"). If the other brain can't
   detect it, it can't respond to it, and there's no move and response.
3. **Missing costs something:** a long cooldown, a self-slow, or stamina. That's what
   makes it a read and not just a button.
4. **One clear job per ability.** Two abilities with the same job (two pull grenades,
   two silences, two "shot that slows") get merged.
5. **Tiers have a strength band:**
   - Tier 1 is the core loop, used several times a segment.
   - Tier 2 swings a fight.
   - Tier 3 is the ultimate, roughly once a segment, and it should feel like one.

## 2. Engine rule: new vocabulary must open paths

Most abilities are just data: verbs, effects, entities, statuses. Some ideas need
something the engine can't express yet (Execute, Parry). Before adding engine code,
an idea has to pass this test:

1. **Can existing vocabulary do it?** The timeline, spawn patterns, entities, statuses
   and events cover a lot. If they can, no code.
2. **Is it a parameter of something that exists?** "Seek the owner" is a parameter of
   `seek`, not a new movement mode.
3. **Name at least three abilities it enables.** If it only serves one, redesign the
   ability instead.
4. **Prefer additions that delete a special case.** A good building block replaces some
   hard-coded branch we already have.
5. **Data only.** Allowlisted fields checked by `gameplayValidation.js`. No expressions,
   no branches on ability IDs or status names.
6. **Deterministic.** A fixed order and a depth limit, with no randomness and no loops.

### Special cases we already have

[`ABILITY_ENGINE_AUDIT.md`](ABILITY_ENGINE_AUDIT.md) lists every place where two things
do one job: statuses checked by name, four effect types that only apply a status, five
modifier shapes, two status tickers, two `hit` verbs, six enemy checks and more. Its
cleanup comes first, and the building blocks below are written against the cleaned-up
engine.

## 3. The building blocks

The model today: an ability runs **verbs**, verbs apply **effects**, things that last
in the world are **entities** with phase **events**, and things that last on a bot are
**statuses**. Three additions make that model complete.

### 3a. Conditions (`when`) on verbs and effects

An effect or verb can carry `when`, a list of checks that all must pass (AND-only, like
brain conditionals). The checks are evaluated on live state at the moment the effect
applies. If they fail, that effect or verb is skipped.

```json
{ "type": "damage", "amount": 60,
  "when": [ { "of": "target", "measure": "hpRatio", "op": "<", "value": 0.3 } ] }
```

Starting measures should use the same names and meaning as the brain's variables, so
players learn one vocabulary:

| Measure | Reads |
| --- | --- |
| `hpRatio` | HP / max HP |
| `hasStatus` | has a status by its preset name (`value: "slow"`), the same as the brain's Has Status |
| `windingUp` | an ability is in wind-up (a counter-hit) |
| `fromBehind` | the source is more than 90° off the target's facing |
| `distance` | the distance from the source |

`of` is `target` or `owner`. It comes with one small effect, `removeStatus { subtype }`,
so a condition can **consume** what it checks. That turns statuses into combo
resources.

**What it opens:**
- **Execute:** bonus damage below 30% HP.
- **Shatter:** double damage to a slowed target, which removes the slow.
- **Counter-hit:** Disruptor stuns if the target was winding up.
- **Backstab:** Phase Strike's follow-up hit gets a bonus from behind.
- **Tether Link** (with 3b): pull only when farther than 200.
- Later, Vampiric Beam's `requiresConfirmedDamage` folds into it.

### 3b. Status events (`on`): statuses get what entities already have

Entity phases already have events (`collision`, `hit`, `killed`, `lifetimeEnd`,
`schedule`) that run verbs. A status is the same idea attached to a bot, so it gets the
same event model, with the **same event names and the same dispatcher** (audit S6). A status `hit` event means the same as an entity's `hit`: its holder was hurt.

```json
"parry": {
  "charges": 1,
  "effects": [],
  "on": {
    "hit": {
      "from": ["direct", "projectile"],
      "modify": { "cancel": true },
      "consume": 1,
      "do": [ { "do": "applyEffects", "to": "attacker",
                "effects": [ { "type": "status", "subtype": "stun", "durationMs": 800 } ] } ]
    }
  }
}
```

| Event | When | Opens |
| --- | --- | --- |
| `hit` | the holder is hit by an attack (the entity event of the same name) | Parry, thorns, "gain stamina when hit", a counter-shield |
| `hitDealt` | the holder's attack hits an enemy bot | Overcharge (next 3 weapon hits double), on-hit procs, marks that detonate on the third hit |
| `lifetimeEnd` | the status runs out on its own (the same name as the entity event) | delayed bombs on a target, Rewind's snap-back (audit S8 replaces the deferred-state system with it) |
| `schedule` (with `intervalMs`) | every N ms while held (the same name as the entity timer event) | Tether Link's leash. Burn, bleed and shock become data on it (audit S6) |

Rules:
- **`from` filters the source:**
  - `direct` (a `hit` verb, which covers weapons and melee) or an entity category
    (`projectile`, `zone`, `trap`, `summon`);
  - status ticks, the closing zone and reaction damage are never "hits".
- **Charges:** `charges` sets how many times the status can fire, and `consume` spends
  them. At 0 the status ends.
- **Reactions never trigger reactions** (depth 1), so two parries or two thorns can't
  ping-pong.
- **Order is deterministic:** the holder's statuses in the order they were applied,
  target before attacker.
- **Reactions are readable:** a status is visible to brains through Has Status, which
  is the tell.

### 3c. One damage pipeline

`damageBot` becomes fixed stages that statuses plug into, instead of a new `if` per
mechanic:

1. **Outgoing:** the attacker's `modifier` effects for `outgoingDamage` (audit S4), plus
   `hitDealt` handlers with `modify` (Overcharge doubles).
2. **Incoming:** the target's `modifier` effects for `incomingDamage` (Bleed today), then
   `hit` handlers with `modify` (Parry cancels).
3. **Floor:** a `minHp` status effect (Last Stand) clamps the result.
4. **Apply:** HP, stagger, hit flash and log, as today.
5. **After:** the `do` lists of the `hit` and `hitDealt` handlers run.

Stages 1 and 2 are the one `modifier` reader that movement, cooldowns and stamina also
use. Modifiers multiply (×1.25 and ×0.5 make ×0.625). Movement takes the strongest one, so
slow and stagger keep working as today. The only new parts are `cancel`, the floor, and
the after-hit reactions.

Reflection then stops being a special case. It's a `hit` handler that deals the
attacker a share of the hit (`do` with damage `mirrorsDamage`).

### 3d. Small parameters, not new systems

| Addition | What it is | Opens |
| --- | --- | --- |
| `seek.target`: `nearestEnemy` (today), `owner`, `castTarget` | a parameter of the existing `seek` movement | Boomerang (out, then seek the owner, removed on contact), Fan of Blades that return, guard drones, homing to a marked target |
| `modifier { stat: "staminaCost" }` | not a new type: one more stat for the single `modifier` reader (audit S4), read by `spendStamina` | Overdrive (free stamina), an Exhaust debuff (double costs) |
| `blockedBy` for sprint and fast turn | data in `movement.json` or `channels.json`, listing **effect types** (`stun`, a movement `modifier`), not status names (audit S1) | slow blocks sprint (agreed), and future "grounded" or "rooted" statuses |
| `cooldown` effect `{ ability: "self", setMs }` | sets an ability's own cooldown | Parry resets on success, resets on kill, "refund if it hits" |

## 4. Roster pass

The catalogue round in `BotLoadout.js` is the tier.

### Tier 1 (today: 11)

| Ability | Verdict | Why |
| --- | --- | --- |
| Sniper (3) | Keep | Clear 900 ms tell, a dodge-or-eat read |
| Grenade (4) | Keep, tune | Its 12 s cooldown is too long for a core tool; about 7 s |
| Fireball (5) | Keep | Poke plus burn |
| Heavy Slash (7) | **Replace with Lunge** | It's another weapon swing (Cleave already exists). Lunge moves you about 150 forward, then hits, with bleed on hit. A gap-closer with damage |
| Concussive Shot (9) | **Cut** | The third "shot that slows" (with Tether Bolt and Disruptor) |
| Basic Heal (10) | **Cut** | A pure safe button. Vampiric Beam covers sustain with damage |
| Proximity Mine (11) | **Cut** | Snare Bomb is the same trap with more identity |
| Pistol (12) | **Replace with Shotgun Blast** | 7 pellets in a 40° fan (a `fan` pattern), deadly up close |
| Frost Ring (26) | Keep | The anti-melee "stay there" burst |
| Tether Bolt (28) | Keep | Pulls a target into your weapon |
| Snare Bomb (29) | Keep | Its "stronger if destroyed" trade-off is a good read |
| Wind Burst (18) | **Move down from Tier 2** | A projectile with knockback, a good core spacing tool |
| **Boomerang** (new) | Add | Two hit windows (out and back), so it's a dodge puzzle. Needs `seek.target: owner` |
| **Parry** (new) | Add | A 300 ms window. A hit inside it is cancelled and the attacker is stunned; a whiff leaves a long cooldown. Needs 3b and 3c |

Result: 11 abilities, with attack, control, a trap and a timed defense that hits back.

### Tier 2 (today: 12)

| Ability | Verdict | Why |
| --- | --- | --- |
| Stun (6) | Keep | A short-range big payoff |
| Repelling Blast (8) | Keep, idea later | "Knocked into a wall: stun" would give it identity (a wall-slam event, section 6) |
| Rail Shot (13) | **Cut** | Sniper plus shock, the same job one tier up |
| Gravity Grenade (14) | **Cut** | Same job as Singularity; keep the stronger one as an ultimate |
| Silence Pulse (15) | Keep | Silence matters a lot with 3-ability kits |
| Reactive Armor (16) | **Cut** | A passive safe button. Parry is the timed version, and its reflection special case goes away with it |
| Hunter Drone (17) | Keep | Pressure the opponent has to answer (kill it or dodge it) |
| Phase Strike (25) | Keep, add Backstab | A follow-up hit from behind with a `fromBehind` bonus (3a and the timeline) |
| Disruptive Beam (30) | Keep, add counter-hit | Stuns if the target was winding up (3a). This is the read game in one ability |
| Repeller Drone (31) | **Cut** | A weaker second drone (3 damage) |
| Vampiric Beam (32) | Keep | Sustain that needs a hit |
| Rewind (21) | **Move down from Tier 3** | A good all-in tool, not a fight-winner |
| **Overdrive** (new) | Add | Every stamina cost is free for about 3 s: dash, sprint, fast turn and cancel. Needs `modifier { stat: "staminaCost", multiply: 0 }` |
| **Tar Pit** (new) | Add | A slow zone, which now also blocks dash and sprint. Sets up hits. Ready, apart from the sprint gate |

Result: 10 abilities, less piled into control, with mobility (Overdrive, Rewind).

### Tier 3: the ultimate tier (today: 6)

Tier 3 *is* the ultimate slot. Matches stay at 6 rounds. Ultimates run on 15–20 s
cooldowns (about once a segment) with big effects and clear tells.

| Ability | Verdict | Why |
| --- | --- | --- |
| Orbital Strike (22) | Keep, buff | Area denial with a visible marker |
| Singularity (27) | Keep, buff | A pull into a big detonation; takes over Gravity Grenade's job |
| Absolute Guard (23) | **Cut** | Negates everything |
| Null Zone (24) | **Cut** | The same job as Silence Pulse |
| Overclock (33) | **Replace with Overcharge** | "Cooldowns faster" is invisible and weak with 3 abilities. Overcharge makes your next 3 weapon hits deal double: visible charges and an obvious threat. Needs 3b and 3c |
| **Execute** (new) | Add | A long-reach strike with a wind-up: 25 damage, plus 60 when the target is below 30% HP. Needs 3a |
| **Fan of Blades** (new) | Add | A ring of 8 blades that fly out and return. Ready (`ring`) for one pass; needs `seek.target: owner` for the return |
| **Tether Link** (new) | Add | Chains the target to you for 4 s at most 200 apart, which forces a fight. Needs 3a and the status `schedule` event |
| **Last Stand** (new) | Maybe | Can't drop below 1 HP for 3 s and deals +30% damage, then is slowed afterwards. An all-in, not a safe button. Needs 3c floor. Owner to decide |

Result: 6 or 7 abilities, every one a fight-winner.

### Retiring IDs

IDs are permanent. A replacement with a different mechanic (Lunge, Shotgun Blast,
Overcharge) gets a new ID, and the old one is removed from the catalogue and the
server's pools. Saved brains that reference a removed ID fail validation, which is
fine, since fixed kits are new anyway.

## 5. Making abilities hit harder

Kits are half the size they were, so each slot carries more. Bots have 225 HP.

| | Cooldown | A landed cast is worth |
| --- | --- | --- |
| Tier 1 | 5–8 s (2–3 casts a segment) | about 20–30 damage, or a setup that leads to it |
| Tier 2 | 8–12 s | about 35–45 damage, or a strong control window |
| Tier 3 | 15–20 s | about 60–80 damage, or a guaranteed combo |

- **Round 1** (weapon plus Tier 1) is the "level 1" of the match. Short Tier 1 cooldowns,
  plus a timed defense in the pool (Parry), give it real move and response without
  ultimates.
- **Big hits keep their tells.** A stronger ability needs a longer wind-up or a more
  visible object, not just more damage.
- **Tune after the roster settles,** with golden scenarios and playtests, not on paper
  first.

## 6. Later ideas (not in scope)

- **Wall-slam:** displacement into the arena edge emits an event. Opens Repelling Blast
  and Smash wall stuns, and Wind Burst pins. Only if 3a/3b feel good.
- **Ricochet Disc, Wall, Deflector, Grapple, Second Wind and Phase Walk:** dropped or
  covered by others (Parry covers deflection, Overdrive covers free movement).
- **Charged abilities** (hold to charge): needs a release action in the brain. Too big
  for now.

## 7. Order of work

1. **The engine cleanup in [`ABILITY_ENGINE_AUDIT.md`](ABILITY_ENGINE_AUDIT.md),
   steps 1–5.** This includes moving tiers into `abilities.json` (D1) before any roster
   edit. Only the slow-blocks-sprint change and the timeline-vs-object bug fix should move
   the goldens.
2. **Conditions (3a)** plus `removeStatus`, then Execute as their first user.
3. **Status events (3b) and the damage pipeline (3c)**, with charges:
   - Parry and Overcharge as their first users;
   - delete Reactive Armor, Absolute Guard and the reflection special case.
4. **Small parameters (3d):** `seek.target`, the `staminaCost` modifier stat, and the `cooldown`
   effect.
5. **Content that needs no engine work:** Shotgun Blast, Lunge, Tar Pit, a one-way Fan
   of Blades. Some of these can run in parallel with 2–4.
6. **Content that needs the new pieces:** Boomerang, Overdrive, Tether Link, Last Stand,
   Backstab, counter-hit.
7. **Remove the cut abilities** and their pools, then do a tuning pass (section 5).

Each step updates `ABILITIES.md` (vocabulary tables), `gameplayValidation.js`
(allowlists) and golden scenarios.

## 8. Open questions

- **Parry against projectiles:** stun the shooter at any range, or only cancel the
  projectile? Proposal: always stun. It's simple, and range is the shooter's risk.
- **Brain names:** should the condition measures share names with the brain variables?
  Proposal: yes, and reuse the brain's measure code where it reads the same thing.
- **Last Stand:** keep or cut?
- **Execute's shape:** a long melee strike or a beam?
