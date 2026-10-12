# Engine refactor prompts (Haiku)

Five implementation prompts for the design in [`ENGINE_PRIMER.md`](ENGINE_PRIMER.md), which already
describes the end state and is the spec. Run them **in order**. They all touch `abilities.json`,
`verbs.js` and the data validator, so none can run in parallel.

## How to feed them (3 pastes)

| Paste | Prompts | Why grouped like this |
| --- | --- | --- |
| **A** | 1 + 2 | Both are small and mostly data. Their golden diffs are easy to tell apart (a log name; mine scenarios). |
| **B** | 3 | It touches effect code that every push and pull goes through, so its golden diff must be reviewed alone. |
| **C** | 4 + 5 | 5 builds directly on 4's ledger. Neither should change goldens, and 4 stops the run if it does. |

For a combined paste, put this line first, then the prompts in order:

```text
Run these parts in order. Finish each part completely (tests, golden check, golden:update only when the diff is exactly what that part allows) before starting the next. If a part says stop, stop the whole run and report.
```

Bring each paste's diff and golden changes back for review before starting the next paste.

---

## Prompt 1: `onTrigger` → `onActivate`

```text
Task: rename the ability's `onTrigger` to `onActivate`, so "trigger" only ever means a trap going off. Pure rename; no gameplay change.
Spec: docs/ENGINE_PRIMER.md section 1 ("Why onActivate").
Decisions:
- abilities.json key `onTrigger` → `onActivate`; validator, contracts, engine and frontend readers follow.
- Rename identifiers and comments that mean "the ability activated" (e.g. triggerVerbs → activationVerbs, "trigger tick" → "activation tick", resolveTriggerVerbsForRoster → resolveActivationVerbsForRoster).
- Combat-log kind "trigger" becomes "activate".
- Do NOT rename trap vocabulary: phase `trigger`, the `trigger` event, trigger radius, resolveTriggers, replay eventType "trigger".
Traps: the delayed-step timeline code still exists (prompt 4 removes it); rename it, don't delete it yet.
Goldens: the only allowed diff is the combat-log kind "trigger" → "activate". Anything else: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test (abilities.json is on the server classpath).
Docs: ABILITIES.md and any context.md that says onTrigger. Don't edit ENGINE_PRIMER.md. Don't commit.
```

## Prompt 2: trap triggers (proximity vs body)

```text
Task: a trap has two sensors: proximity (trigger radius + `contact`) and its body (hitbox + health). Delete the flags that duplicated "being hit". Intended gameplay change: Proximity Mine can be shot.
Spec: docs/ENGINE_PRIMER.md section 2, "Health" and "Trigger".
Decisions:
- `trigger.botContact: true` → `trigger.contact: ["BOT"]`. `contact` is a non-empty list of "BOT" | "SUMMON"; enemy bodies only; it replaces botContact everywhere.
- Delete `attackHits` and `projectileOverlap`, and `entityHitIds` if nothing else reads it.
- `chain` stays as is.
- Proximity Mine `armed` phase: hitbox circle radius 12, `health: { hp: 1, maxHp: 1 }`, and `on.killed` → transition to "active" (same as its trigger handler). The `travel` phase stays unshootable.
- Who can damage the mine follows the normal rules (attack targets HP_ENTITY, enemies only).
Traps:
- An HP entity with no killed handler is removed on death; the mine must explode, not vanish.
- After a killed → transition, the entity has hp 0; check the `active` phase still runs its collision and isn't culled (see the health check in settleTriggerEntities).
- A killed trap still counts as fired for `chain` (keep that).
- The contact check uses findTargets with only the bot kind today; SUMMON needs the entity kind with an enemy-summon filter.
Tests: an enemy Slash on the armed mine explodes it; a Slash inside the radius that misses the body does nothing; the owner's own attack can't hit it; contact ["BOT","SUMMON"] fires on an enemy drone (test ability); the validator rejects botContact, attackHits and projectileOverlap.
Goldens: only scenarios where an enemy attack or projectile damages an armed mine may change (it now explodes), plus the mine's new hp fields in state. Explain each scenario before golden:update. Anything else: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md section 6 (trap trigger). Don't edit ENGINE_PRIMER.md. Don't commit.
```

