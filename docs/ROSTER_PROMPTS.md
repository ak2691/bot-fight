# Roster prompts (Haiku)

Four pastes, run in order: each one touches `abilities.json`, so none run in parallel. Bring each
result back for review before the next. Spec: [`ROSTER_DESIGN.md`](ROSTER_DESIGN.md).

| Paste | Contents | Golden impact |
| --- | --- | --- |
| **1** | Engine cleanup: finish G1, and let a boomerang be caught | none |
| **2** | R1: cuts, tier moves, retunes, Orbital Strike rework, entity renderer registry | large (intended) |
| **3** | R2 + R3: Lunge, Shotgun Blast, Tar Pit, Overdrive, Boomerang, Fan of Blades | new scenarios only |
| **4** | R4 + R5: Execute, Backstab, counter-hit, Parry, Overcharge, Tether Link | Phase Strike and Disruptive Beam change; otherwise new |

The batches differ from `ROSTER_DESIGN.md` section 7: all the engine work is in now, so they're grouped by
size and file overlap rather than by engine dependency.

## Paste 1: engine cleanup

```text
Task: finish G1 (one hit function, one impact queue, one immunity rule) and let a returning entity be caught while it still hits enemies. No gameplay change.
Spec: docs/ABILITY_ENGINE_FIT.md (the status note at the top, and G1).
Decisions:
- One hit function for bots and entities: candidates (bots and entities by `targets`), origin pose, nearestOnly, aim "seekTarget" (meaningful only for a seeking entity), targetPolicy memory (a bot's activation hit uses the cast's activation memory; an entity's hit uses entityMemory by scope), and the per-target apply. hitVerb, hitOneDefender and hitFromEntity become callers of it or are deleted.
- One impact queue: a bot's hit on an entity goes into the same queue as entity hits and lands in the entities stage of the same tick, as today. Remove pendingImpacts.
- The "immune but holds a hit reaction" rule (reactsToBlockedHits) lives in one place: the shared per-target apply.
- A verb in an entity event's do list may carry `targets`; it then runs only for touched targets of those kinds. So one collision can damage enemies and be caught: targets ["BOT", "HP_ENTITY", "OWNER"], do [ { do: "applyEffects", targets: ["BOT", "HP_ENTITY"], ... }, { do: "remove", targets: ["OWNER"] } ]. The owner never counts as BOT. Relax prompt 9's rule: applyEffects and hit may sit in an OWNER event when their own `targets` leave OWNER out.
Traps:
- waitForHit still reads whether the hit connected; the +10 stamina refund and Time Since Hit stay once per activation.
- Check nothing outside the engine (replay, Pixi) reads pendingImpacts before removing it.
Tests: the boomerang test's return pass now also damages the enemy, and the owner still catches it. Every existing hit and collision test keeps passing.
Goldens: no change. Any diff: stop and report.
Checks: cd frontend; npm test; npm run lint. cd sim-worker; npm test.
Docs: ABILITIES.md sections 2, 3 and 7 (verb `targets` in event do lists; one impact queue); ENGINE_PRIMER.md (the boomerang example; drop pendingImpacts); ABILITY_ENGINE_FIT.md status note (G1 complete). Don't commit.
```

## Paste 2: R1

```text
Task: roster batch R1: cut abilities, move tiers, retune numbers, rework Orbital Strike. Intended gameplay changes; a large golden diff.
Spec: docs/ROSTER_DESIGN.md sections 2–5 (the cut, move, retune and buff rows) and section 7.
Decisions:
- Cut and retire IDs 7, 9, 10, 11, 12, 13, 14, 16, 23, 24, 31, 33 (the nine cuts, plus Heavy Slash, Pistol and Overclock, whose replacements come in later batches). Remove them from abilities.json, the catalogue, the server pools and everything that offers them. Add a top-level `retiredIds` list to abilities.json; the validator rejects an ability that uses a retired ID.
- Remove what only they used: status presets (reactive-armor, absolute-guard, overclock), Pixi renderers and presentation entries whose visual type no ability uses any more, and their catalogue text. Engine tests that used them (reflection, immunity) switch to test presets or test abilities; the engine features stay.
- Tier moves: Wind Burst (18) and Repelling Blast (8) to tier 1; Rewind (21) to tier 2.
- Apply every retuned number in the design doc: Sniper, Grenade, Frost Ring, Tether Bolt, Wind Burst, Repelling Blast, Stun, Silence Pulse (+10 damage), Hunter Drone, Phase Strike (cooldown 7 s), Disruptive Beam (cooldown 9 s only), Rewind, Singularity. No Backstab or counter-hit yet (paste 4).
- Orbital Strike: targeted within 400 (clamp); phase `marker` 1200 ms with no effect, then phase `blast`: one collision (once), radius 140, 55 damage + stun 500 ms; cooldown 16 s.
- Entity visuals are sprite-only today. Add a procedural entity renderer registry keyed by phase visual type, with the same { create, update, destroy } contract as BOT_ABILITY_RENDERERS; PixiCanvas routes a type there when the registry has it (no branches on ability IDs). First users: `orbitalMarker` and `orbitalBlast`, ported from docs/visuals/ability-visuals.html (settings into the presentation definitions, draw functions into renderers; add `arcPath` to rendererHelpers.js). Ground visuals go in the zones layer.
- Catalogue summaries of every ability touched here carry no numbers; the stats panel shows the data.
Traps:
- Cut IDs also appear in tutorial presets, puzzles, practice-room defaults, brain fixtures (shared/brain-tests), golden scenarios and server tests. Replace them with kept abilities where the test's point survives; delete only where it doesn't.
- The golden test "every ability triggers in at least one scenario" must still pass for the remaining roster.
- Run node tools/format-gameplay-json.mjs after editing the JSON.
Goldens: expected to change a lot. Before golden:update, list every changed or removed scenario with one line on why (a cut ability, a retuned number, Orbital's rework). A change you can't explain: stop and report.
Checks: cd frontend; npm test; npm run lint; npm run build. cd sim-worker; npm test. cd server; .\mvnw.cmd test.
Docs: ABILITIES.md (examples that used cut abilities); ROSTER_DESIGN.md section 7 (mark R1 done). Don't commit.
```

