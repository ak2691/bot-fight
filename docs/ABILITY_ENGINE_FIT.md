# Roster vs engine: fit check

2026-10-11, after engine refactor prompts 1–5 ([`ENGINE_REFACTOR_PROMPTS.md`](ENGINE_REFACTOR_PROMPTS.md)).
It reads [`ABILITY_ROSTER.md`](ABILITY_ROSTER.md) (proposed abilities and the rules they follow) against
the engine as it is now ([`ENGINE_PRIMER.md`](ENGINE_PRIMER.md)).

> **Status 2026-10-12:** G1–G5 and the section 4 cleanups are built (prompts 6–10). **G1 is complete:**
> one hit path (`fireHit` in `verbs.js`, called by a bot's activation `hit` and an entity's own `hit`), one
> impact queue (the `impacts` map the tick's resolveHits and entities stages share; `pendingImpacts` is gone),
> and the "immune but holds a hit reaction" rule lives in `applyEffectsToBot` (`effects.js`). A verb in an
> entity event may name `targets`, so one collision can damage enemies and be caught by its owner. Bot hits
> still land when their target entity advances, as before. Every ability in section 2 can now be built.

**This is not a build list.** The roster is a menu: not every ability in it will be added, and some
will change in playtesting. The point of this doc is that **whichever ones we pick should go in
smoothly**: as data, or on a small general building block that also serves other abilities. Where an
ability can't go in smoothly, that's a flaw in the engine, and the fix is more refactoring, not a
special case for that ability.

The rules applied here are the owner's:
- **DRY:** two things that do one job become one thing with a field.
- **KISS:** the smallest building block that covers the real abilities.
- **YAGNI:** no vocabulary until an ability that we actually want needs it, and every new piece
  names at least three abilities it serves (roster section 2).

---

## 1. Where the engine stands

The refactor closed most of the DRY audit ([`ABILITY_ENGINE_AUDIT.md`](ABILITY_ENGINE_AUDIT.md)):

| Audit item | Status |
| --- | --- |
| S1–S4, S6–S8, S10 (statuses as presets, `block`, one `modifier` reader, status `schedule`/`lifetimeEnd`, `interrupts`, Rewind) | done |
| S5 (one status ticker for bots and entities) | done (`tickStatuses`) |
| E1 (`displace`), E2 (one `applyEffectList`), E3 (Phase Strike flag) | done |
| H3 (one `areEnemies`), D1 (tiers in data), D3 (validator imports vocabulary) | done |
| The timeline | removed; attached entities replace it |
| **S9** reflection is still a special case inside `dealDamage` (`reflectTo`) | **open**, see G3 |
| **E4** `requiresConfirmedDamage` is still a one-off condition on healing | **open**, see G2 |
| **H1/H2** hits and collisions still have several implementations | **open**, see G1 |
| **H5** runtime still reads the presentation projection `ABILITY_STATS` (charges, wind-up for aim prediction) | **open**, see section 4 |
| **D2** catalogue summaries repeat numbers ("11 damage and 120 knockback") | **open**, see section 4 |

---

## 2. Every proposed ability, checked

"Data" means it can be written today with existing vocabulary. A gap name (G1–G5) points to
section 3.

| Ability (roster) | Build it as | Engine work | Verdict |
| --- | --- | --- | --- |
| **Lunge** (replaces Heavy Slash) | attached entity: `crouch` → `move` + transition → `stab` with damage and bleed | none | **ready** |
| **Shotgun Blast** (replaces Pistol) | `spawn` with `pattern: fan`, count 7, short-lived pellet projectiles | none. "Deadly up close" comes from pellet spread and a short lifetime, not falloff (a projectile's distance is measured from itself) | **ready** |
| **Tar Pit** | world zone, `continuous` collision applying a short `slow` (slow already blocks dash and sprint) | none | **ready** |
| **Overdrive** | owner status preset with `modifier { stat: "staminaCost", multiply: 0 }` | none: `staminaCost` is already a modifier stat | **ready** |
| **Fan of Blades** (one way) | `spawn` with `pattern: ring`, count 8 | none | **ready** |
| Fan of Blades (returning) | as above, plus a phase that homes back to the owner and ends on reaching it | G5 | small parameter |
| **Boomerang** | out phase (`straight`), then a return phase homing to the owner, removed on reaching the owner; two hit windows via phase-scoped `targetPolicy` | G5 | small parameter |
| **Execute** | activation `hit` with a bonus damage effect `when` target HP < 30% | G2 | needs conditions |
| **Shatter** (idea) | bonus damage `when` the target has `slow`, then remove the slow | G2 | needs conditions |
| **Counter-hit** on Disruptive Beam | the stun effect `when` the target is winding up | G2 | needs conditions |
| **Backstab** on Phase Strike | a follow-up hit (attached entity after the blink) with bonus damage `when` from behind | G2 | needs conditions |
| **Tether Link** | status on the target: a `schedule` event every tick that pulls it toward whoever applied it `when` farther than 200 | G2 + G4 | needs conditions and status sources |
| **Parry** | 300 ms owner status: `damage_immunity`, 1 charge, a `hit` reaction that stuns the attacker | G3 | needs status reactions |
| **Overcharge** (replaces Overclock) | owner status: `modifier outgoingDamage ×2`, 3 charges, a `hitDealt` reaction from weapon hits that spends one | G3 | needs status reactions |
| **Last Stand** (maybe) | owner status with an HP floor and +30% damage | a `minHp` building block | **defer**: one user, and the owner hasn't decided (YAGNI) |
| Parry "resets on success" | a `cooldown` effect | one user so far | **defer**: Parry works without it |
| Repelling Blast wall-slam | a displace that hits the arena edge emits an event | — | **later** (roster section 6) |
| Singularity / Orbital Strike buffs, Grenade cooldown, Wind Burst re-tier | numbers and `tier` in data | none | **ready** |
| Cuts (Concussive Shot, Basic Heal, Proximity Mine, Rail Shot, Gravity Grenade, Reactive Armor, Repeller Drone, Absolute Guard, Null Zone) | remove data, pools and catalogue entries | none, but see G3: cutting Reactive Armor and Absolute Guard frees two building blocks | **ready** |

**The picture:** half the roster is pure data now, thanks to the refactor (attached entities, one
`displace`, statuses as presets, the `staminaCost` stat). Everything else falls into **four small
gaps (G2–G5)**. There is also **one structural flaw (G1)** that has to be fixed first, because the
gaps sit on top of it.

---

## 3. The gaps, and the smallest fix for each

### G1. One hit path, one collision path (structural; do first)

**The flaw.** "Did this shape touch that target, and what happens then?" is still answered in
several places, each with its own rules:

| Path | Where | What it supports |
| --- | --- | --- |
| A bot's activation `hit` | `verbs.js` `hitVerb` / `hitOneDefender` | everything; queues effects on entities |
| An entity's `hit` verb | `verbs.js` `hitFromEntity` | a separate copy with `aim` |
| An entity's `collision` against bots and entities | `AbilityEntitySystem` `canonicalCollisionTargets` (attached entities use the exact shape) | runs the whole `do` list (spawn, transition, remove), but its `applyEffects` only reaches **bots**; entity targets are skipped |
| The **effects** of that collision on an HP entity, **from the target's side** | `applyIncomingEntityEffects` | re-scans every other entity's collision event with the swept **collider**; applies its `applyEffects` effects, ignoring `targetPolicy` and `nearestOnly` |
| "Will this projectile be removed by hitting an HP entity?" | `entityCollisionRemovalIds` | a pre-pass that only understands the "`applyEffects` + `remove`" pattern |

**Why it blocks the roster.** One collision against an entity is decided twice: the source side
decides whether the **verbs** run (shards spawn, the swing removes itself), and the target side decides
separately whether the **effects** land. They use different geometry (an attached swing's exact arc vs
a swept collider) and different rules (the target side ignores `targetPolicy` and `nearestOnly`). So
the two can disagree:
- a shatter-swing's arc touches a drone, so the shards spawn, but the collider misses, so the drone
  takes no damage (or the other way round);
- a Whirlwind with `targetPolicy` interval 200 damages a drone **every tick**.

Every new building block (conditions, reactions) would also have to be wired into all five paths.

**The fix (DRY).**
- **One hit routine** that fires from a source pose (bot or entity), with every option for both
  (audit H1).
- **One collision dispatch:** an entity's `collision` event runs once per touched target, bots and
  entities alike, through the verb executor, from the source's side. Entity targets get their
  effects queued, the way bot hits already queue them (`pendingImpacts`).
- Delete the target-side re-scan and the removal pre-pass.

**Opens:** every conditional ability below works the same against drones, mines and bots. Conditions
and reactions then hook into one place.

### G2. Conditions (`when`) on effects

**Needed by:** Execute, Shatter, counter-hit, Backstab, Tether Link (five abilities, so it passes the
three-user rule).

**The smallest version (KISS):** an effect may carry `when`, a list of checks that must all pass
(AND only). It is checked in `applyEffectList`, which is already the single loop every effect goes
through, so every verb, event and status gets it for free.

```json
{ "type": "damage", "amount": 60, "when": [ { "of": "target", "measure": "hpRatio", "op": "<", "value": 0.3 } ] }
```

Only the measures the roster abilities use (YAGNI):

| Measure | Used by |
| --- | --- |
| `hpRatio` | Execute |
| `hasStatus` | Shatter |
| `windingUp` | counter-hit |
| `fromBehind` | Backstab |
| `distance` | Tether Link |
| `damageConfirmed` | replaces healing's `requiresConfirmedDamage` (audit E4) |

These should reuse the brain's measure code where it reads the same thing, so players learn one
vocabulary.

Plus one effect, `removeStatus { subtype }`, so a condition can **consume** what it checked
(Shatter). It also serves cleanses and Tether Link ending early. Without it, statuses can't be combo
resources.

**Cleanup:** `requiresConfirmedDamage` is removed; Vampiric Beam's heal gets
`when: [{ measure: "damageConfirmed" }]`. `mirrorsDamage` stays: it's an amount source, not a
condition.

### G3. Status reactions: `hit` and `hitDealt`, with charges

**Needed by:** Parry, Overcharge, and reflection (which then stops being a special case). Later:
thorns, "gain stamina when hit", marks that detonate on the third hit.

The roster (section 3c) planned a staged damage pipeline with `modify`/`cancel`. **That is more than
the abilities need.** The refactor already gave us the building blocks:

| Ability | Built from existing blocks | New part |
| --- | --- | --- |
| **Parry** | `damage_immunity` (already exists) blocks the hit | a `hit` reaction that stuns the attacker; `charges: 1` so it fires once |
| **Overcharge** | `modifier outgoingDamage ×2` (already exists) doubles the hit | a `hitDealt` reaction that spends a charge; `charges: 3` |
| **Reflection** | — | a `hit` reaction: damage to the attacker with `mirrorsDamage`. `reflectTo` and the `damage_reflection` block are deleted |

So the whole pipeline becomes **two events and one counter**:

- **Status events `hit` and `hitDealt`**, the same names and the same dispatcher as the existing
  `schedule`/`lifetimeEnd` (and the same `hit` meaning as on entities: the holder was hurt).
- **`charges`** on the status, and **`consume: 1`** on an event. At 0 the status ends.
- **`attacker`** as a target in a reaction's `do` list. For a projectile, the attacker is its owner
  bot (roster open question: "always stun the shooter").
- **One filter, `from: ["weapon"]`**, because Overcharge counts weapon hits only (`weapon: true` is
  already in the data). The roster's other filter values (projectile, zone, ...) have no user yet, so
  they aren't added.
- **Rules kept from the roster:** reactions never trigger reactions (depth 1); deterministic order
  (statuses in the order applied); status ticks and the closing zone are never "hits".

**Ordering detail:** a `hit` reaction must fire even when immunity stops the damage (that's the
point of Parry). So it is dispatched where the attack's effects land (`applyEffectList`, through G1's
single path), not inside `dealDamage`.

**What it deletes:** `reflectTo` in `dealDamage`, the `damage_reflection` building block, and, if
Absolute Guard is cut and nothing else uses it, nothing more: Parry keeps `damage_immunity` alive.
The roster's `cancel`, `modify` and the staged pipeline are **not built**.

### G4. A status knows where its source is

**Needed by:** Tether Link (pull toward the caster, check the distance to the caster). Also any
"leash" or "mark" that measures from whoever applied it.

**Today:** a status effect's `source` is `{ damageSourceKind: "status", ownerSlot }`. It has **no
position**, so `displace from: "source"` or a `distance` check inside a status event can't work.

**Fix:** when a status event runs, `source` resolves to the bot in `sourceSlot` (null if it's dead).
That's one lookup in the status event runner, not a new field.

### G5. Homing to the owner, and catching it

**Needed by:** Boomerang, returning Fan of Blades, and later guard drones that orbit the owner.

**Today:** `seek` always chases the nearest living enemy. Tether Bolt's "return" is `straight`
backward, which misses a moving owner.

**Fix (two small parameters):**
- `movement.target` on `seek`: `"nearestEnemy"` (the default, today's behaviour) or `"owner"`.
- `"OWNER"` as a collision `targets` kind for entity events, so the return phase can
  `remove` itself on reaching the owner. `OWNER` is already a word in the vocabulary (activation
  `applyEffects`), so this extends an existing name rather than adding one.

---

## 4. Smaller cleanups that make additions smoother

These aren't blocking an ability, but each one is a place where adding an ability can go wrong.

| Issue | Why it bites new abilities | Fix |
| --- | --- | --- |
| **H5:** the runtime reads `ABILITY_STATS` (a presentation projection) for charges and for the brain's aim prediction | an ability whose numbers live somewhere the projection doesn't look reloads or aims wrongly | read `timing` from the data; keep `ABILITY_STATS` for the catalogue only |
| `activationActiveMs` falls back to `max(300, durationMs)` when `activeMs` is missing | a new ability without `activeMs` gets a hidden 300 ms+ lock | make `timing.activeMs` required in the validator (audit D4) |
| **D2:** catalogue summaries repeat numbers | every tuning pass of the new roster drifts the text | summaries without numbers; the stats panel shows the data |
| Snare Bomb's `trigger` carries `lifetimeMs: 16000` | an unknown field the validator lets through invites copy-paste | move it to the phase `durationMs` or delete it; make the validator reject unknown trigger fields |
| Pixi status labels are chosen by status name (`statusIsActive(shape, "burn")`) | each new status needs a renderer edit | fine for presentation, but a `label` in the preset would make a new status data only |

---

## 5. Order of work

Each step leaves the goldens unchanged unless it says so.

1. **G1: one hit routine and one collision dispatch.** Write the tests first:
   - an attached arc that touches a drone both damages it and runs its `do` list (and one that
     misses does neither);
   - a Whirlwind (interval 200) damages a drone every 200 ms, not every tick.

   Expect at least the second to fail today. Golden changes are allowed only where an entity
   collision against an HP entity changes; explain each one.
2. **Content that needs nothing**, in parallel with step 1 if it doesn't touch the same files:
   Lunge, Shotgun Blast, Tar Pit, Overdrive, one-way Fan of Blades, and the roster's cuts.
3. **G2: conditions and `removeStatus`.** First user Execute; fold `requiresConfirmedDamage` in.
4. **G3 + G4: status reactions, charges and status sources.** First users Parry and Overcharge;
   move reflection onto a reaction (or delete it with Reactive Armor).
5. **G5: `seek.target: owner` and owner contact.** First user Boomerang.
6. **Section 4 cleanups**, as each area is touched.
7. **Deferred until there's a second user or an owner decision:** `minHp` (Last Stand), the
   `cooldown` effect (Parry reset), wall-slam, charged abilities.

### Stale parts of `ABILITY_ROSTER.md`

Written before the refactor; read with these corrections:
- Section 2 rule 1 and Backstab mention "the timeline": it's gone; use an attached entity.
- Section 3c (the staged damage pipeline with `modify`/`cancel`) is replaced by G3 above.
- Section 3d `seek.target`: `castTarget` has no user yet; only `owner` is proposed (G5).
- Section 3d `staminaCost` modifier and `blockedBy` for sprint: already done.
- Section 7 step 1 (the audit cleanup) is done, apart from the open items in section 1 above.