## Prompt 3: one `displace` effect (knockback, pull, teleport)

```text
Task: replace the effects knockback, pull and teleport with one `displace` effect, and rebuild Phase Strike from two ordinary hits. No gameplay change.
Spec: docs/ENGINE_PRIMER.md section 4, "`displace`".
Decisions:
- Shape: { type: "displace", who: "target"|"owner", from: "source"|"owner"|"target", direction: "away"|"toward"|"mirror", distance }. `distance` supports `falloff` like damage's amount; `mirror` takes no distance (lands as far past `from` as the mover started from it, on the line from the mover through `from`).
- Delete the knockback, pull and teleport types, TELEPORT_DISTANCE_MODES, pullDirection, knockbackDirection (the "velocity" mode is unused), originalTarget, activation.teleportOncePerActivation, and the teleport branches in hitVerb (teleportApplied, skipEffectTypes, the pre-teleport effect source).
- Every displacement goes through the `displace` mutator. `who: "owner"` is allowed only in onActivate (validator), like other self effects.
- Phase Strike data: exactly the two hits in the primer, but use `"oncePerTarget": "step"` on both instead of `targetPolicy` (prompt 4 converts it). Keep its activation.capture.
- Combat-log effect names become "displace".
- displace counts as an enemy hit (Time Since Hit, stamina refund) only when who is "target".
Traps:
- Preserve results exactly. Owner displacement today also zeroes velocities, sets movementStart and applies the phase-facing rule (triggeredPhaseFacingMode); target displacement doesn't. If one code path would change goldens, keep the difference as a mutator option.
- amountAtDistance reads `amount`; make falloff read displace's `distance`.
- The second Phase Strike hit must read the captured (pre-blink) hitbox pose.
- Catalogue and stats (gameconfig/Abilities.js ABILITY_STATS, BotLoadout text, abilityStatsPresentation) must show the same knockback/pull/teleport numbers and labels, now derived from displace (away / toward / mirror).
Tests: Phase Strike: the nearest bot is blinked through and damaged once, the others in the box are damaged once, and the second box doesn't move with the blink. Each rewritten ability keeps its displacement numbers. The validator rejects the old types and an owner displace in an entity event.
Goldens: only combat-log effect names knockback/pull/teleport → displace. Positions, hp and state hashes must be unchanged; Phase Strike entry order may change only if amounts and targets don't. Anything else: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md sections 2 and 6 (effects table). Don't edit ENGINE_PRIMER.md. Don't commit.
```

## Prompt 4: remove the timeline; `targetPolicy.scope`

```text
Task: delete the activation timeline (atMs) and oncePerTarget. Double-hit rules become one `targetPolicy` with a scope, on hit verbs and entity events. No gameplay change.
Spec: docs/ENGINE_PRIMER.md section 1 ("Activation verbs all happen at once", the hammer) and section 2 (targetPolicy table).
Decisions:
- Delete atMs and every delayed-step path (timeline state on the ability record, due-step functions, step visuals, step ledgers, delayed move steps). The validator rejects atMs and oncePerTarget.
- Keep: a move keeps travelling while its ability is active in any channel (moveAbilityId), and a new move replaces a running one.
- targetPolicy = { mode: everyTick|once|interval, intervalMs?, scope?: phase|entity|activation }. Default scope phase (today's ledger, reset on transition). entity: never reset. activation: one ledger per cast.
- Activation ledger: stored on the bot's ability record, keyed by the activation serial; read and written by the cast's activation hits and by every entity that carries that activation serial (entities spawned by the cast, and anything they spawn). It resets when the ability activates again. Replace it, never edit it in place (frames must stay valid).
- On onActivate hit verbs, only { mode: "once", scope: "activation" } is valid.
- Phase Strike: oncePerTarget "step" → targetPolicy { mode: "once", scope: "activation" } on both hits.
Traps:
- Reuse the activation serial entities already get at spawn; don't invent a second id.
- Remove the timeline fields from the ability-state shape and from shared/schemas if the response schema lists them (then run server tests).
- The +10 stamina refund stays once per activation.
Tests: the hammer (two activation hits, once/activation): a bot in both takes only the first. A projectile with scope entity hits a bot once across a transition. Phase Strike unchanged. The validator rejects atMs and oncePerTarget.
Goldens: no change expected. Any diff: stop the whole run and report (don't start prompt 5).
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md section 2 (remove the trigger timeline; add targetPolicy scopes). Don't edit ENGINE_PRIMER.md. Don't commit.
```