## Paste 3: R2 + R3

```text
Run these parts in order. Finish each part completely (tests, golden check, golden:update only when the diff is exactly what that part allows) before starting the next. If a part says stop, stop the whole run and report.

STANDARD FOR EVERY NEW ABILITY IN THIS RUN
- Numbers and behaviour: docs/ROSTER_DESIGN.md (the ability's row); ID and tier from its section 2 table. Pick an unused one-letter loadout code.
- Data in shared/gameplay/abilities.json (and statuses.json for new presets); run node tools/format-gameplay-json.mjs. Catalogue text without numbers; visualInterpolation in BotLoadout.js.
- A new status appears in the brain's Has Status choices, the status catalogue and the Pixi status labels, like the existing ones.
- Visuals: port the ability's card from docs/visuals/ability-visuals.html. Settings into botAbilityPresentationDefinitions.js; draw functions into pixi/renderers/<type>.js (bot visuals) or the entity renderer registry (phase visuals). Never ship an ability-specific wind-up visual: wind-ups all look the same (docs/SOLVED_MATCHUPS.md).
- Tests: an ALWAYS-brain execution test per ability, a golden scenario per ability, and the part's counter scenario.
- Goldens: only new scenarios may appear unless the part says otherwise. Anything else: stop and report.
- Checks: cd frontend; npm test; npm run lint; npm run build. cd sim-worker; npm test. cd server; .\mvnw.cmd test. Mark the batch done in ROSTER_DESIGN.md section 7. Don't commit.

PART 1 (R2): Lunge (38), Shotgun Blast (39), Tar Pit (43), Overdrive (42)
- Lunge: tier 1, no wind-up, cooldown 6 s. An attached entity: phase `crouch` 200 ms (followOwner, no hitbox) whose lifetimeEnd runs move (distance 150, unitsPerTick 150) then transitions to `stab`; `stab` 100 ms, followOwner, rectangle 120 × 40, collision once: 18 damage + bleed (amount 2, 4000 ms).
- Shotgun Blast: tier 1, wind-up 200, cooldown 6 s. Activation spawns `pellet` with pattern fan, count 7, spreadDeg 40. Pellet: straight 60 per tick, lifetime 300 ms, collision BOT/HP_ENTITY: 5 damage, then remove.
- Tar Pit: tier 2, wind-up 300, cooldown 11 s. Spawned at the target position (clampToRadius 300). Phase `landing` 300 ms (no effect; the glob visual falls onto the spot), then `pool` 4000 ms, radius 130, collision continuous with targetPolicy interval 500: 3 damage + slow 600 ms, so the slow never lapses while inside.
- Overdrive: tier 2, no wind-up, activeMs 0, cooldown 12 s. applyEffects OWNER status `overdrive` 2500 ms; preset = modifier staminaCost × 0.
- Counter scenario: Lunge into a bot that uses Repelling Blast as the Lunge lands.

PART 2 (R3): Boomerang (40), Fan of Blades (46)
- Boomerang: tier 1, no wind-up, cooldown 6 s. Phase `out`: straight 45 per tick for 1000 ms, collision BOT/HP_ENTITY with targetPolicy once (phase): 12 damage; lifetimeEnd → `back`. Phase `back`: seek with target owner, 45 per tick, turnDegrees 20; one collision with targets BOT/HP_ENTITY/OWNER: 12 damage to enemies (once, phase) and remove on the owner (verb-level targets). Entity lifetime cap 3000 ms, so it can't fly forever if the owner dies.
- Fan of Blades: tier 3, wind-up 300, cooldown 16 s. Spawns `blade` with pattern ring, count 8. Each blade: straight 40 per tick for 750 ms (300 units), then seek the owner and removed on the owner, the same as the boomerang; 12 damage per blade per pass (targetPolicy once, phase); lifetime cap 3000 ms.
- Counter scenario: a bot that steps out of the boomerang's line before it comes back takes only the outbound hit.
```