## Prompt 5: attached entities

```text
Task: add the entity category "attached": part of the bot's own attack, for anything over time, in sequence or conditional. No gameplay change (no current ability uses it).
Spec: docs/ENGINE_PRIMER.md section 2, "Attached entities" (rules 1–6 and the examples).
Decisions:
- Rule 1: brains can't select attached entities (not in the brain's entity list, no selectable identities). In the same file, replace the hard-coded ability IDs [17, 31] with data: facing + movement identities for category "summon".
- Rule 2: an attached entity has no target kinds; the validator rejects `health` and `trigger` on its phases.
- Rule 3: it is removed on the tick its owner is interrupted (stun) or dies. It is NOT removed when the ability's active time ends normally (Whirlwind outlives a 300 ms active time). Entities it spawned stay.
- Rule 4: its collision tests the phase hitbox with the same shape test as an activation hit (arc, rectangle, ray, circle; includeTargetRadius) at its current pose, not the moving-entity collider.
- Rule 5: `move` is allowed in an attached entity's event do lists. It moves the owner like an activation move, heading from the ability action captured at activation; store what it needs on the entity at spawn.
- Entity `hit` verbs (any category) reach entities through their `targets`, like a bot's hit (today they reach bots only). Hunter Drone targets only BOT, so nothing changes for it.
- Attached phase visuals use the existing entity renderer path; no new art.
Traps:
- After a move run by an event, a phase entered on that tick must run its collision from the owner's new pose (re-bind followOwner first).
- Interruption must be detectable per cast: compare the entity's activation serial with the owner's ability record, not just "ability inactive".
- Hits from attached entities count toward the cast's once-per-activation stamina refund (as entity hits already do).
- `bot.entityActivations` (entity id → activation serial) only records entities spawned on the activation tick, and never drops entries. An entity spawned by another entity (shards from a swing) must inherit its parent's serial, and an entry must be dropped when its entity is removed. This must not change goldens.
Tests (withTestAbilities, ALWAYS brain), one per primer example: Whirlwind (interval hits, ends on stun), combo (each cut lands, stun cancels the rest), shatter (shards only on a hit, survive a stun), lunge (stab from the new position), beam (5 pulses), volley (3 spawns), lingering hammer (activation scope over several ticks). Plus: a brain can't select it, and an enemy hit can't touch it.
Goldens: no change expected. Any diff: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test.
Docs: ABILITIES.md sections 6–7 (entity categories, attached rules), shared/engine/ecs/context.md if a new file appears. Don't edit ENGINE_PRIMER.md. Don't commit.
```

---

# Round 2: make the engine ready for the roster (prompts 6–10)

These only change the **engine**. They add no roster ability and cut none: which abilities to add
is the owner's call, made later from [`ABILITY_ROSTER.md`](ABILITY_ROSTER.md). The spec is
[`ABILITY_ENGINE_FIT.md`](ABILITY_ENGINE_FIT.md) (gaps G1–G5 and section 4). Tests use test
abilities and test statuses, not new roster data.

## How to feed them (3 pastes)

| Paste | Prompts | Why |
| --- | --- | --- |
| **D** | 6 | The structural one (one hit path, one collision path). It may move goldens, so review it alone. |
| **E** | 7 + 9 + 10 | Small and independent of each other; none should change goldens. |
| **F** | 8 | Status reactions. It builds on 7 (conditions), so it runs last. |

Use the same combined-paste header line as round 1.

## Prompt 6: one hit routine, one collision dispatch (G1)

```text
Task: every "what does this shape touch, and apply it" goes through one routine, and an entity collision is decided once, from the source's side, for bots and entities alike. Gameplay may change only where an entity collides with an HP entity.
Spec: docs/ABILITY_ENGINE_FIT.md section 3, G1 (the table of five paths).
Decisions:
- One hit routine fires from a source pose (a bot or an entity). The activation `hit` and an entity event's `hit` both use it, with every option for both: nearestOnly, targetPolicy, aim, origin, one ray rule (width counts).
- An entity's collision event runs once per touched target, bots and entities together, from the source side. Its applyEffects reaches entity targets by queuing impacts (as bot hits already do); targetPolicy and nearestOnly apply to entity targets too.
- Geometry is the source's rule, the same for every target: attached entities test their exact phase hitbox; world entities sweep their collider.
- Delete the target-side re-scan in applyIncomingEntityEffects (keep applying queued impacts) and entityCollisionRemovalIds (a `remove` in the do list does the removal).
- Queued impacts land in the same entities stage regardless of entity order: collect them first, then apply them in one pass.
Tests first (expect some to fail before the change): an attached arc touching a drone damages it and runs its do list, and one that misses does neither; a Whirlwind (interval 200) damages a drone every 200 ms, not every tick; a fireball into Snare Bomb still damages it and is removed; a grenade into Snare Bomb still works.
Goldens: only scenarios with an entity colliding with an HP entity may change (trap-snare-bomb, summon-drones, grenades); explain each change. Any bot-only scenario changing: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test.
Docs: ABILITIES.md sections 3 and 6; ENGINE_PRIMER.md section 3 (the entities stage) if its description changes. Don't commit.
```

## Prompt 7: conditions (`when`) and `removeStatus` (G2)

```text
Task: an effect may carry `when`, checks that must all pass for it to apply; plus a `removeStatus` effect. No gameplay change.
Spec: docs/ABILITY_ENGINE_FIT.md G2.
Decisions:
- Only effects carry `when` (not verbs). It is a list (AND only), checked in applyEffectList right before that effect, on live state.
- Check shape: { of: "target" | "owner", measure, op?, value? }. Measures:
  - hpRatio: hp / maxHp; needs op (<, <=, >, >=) and a number.
  - distance: from the effect's source to the target; needs op and a number.
  - hasStatus: value is a preset name.
  - windingUp: any ability of `of` is in windup.
  - fromBehind: the source is more than 90° off the target's facing.
  - damageConfirmed: an earlier damage effect in this list landed (ignores `of`).
  The boolean measures take no op/value and must be true. No `not`, no OR.
- Reuse the brain's code for hp ratio, angles and status checks; don't write second copies.
- removeStatus { subtype }: removes that status from the target in every mode; its lifetimeEnd does not run.
- Remove healing's requiresConfirmedDamage; Vampiric Beam's heal gets when: [{ measure: "damageConfirmed" }]. mirrorsDamage stays.
- Derived stats and the catalogue ignore effects that have `when` (a conditional bonus isn't base damage).
Traps: the validator rejects unknown measures, a missing op/value on numeric measures, and op/value on boolean ones.
Tests (test abilities): execute-style bonus below 30% hp only; shatter-style bonus on a slowed target that removes the slow; counter-hit stun only during the target's windup; a fromBehind bonus; Vampiric Beam unchanged.
Goldens: no change. Any diff: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md effects section; ENGINE_PRIMER.md section 4 (a short "Conditions" subsection with the execute example). Don't commit.
```

## Prompt 8: status reactions, charges and status sources (G3 + G4)