## Paste 4: R4 + R5

```text
Run these parts in order. Finish each part completely (tests, golden check, golden:update only when the diff is exactly what that part allows) before starting the next. If a part says stop, stop the whole run and report.

STANDARD FOR EVERY NEW ABILITY IN THIS RUN
- Numbers and behaviour: docs/ROSTER_DESIGN.md (the ability's row); ID and tier from its section 2 table. Pick an unused one-letter loadout code.
- Data in shared/gameplay/abilities.json (and statuses.json for new presets); run node tools/format-gameplay-json.mjs. Catalogue text without numbers; visualInterpolation in BotLoadout.js.
- A new status appears in the brain's Has Status choices, the status catalogue and the Pixi status labels, like the existing ones.
- Visuals: port the ability's card from docs/visuals/ability-visuals.html. Settings into botAbilityPresentationDefinitions.js; draw functions into pixi/renderers/<type>.js (bot visuals) or the entity renderer registry (phase visuals). Never ship an ability-specific wind-up visual: wind-ups all look the same (docs/SOLVED_MATCHUPS.md).
- Tests: an ALWAYS-brain execution test per ability, a golden scenario per ability, and the part's counter scenario.
- Goldens: only new scenarios may appear unless the part says otherwise. Anything else: stop and report.
- Checks: cd frontend; npm test; npm run lint; npm run build. cd sim-worker; npm test. cd server; .\mvnw.cmd test. Mark the batch done in ROSTER_DESIGN.md section 7. Don't commit.

PART 1 (R4): Execute (45), Phase Strike Backstab (25), Disruptive Beam counter-hit (30)
- Execute: tier 3, wind-up 600, cooldown 15 s. Activation hit, rectangle 220 × 50: damage 25, then damage 60 with when [{ of: "target", measure: "hpRatio", op: "<", value: 0.3 }]. Strike visual; its `bonus` X shows when the second effect landed.
- Backstab: Phase Strike also spawns an attached entity: phase `wait` 200 ms (followOwner, no hitbox) → `stab` 100 ms, rectangle 80 × 50, collision once: damage 10, then damage 15 with when [{ of: "target", measure: "fromBehind" }]. A stun on the caster removes it (attached rule).
- Disruptive Beam: its effects become damage 20, slow 1500, and stun 1000 with when [{ of: "target", measure: "windingUp" }]. The plain 300 ms stun goes. Counter-hit visual on the target when the stun landed.
- Goldens: Phase Strike and Disruptive Beam scenarios change (intended); explain each change. Plus new scenarios.
- Counter scenario: Execute on a target above 30% HP deals only 25.

PART 2 (R5): Parry (41), Overcharge (44), Tether Link (47)
- Parry: tier 1, no wind-up, activeMs 0, cooldown 8 s. applyEffects OWNER status `parry` 300 ms. Preset: damage_immunity, charges 1, on.hit { target: "attacker", consume: 1, effects: [stun 800 ms] }. Only damaging attacks set it off (engine rule), which covers every current attack.
- Overcharge: tier 3, wind-up 300, cooldown 16 s. Owner status `overcharge` 8000 ms. Preset: modifier outgoingDamage × 2, charges 4, on.hitDealt { from: ["weapon"], consume: 1 }. All damage is doubled while it lasts; weapon hits spend the charges (see the design doc's row).
- Tether Link: tier 3, wind-up 300, cooldown 16 s. A bolt projectile (Tether Bolt's outbound shape, no pull) that on hit applies `tethered` 4000 ms and removes itself. Preset (carries the source slot): modifier incomingDamage × 1.2, and on.schedule every 100 ms: displace { who: "target", from: "source", direction: "toward", distance: 30 } with when [{ of: "target", measure: "distance", op: ">", value: 200 }]. The chain visual is drawn from the caster to the holder.
- Traps: in a status event, "target" is the holder and "source" resolves to the caster (prompt 8); check the displace uses them that way and does nothing once the caster is dead. incomingDamage modifiers multiply (bleed 1.25 × tethered 1.2 = 1.5).
- Counter scenarios: Parry against Stun (the stunner is stunned); an Overcharge whose owner stays out of weapon range spends no charges.
```