```text
Task: statuses get `hit` and `hitDealt` events and `charges`; a status event knows where its source bot is; reflection becomes a reaction. No gameplay change.
Spec: docs/ABILITY_ENGINE_FIT.md G3 and G4. Run after prompt 7.
Decisions:
- Preset fields: `charges` (whole number ≥ 1, optional), and `on.hit` / `on.hitDealt` next to schedule/lifetimeEnd. An event entry: { effects, target?: "holder" | "attacker" (default holder), consume?: 1, from?: ["weapon"] }.
- `hit` fires on the holder's statuses when an attack's effect list lands an enemy-hit effect on the holder, even if immunity stopped the damage. Dispatch it from applyEffectList after the list applies, not from dealDamage.
- `hitDealt` fires on the attacker's statuses when its attack lands an enemy-hit effect on an enemy bot. `from: ["weapon"]` limits it to abilities with weapon: true. An entity's hit counts for its owner bot.
- attacker = the bot that owns the attack (a projectile's or summon's owner).
- New token "$hitAmount": the raw damage of the triggering attack, before the holder's modifiers.
- consume spends charges; at 0 the status ends (lifetimeEnd does not run).
- Depth 1: effects run by a reaction never fire reactions. Order: the holder's statuses in list order; the target's hit before the attacker's hitDealt.
- Only bots hold reactions for now (summons ignore on.hit/on.hitDealt).
- G4: when a status event runs, its source resolves to the living bot in sourceSlot (keep damageSourceKind/type so bleed's exclusion still works). If that bot is dead, effects that need a source position skip.
- Reflection: delete reflectTo and the damage_reflection building block. reactive-armor becomes the incomingDamage ×0.5 modifier plus on.hit { target: "attacker", effects: [ { type: "damage", amount: "$hitAmount", multiplier: 0.5 } ] }.
Traps:
- Reflection must match today exactly: same amount (raw incoming × 0.5), the holder as damage source (so stagger is unchanged), never reflected back.
- Overcharge-style doubling must apply to the hit that spends the last charge: the modifier is read during the damage, and consume happens after.
Tests (test presets): parry-style (immunity, 1 charge, stun the attacker on hit, ends after one hit, a projectile stuns its shooter); overcharge-style (outgoingDamage ×2, 3 charges, only weapon hits spend them, the 3rd hit is still doubled); a tether-style schedule that pulls toward the source when distance > 200 (uses prompt 7); Reactive Armor unchanged; reactions don't chain.
Goldens: no change. Any diff: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md section 6 (status events); ENGINE_PRIMER.md section 6 (add hit/hitDealt and charges, using the parry example; replace the reflection description). Don't commit.
```

## Prompt 9: homing to the owner (G5)

```text
Task: `seek` can home to its owner, and an entity's collision can name its owner, so a returning projectile can be caught. No gameplay change.
Spec: docs/ABILITY_ENGINE_FIT.md G5.
Decisions:
- seek movement gets `target`: "nearestEnemy" (default, today's behaviour) or "owner". Same turnDegrees and unitsPerTick rules.
- "OWNER" may appear in an entity collision event's `targets`; it matches only the owner bot. Such an event may run only remove, transition, spawn and emitVisual (the validator rejects applyEffects and hit there), so there's no friendly fire.
- Tether Bolt is not changed.
Tests (test ability, a boomerang): out phase straight for 400 ms, return phase seek owner, removed on touching the owner; hits an enemy on the way out and again on the way back (phase-scoped targetPolicy once); with no owner (dead) it expires normally.
Goldens: no change. Any diff: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md section 7 (movement modes); ENGINE_PRIMER.md section 2 (movement table and a short boomerang example). Don't commit.
```

## Prompt 10: small cleanups (fit doc section 4)

```text
Task: three cleanups so new abilities can't go wrong silently. No gameplay change.
Spec: docs/ABILITY_ENGINE_FIT.md section 4.
Decisions:
- The runtime reads timing from the ability data, not from the ABILITY_STATS presentation projection (charge reload in BotResourceSystem, the execution payload's stats, the brain's aim-prediction wind-up). ABILITY_STATS stays for the catalogue only.
- timing.activeMs becomes required in the validator, and activationActiveMs loses its `max(300, durationMs)` fallback. Give any ability that lacks activeMs the value it effectively gets today.
- Snare Bomb's trigger.lifetimeMs: find what reads it. If it duplicates the phase or entity lifetime, delete it; otherwise move it to the phase's durationMs. The validator then rejects unknown trigger fields.
Goldens: no change. Any diff: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md if it mentions any of these. Don't commit.
```
