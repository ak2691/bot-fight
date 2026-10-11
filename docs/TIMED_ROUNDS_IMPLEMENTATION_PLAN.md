# Timed Rounds Implementation Plan

Status: partly built. S1-S6, P0a/P0b (movement and stamina on both runtimes), C1-C4 (action chains and Time Since Hit) and fast turn are built. Lock On (20) and Basic Strike (34) are out of the base kit (the base kit is Dash and Sprint, with fast turn on Rotate). P3 (the segmented simulation) and P4 (the server match lifecycle: clocks, picks, resolution, ruleset `duel-v2`, 300 HP, guarantee removal) are built. The client has only the mirrored constants and draft rules; P5 (the pick panel, build HUD, clocks and the guarantee UI removal) onward, and S7, are not started. This turns the design in [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md) into implementation work for Sonnet. Section 9 has one prompt per work package. File paths and symbols were checked against the code on 2026-10-01; confirm them again before editing.

## 1. Locked decisions

| Area | Decision |
|---|---|
| Rounds | Up to 6 rounds in one continuous fight. No best-of series |
| Base kit | Dash (19, stamina-based) and Sprint (a Walk setting), with fast turn on Rotate. Lock On (20) and Basic Strike (34) are out of the base kit (their definitions stay for old replays; no migration, old brains show "Ability not equipped"). Max abilities: Dash + weapon + 6 |
| Movement | Facing never affects movement speed. Stamina pool, sprint in any direction (attacking does not slow it), chained stamina dashes, wind-up cancel, hits checked at the active frame, no exhaustion (at 0 stamina the bot just cannot dash, sprint or fast turn), stamina refills 0.5 s after the last spend at 20/s, and each landed hit refunds +10 stamina once per activation (separate from the regen pause) to reward accurate aggression. See section 3a |
| Weapon | Round 1 only, chosen from **all** weapons. All weapons are melee, reach ≤ 300 units |
| Abilities | 1 per round. Rounds 1–2 tier 1, 3–4 tier 2, 5–6 tier 3. 3 offers (2 in tier 3) |
| Offers | Shared seed, never an owned ability, no guarantees, no role tags |
| Clock | 1v1: 5:00 base per player, +30 s at the start of every build (round 1 starts at 5:30; at most 8:00 per match). 2v2: 7:00 base, +30 s (at most 10:00). No per-round cap. Log clock used per round per player |
| Pick time | 30 s in round 1 (weapon + ability), 20 s in rounds 2–6. Not taken from the clock |
| Submit | Final, validated, hold-to-submit |
| Timeout | Player setting: submit current code (if valid), or last round's code |
| Segment | 20 s of simulation per round (6 rounds = 2:00 of fight, at most 1,200 ticks), continuing exactly from the previous segment |
| Variables | Keep their last-frame value, or reset to default, per variable |
| Ending | KO ends the match. After round 6, higher HP wins (2v2: team HP sum). Draw on equal HP or a simultaneous death |
| HP | 150 → **300**. Target: median KO in round 5 |
| Zone | Rounds 5–6 only. `ClosingZoneConfig.timedRoundsV2()` starts at 80,000 ms; 1200 → 900 units at the start of round 5 and → 600 at the start of round 6 (5 s contraction each); a warning ring shows the next size during the round before each step; damage unchanged; `simulationDurationMs` 120,000 |
| Ruleset | `duel-v1` → `duel-v2` |
| Puzzles | Hidden from the public. Admins can still edit them |
| 2v2 | Per-player clocks (7:00 + 0:30), picks, brains and fallback settings. Offers are shared by all four players. Teammates can view each other's brains read-only during the build. 2v2 HP is a tuning item |

## 2. Architecture: one continuous simulation with a brain schedule

**Don't serialize snapshots. Re-run the match.** To produce segment *k*, the server runs the whole match from tick 0 with the original seed, swapping each bot's brain and loadout at each round boundary. It records only segment *k*'s frames.

Reasons:

- **Determinism is guaranteed by construction.** There is no snapshot format to keep complete. `Bot` has more than 60 mutable fields (statuses, pending cooldowns, charges, wind-ups, rewind state, entities, zone state, RNG), and a snapshot that misses one breaks resume silently.
- **It's cheap.** The whole match is at most 1,200 ticks, which takes milliseconds.
- **The audit trail is complete.** A finished match re-simulates from seed + ruleset + each round's (brain, loadout, variable resets) per player. Round brains are already kept in history (`V24__match_round_bot_code_history.sql`).
- **The "last frame" for the next round** is simply the final frame of segment *k*. The server also sends it explicitly at round ready and on reconnect.

Request shape: extend `DuelSimulationService.DuelSimulationRequest` with an ordered `List<SegmentRequest>`. Each segment has an `endsAtMs` and, per bot, a brain, a loadout, and variable resets. Segment 1's bots come from the existing `DuelBotRequest`. Add `recordFromMs` so the replay recorder keeps only the target segment and initializes its replay "initial state" from the bots at that boundary.

At a boundary tick, before logic evaluation, for each bot:

1. Replace `brain`, re-run `prepareStrategy`, and update `abilities` and `combatLoadout`.
2. A **newly added** ability gets fresh resources: cooldown 0, full charges. Use the same initialization as `BotStateService.create`; extract a helper rather than duplicating it.
3. Reconcile custom variables:
   - same name and type, not reset → keep the value;
   - reset, new, or type changed → the declared default;
   - no longer declared → dropped.
4. End any running action chain (section 3d); the new brain may not contain it.
5. Everything else continues untouched: position, HP, statuses, cooldowns, wind-ups, entities, zone.

Live match state needs nothing new except per-player clocks, picks, fallback settings and variable resets, all in memory under the existing match lock. The **only** real-time element is the clock, and it's a set of server deadlines, the same pattern as today's building deadline.

## 3. Weapons and ability rework (both runtimes)

Cycle = wind-up + active + cooldown. Today, cooldown starts after the active phase ends (`abilityPendingCooldownMs`). Damage per second assumes every hit lands. With 300 HP, the weapon damage-per-second band of about 9–11 gives about 30 s time-to-kill at 100% uptime, which is 4–5 segments of 20 s at realistic uptime (about 30–35%), matching the target median KO in round 5. All numbers are starting points; the owner will tune them.

### Weapons (new category `weapon`)

Weapon names describe the **hitbox and motion**, not a character identity. They show in the UI as "Weapon: Slash" and so on. **No icons for weapons for now:** status tiles and the catalogue use the existing text fallback.

Geometry conventions (verified in `gameconfig/hitboxGeometry.js`): arc and rectangle hitboxes start at the **bot's center** and extend forward along its facing. With `includeTargetRadius: true`, a hit registers when the target's body (radius 30; `BOT_SIZE` 60) overlaps, so **effective reach = hitbox length + 30**, measured center to center.

| Weapon | ID | Hitbox | Effective reach | Damage | Wind-up / active / cooldown | Damage per second | Character |
|---|---|---|---|---|---|---|---|
| Slash | 1 (retuned) | arc 120°, range 92 | 122 | 8 | 0 / 300 / 500 | 10.0 | Quick, standard |
| Thrust | 35 (new) | rectangle length 190, width 30 | 220 | 10 | 100 / 300 / 700 | 9.1 | Longest reach, thin: needs accurate facing |
| Cleave | 36 (new) | arc 160°, range 112 | 142 | 15 | 500 / 300 / 700 | 10.7 | Slow, wide, hits harder; readable wind-up |
| Smash | 37 (new) | rectangle length 125, width 100 | 155 | 11 + knockback 120 | 300 / 300 / 700 | 8.8 | Between Slash and Cleave in size; boxy; pushes the target away (toward walls and the zone) |

- All weapon hitboxes use `includeTargetRadius: true`, like Slash today. Every reach is ≤ 300.
- Smash's knockback uses the existing `EFFECT_TYPES.KNOCKBACK` (as Repelling Blast does), on bots and summons.
- No ammo on any weapon.
- `attackDamageMultiplier` and `attackSpeedMultiplier` apply as they do to Slash today.
- Trade-offs: Slash has no wind-up and the best uptime. Thrust out-ranges everything but misses if facing is off. Cleave has the most damage and width but telegraphs for 500 ms, so it's the best target for dodges and feints. Smash's knockback controls spacing.

### Reworked tier 1 abilities

| Ability | ID | Change |
|---|---|---|
| Fireball | 5 | Remove ammo and reload. Cooldown 5,500. Projectile hitbox 30×30 → **64×64**, visual 30 → 60. Lifetime 1,000 → 1,400 (about 700 units at speed 50). Damage 15 → 20, burn unchanged (2/s for 5 s) |
| Sniper (was Gun) | 3 | Rename (label and catalogue text). Remove ammo and falloff. Wind-up **900** (aim telegraph), active 200, cooldown 9,000. Ray range 1,200, width 6. Flat damage 40. The bot may keep rotating during the wind-up; the ray fires along its facing at release |
| Shotgun Blast (was Pistol) | 12 | **Deferred to the last stage (S7), together with the multi-spawn engine (section 3c).** Until then Pistol stays exactly as it is |

- Keep IDs 3, 5 and 12 (12 when S7 happens). No code re-simulates old matches, and `duel-v2` (P4) marks the change.
- **Basic Strike (34)** is already out of the standard set (`STANDARD_ABILITY_IDS` is `[19]`, server `STANDARD_ABILITY_ORDER` likewise). Its definitions and visuals stay for old replays, and it is not selectable. Until P4 adds the round 1 weapon pick, current matches get a melee attack only if Slash is drafted. Practice rooms and the sandbox start with Slash equipped for both bots.
- **Heavy Slash (7)** stays a tier 1 ability, unchanged. The owner may revisit it, since it overlaps with Cleave.
- Other abilities keep their numbers for now. HP doubling (P4) makes them relatively weaker; a balance pass comes after playtesting.

### Pools (applied in P4)

- Tier 1 (rounds 1–2): `3, 4, 5, 7, 9, 10, 11, 12, 26, 28, 29` (Slash removed).
- Tier 2 (rounds 3–4): unchanged.
- Tier 3 (rounds 5–6): unchanged, with 2 offers.
- Weapons: `1, 35, 36, 37`.
- Server: `MatchLoadoutService.ROUND_ABILITIES` becomes tier pools plus `tierForRound(r) = (r + 1) / 2`. Browser mirror: `ROUND_ABILITY_DRAFT` and the catalog `round` field in `gameArena/loadout/BotLoadout.js`. Add `category: "weapon"` metadata.
- **Offer generation:** shuffle the tier pool with `simulationSeed ^ (constant * round)` (as today), then for each player take the first N abilities they don't own. Offers stay shared except where ownership differs.
- **New IDs** need entries in: `AbilityRegistry.js`, `Abilities.js` timing, `AbilityContracts.js` (browser), the server `simulation/gameconfig/` and `simulation/ecs/contracts/AbilityContracts.java`, both compact ability code tables (`CompactAbilityCode` on the server and the loadout encoding on the browser), and the catalogue. Use `tools/botfight-mcp` scaffolds and its parity report, and follow `docs/ADDING_AN_ABILITY_OR_MOVE.md`.
- **Until P4**, the new weapons are available in the practice-room loadout editor but not in the current match draft, so current 3-round matches keep working.

## 3a. Movement and stamina

The design is in [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md) section 5a. Implementation happens in two steps: a browser-only prototype (P0a), then the authoritative server version with parity (P0b). Weapon numbers in section 3 are retuned after P0b, so weapons aren't balanced twice.

### Starting values (prototype, then tune)

**100 ms rule:** the simulation ticks every 100 ms. Every duration, delay and cooldown must be a whole multiple of 100 ms, and per-second rates are applied as whole amounts per tick (stamina is always an integer). Never add a value like 750 or 250 ms. The prototype keeps every number in `frontend/src/gameArena/gameconfig/MovementConfig.js`.

| Mechanic | Value |
|---|---|
| Stamina | 100 max |
| Regeneration | 20 per second (2 per tick), after 500 ms without spending (`regenDelayMs` / `REGEN_DELAY_MS`). Only spending starts or restarts the pause |
| No exhaustion | `exhaustionMs` is gone. At 0 stamina the bot cannot dash, sprint or fast turn until it refills. No movement slowdown |
| Hit refund | `hitStaminaRefund` / `HIT_STAMINA_REFUND` = 10. When a weapon or ability lands on an enemy bot the attacker gains 10 stamina (capped), at most once per activation (multi-hit, piercing and damage-over-time count once; entities count for the activation that spawned them). Banked during the tick and paid when it settles, using the same hit tracking as Time Since Hit. It never starts, ends or restarts the regen pause. Design intent: reward accurate aggression |
| Sprint | +50% movement speed, any direction. Drains 30 per second (3 per tick). Attacking no longer slows it: it applies on any tick the bot walks with sprint on and has stamina, including while an ability is starting, winding up or active. Movement-lock, stun and 0 stamina stop it |
| Fast turn | A setting on Rotate (`fastTurn: true`, stored only when on). Rotation step 12 -> 24 degrees per tick (times the hit-stagger rotation multiplier). Drains 2 per tick (20 per second), only on ticks where the bot actually rotates; no drain while already facing. Below 2 stamina: normal step, no cost. Can drain in the same tick as sprint; attacking does not end it. `fastTurnMultiplier: 2` and `fastTurnDrainPerTick: 2` in both `MovementConfig`s |
| Dash (19) | Costs 30 stamina instead of the 1,800 ms cooldown. A 300 ms gap between chained dashes. Distance and active time unchanged. **Interim (a movement/ability audit is planned):** Dash has its own action category `dash` (`ACTION_HEADS.DASH` / `ActionHead.DASH`, its own `plan.dash` and `Action.dash` channel) and `ignoresGlobalAbilityLock` in both `AbilityContracts`, so it never blocks or waits on another ability and one dash and one ability start on the same tick (ability first, then dash). Silence no longer stops it; stun, slow and movement-lock still do |
| Wind-up cancel | Cancels the bot's own wind-up (`preparingAbility`) for 25 stamina. The ability does not go on cooldown and uses no charge. There is no restart lock: it can start again on the next tick (one ability action per tick), and the 25 stamina is the price |
| Recovery | For now, the ability's existing active time acts as recovery. A separate active/recovery refactor is planned by the owner, so don't add a new recovery field |

### Engine work

- **Bot state (both runtimes):** `stamina`, `staminaRegenDelayMs`, `sprinting`, `fastTurning`, `dashGapMs`, plus the refund bookkeeping `activationSerial`, `refundedActivations`, `entityActivations` and `pendingStaminaRefund`. They live on the `Bot` in `DuelSimulationService` and the browser bot state, and must go into replay frames (compact) so the status panel and spectators can show stamina.
- **Actions:** start sprint, stop sprint, and cancel wind-up. They're new allowlisted logic actions with stable IDs, on the movement and ability channels, mirrored in `BotLogicContracts.js` and the server `simulation/bots/` registry. Dash keeps its ID and actions; only its cost model changes.
- **Conditions and state variables**, to match design section 5a ("What code must be able to read"):
  - self: stamina, sprinting, turning fast (an old "Exhausted" condition migrates to Stamina < 1 or Stamina >= 1 in both normalizers, and `bot.exhausted` is rejected);
  - opponent: stamina, sprinting, turning fast, winding up (and which ability), velocity and heading, facing angle relative to me;
  - reach: my weapon's reach and the opponent's.

  Wire them through `modelPayloads/strategyStatePayload.js`, `stateVariableResolver.js` and the server mirror. Some (velocity, preparing ability) may already exist. Check before adding.
- **Hit timing:** confirm hits are already checked at the active frame, after the wind-up, using positions at that tick, in both runtimes. Abilities with `windupMs` resolve after `preparingMs`. If any ability captures its target position at wind-up start, flag it rather than silently changing it.
- **Movement speed is the same in every direction.** Facing never affects walking or sprint speed. Don't add directional speed modifiers.
- **Status panel and HUD:** a stamina bar on the fighter card (no exhausted state).
- **Lock On and fast turn: decided.** Lock On is removed from the base kit (`STANDARD_ABILITY_IDS` is `[19]`, server `STANDARD_ABILITY_ORDER` likewise; no migration, old brains show "Ability not equipped"). Fast turn is the Rotate setting above; the planner uses the effective step so it never overshoots, and the replay carries a `fastTurning` flag like `sprinting`.

## 3b. Bot language changes

The design is in [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md) section 5b. Every change below is a logic contract change: mirror it in the browser (`gameArena/botlogic/code/contracts/BotLogicContracts.js`, `runtime/stateVariableResolver.js`, `modelPayloads/strategyStatePayload.js`) and the server (`simulation/bots/`, `simulation/core/logic/`), with stable IDs and parity tests.

| Change | Details |
|---|---|
| Approach Angle (new state variable) | `selectable.approachAngle`, group "Movement", 0–180°. The angle between the selected entity's movement direction (last tick) and the direction from it to My Bot (or the second selectable, if it's a pair variable). 0 = coming straight at me, 180 = moving straight away. When the entity didn't move last tick the value is 90; pair it with Is Moving |
| Is Moving (new) | `selectable.moving`, true/false: the entity moved last tick (any non-zero displacement, including knockback and dash) |
| Any Ability Winding Up (new) | `bot.anyAbilityPreparing`, true/false, any bot selectable: true while any of its abilities is in its wind-up (`preparingAbility` set) |
| Speed (hidden) | Remove `selectable.speed` from the picker (`VISIBLE_STATE_VARIABLES`), but keep it in `STATE_VARIABLES` and keep evaluating it unchanged, so old brains still work. No unit change |
| Raw Move Direction | Unchanged; stays in the picker |
| Lead aim (Rotate: Face Target, and ability actions with a target) | New optional `aim` field: `current` (default, today's behavior), `lead` with `leadSeconds` (0–2, step 0.1), or `auto` with `leadAbilityId`. Predicted point = target position + target velocity (last-tick displacement per second) × lead time. For `auto`, lead time = that ability's remaining wind-up (full wind-up if not started) + projectile travel time (distance ÷ projectile speed; 0 for hitscan and melee). Target velocity is the last-tick displacement, so a direction change defeats it. Clamp the predicted point to the arena |
| Reach autofill (browser UI only) | A ghost "Reach" button beside the number input of a Distance or Angle To condition. It opens a list of the bot's equipped abilities with their effective values and fills the number when one is picked. Add `abilityReach(abilityId)` in `loadout/` returning `{ distance, halfAngle }` from the real contract hitbox: arc → range (+30 if `includeTargetRadius`) and arc/2; rectangle → length (+30) and none; ray → range; projectile → speed × lifetime. Inserts a plain number. Mock up first, following the `botfight-ui-design` skill |
| Sprint checkbox on Walk | Part of the movement work (P0a/P0b), not this stage |

Not added (see design section 5b): Hold Distance, In Range condition, Seeded Random, Time to Impact, templates, closing speed.

## 3c. Multi-spawn engine and Shotgun Blast (last stage, S7)

Saved for last on purpose. It's a general engine feature; Shotgun Blast is its first user.

### Why

Today every ability spawns **at most one** entity:

- server: `ActionExecutionService.spawnAbilityEntity` sets a single `bot.abilitySpawn`, the serial counter goes up by 1, and `DuelSimulationService` adds that one entity each tick;
- browser: `ecs/bots/ActionExecutionSystem.js` returns a single `abilitySpawn`;
- contract: each entity's `spawn` block has one `offset`, `rotation`, `rotationSpace`.

Everything after spawning (movement, collision, phases, rendering, replay, entity conditions) already handles many entities. Only the spawn step is single.

### Design

The count belongs to the **spawn**, not to phases. Phases describe one entity's life (travel, armed, detonate); spawning several is about how many are created and at what angles.

```js
spawn: {
  offset: { x: 0, y: 47 }, rotation: 0, rotationSpace: "owner",
  pattern: { type: "fan", count: 7, spreadDeg: 40 },
}
```

- `fan`: `count` entities with rotations evenly spaced across `spreadDeg`, centered on the aim.
- `ring`: `count` entities evenly around 360° (future use).
- `line`: `count` entities side by side with a `spacing` (future use).
- No randomness. `count` bounded to 1–12. Default: no pattern = one entity, so every existing ability is unchanged.

Engine changes, mirrored in both runtimes:

1. **Contract:** add `pattern` to the spawn normalizer (browser `AbilityContracts.js`, server `AbilityContracts.java`).
2. **Spawning:** `abilitySpawn` becomes a list `abilitySpawns`. Each copy goes through the existing spawn transform with its own rotation offset and gets the next serial ID **in index order**; the serial counter goes up by the number spawned. Order matters because collision resolution follows entity order.
3. **Arena step:** add all spawns, not just one.
4. **Volley hit rule:** optional `oncePerVolley` flag on a collision event. Without it, every entity applies its effects (damage stacks per pellet, as Shotgun wants). With it, a target is affected at most once per volley, which you'd want for knockback, slow or stun on multi-spawn abilities.
5. **Selectable flag:** optional `selectable: false` on an entity contract, so very short-lived entities (pellets) stay out of the condition picker.
6. **Later (not in S7):** a phase action that spawns a pattern from an entity (for example a grenade bursting into fragments), reusing the same `pattern` struct.

### Shotgun Blast (Pistol, id 12)

- Rename, remove ammo. Wind-up 150, active 200, cooldown 5,000.
- 7 pellet projectiles, `fan` 40°, speed about 650 units/s, lifetime about 400 ms (about 260 range), 4 damage each, removed on hit, `selectable: false`.
- Up close the pellets land almost instantly; at range they take a few ticks, so a well-timed sideways dash can dodge some. Fewer pellets reach a distant target, so damage falls off naturally (about 28 point blank, about 12 at 200 units).
- Collision checks sweep each pellet's path between ticks (`movingEntityCollision`); a parity test must confirm fast pellets can't skip through a bot.
- Visual: each pellet renders as a small projectile through the normal entity pipeline, plus a muzzle flash on the bot.

## 3d. Action chains and Time Since Hit (stages C1–C4)

The design is in [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md) section 5d. Both runtimes, in parity. Built before P3.

### Time Since Hit (C1)

- `bot.selectedAbilitySinceHit` ("Time Since Hit"), number, seconds (step 0.1), in `GENERIC_ABILITY_VARIABLES`, so it reuses the ability picker and works for My Bot or an opponent. Range 0–99,999 (the general number limit); "never hit" reads **99,999**, so it round-trips through custom number variables unchanged. A real reading can never get near it (a match lasts at most 120 s), so "has ever hit" is `< 99999` and "never hit" is `= 99999`.
- Per bot: last hit time per ability ID, set when that ability, or an entity it spawned, damages or applies an effect to an **enemy bot** that tick. Use the entity's owner and ability ID for attribution. One record per ability; a multi-hit tick counts once.

### Brain data

```js
chains: [{ id: "chain.<slug>", name: "Punish", steps: [/* step */] }]
// step types:
{ type: "action", ...existingActionEntry,           // ability / walk / rotate / variable / cancel_windup
  continue: "end" | "now",                           // ability only, default "end"
  forMs, untilConditions, maxMs }                    // walk / rotate only: forMs OR (untilConditions + maxMs)
{ type: "wait", forMs } | { type: "wait", untilConditions, maxMs }
{ type: "if" | "elseIf", conditions, steps: [step] } // first matching body, then after the group
{ type: "repeat", count } | { type: "repeat", whileConditions, maxMs }, plus steps: [step]
{ type: "runChain", chainId } | { type: "exitLoop" } | { type: "end" }
```

Root action: `run_chain` (`chainId`; a running chain is never replaced). It uses a movement, rotation or ability category.

Bounds (normalization and server validation): 16 chains, 32 steps per chain counting nested steps, Repeat count 1–20, every `forMs`/`maxMs` a multiple of 100 from 100 to 10,000, loop nesting 2, call depth 3, no call cycles (validate the call graph), `chainId` references must exist. Unknown step types are rejected.

### Runtime state per bot

`chainStack`: up to 3 frames of `{ chainId, path, stepElapsedMs, issued, loops: [{ passes, elapsedMs }] }`. `path` is the step position, e.g. `[1, "branch", 0]`. Empty means no chain is running. It goes into replay frames in C4.

### Per-tick algorithm

Tick order (design section 5d): evaluate roots → chain control (the highest-priority Run chain: start only when none is running) → `resumeChain` → roots fill categories the chain didn't use → simulate. Stun or death at the start of `resumeChain` ends the chain.

`resumeChain` loops over the current step with a set of categories used this tick:

- **No step left:** pop the frame (return to the caller). If the stack is empty, the chain ends.
- **Instant** (variable writes, If, Run chain push, Exit loop, End): apply and advance. Chain writes are visible to later chain steps this tick. Chain conditions read start-of-tick world state.
- **Cancel Wind-up:** uses the cancel category (`ACTION_HEADS.CANCEL`; server head `"cancel"`). Issue it (a no-op if nothing can be cancelled), advance, and **stop for this tick**: execution starts no ability on a cancel tick, so a following Use step must wait for the next tick, or it would see the old wind-up and skip the ability.
- **Use ability, not yet issued:** if the ability category is used, stop. If the ability can't start now (`actionExecutableNow` false), advance and stop for this tick; process the next step next tick. Otherwise issue it and mark it used. With `continue: "now"`, advance; otherwise mark the step issued and stop.
- **Use ability, issued:** at the start of a later tick, once the bot is no longer winding up or active with that ability (any reason), advance; otherwise stop.
- **Walk/Rotate:** an until-condition that's true at the start of the tick → advance without issuing. Otherwise, if the category is used, stop; issue and add 100 ms; advance when `forMs`/`maxMs` is reached. A step with `forMs` N issues on exactly N/100 ticks.
- **Wait:** an until-condition that's true → advance. Otherwise add 100 ms and stop; once `forMs`/`maxMs` is reached, the next step runs at the start of that tick.
- **If / Else if:** scan adjacent alternatives once and enter the first matching body. Its completion skips all remaining alternatives. Saved `then` / `else` lists migrate to If / always-true Else if bodies.
- **End / Exit loop:** End returns from the current chain, even inside Repeat. Exit loop leaves only the nearest Repeat. There is no Cancel chain action or step (owner decision); a running chain is never replaced; it ends only through its own End step (owner decision: no Skip or Replace option).
- **Repeat:** on entry or at the top of a pass, check the count, or the while-condition and its max time, then enter the body or skip past it. The end of the body jumps back to the Repeat and **stops for this tick**.

Root interplay: the chain's issued actions take their categories (movement, rotation, ability, cancel) first; roots fill the rest by priority, as today.

### Editor (C3, direction A "node column" approved 2026-10-02)

The workspace canvas switches scope to a chain, with a breadcrumb and a fixed CHAIN header node. Steps auto-layout top to bottom (no free drag) as the existing node designs, numbered in reading order; If / Else if have nested bodies in blue brackets; Repeat is a violet bracket. Details are in the C3 prompt. A Chains list sits beside Roots with "+ Chain". Run chain nodes have Open, and the picker has "New chain…". Deleting a chain that's in use asks for confirmation.

## 4. Placeholder visuals (Pixi, presentation-only)

Rules:

- Use procedural `Graphics` or reuse existing sprites. No new image assets; the owner may add sprites later.
- Drive every effect only from shape state (`abilityActiveMs`, wind-up state). **No `Math.random`**, so replays render identically.
- Draw every hitbox-shaped effect **from the same hitbox numbers the gameplay uses** (read the contract), so what players see matches what hits.
- Register each one in `pixi/botAbilityPresentationDefinitions.js` and implement it next to the existing effect types in `pixi/PixiCanvas.jsx`.

| Ability | Effect | Placeholder |
|---|---|---|
| Slash (1) | existing `meleeSwing` | Unchanged |
| Thrust (35) wind-up | `thrustWindup` | The shaft pulls back slightly: a 4 px line, 40 units long, behind the bot's front edge |
| Thrust (35) active | `thrust` | A 4 px metallic shaft (`0xcbd5e1`) along the facing, with a 14 px triangular tip. Length extends 0 → 190 over the first 35% of the active time, holds for 30%, then retracts |
| Cleave (36) wind-up | `cleaveWindup` | An amber (`0xf59e0b`) outline of the 160° hitbox arc, plus a fill growing from the bot outward with wind-up progress, alpha 0.25 → 0.6 |
| Cleave (36) active | `cleave` | Its own effect, not the slash crescent: a filled wedge (`0xfde68a`, alpha about 0.35) sweeps across the full hitbox arc over the first 60% of active time, with a solid 8 px leading edge (`0xfff4cc`) from the bot to the tip and a 5 px rim on the outer edge; the trail fades over the last 40% |
| Smash (37) wind-up | `smashWindup` | The rectangle outline (125 × 100) in front of the bot, alpha rising with wind-up progress |
| Smash (37) active | `smash` | The rectangle flashes filled (`0xe2e8f0`, alpha 0.5 → 0) with a short impact line at the far edge, plus 3 small dust puffs that drift outward. Reuse `dashSmoke` frames if they fit |
| Sniper (3) wind-up | `sniperSight` | A 2 px red (`0xef4444`) aim line along the facing, to range or the first bot hit, alpha pulsing 0.35–0.8 |
| Sniper (3) fire | reuse `abilityRay` | `rail_shot` frames, height about 40, muzzle flash |
| Shotgun Blast (12) | entity pellets (S7) | Each pellet renders as a small projectile through the normal entity pipeline, plus a muzzle flash on the bot. Done in S7 |
| Fireball (5) | existing sprite | Visual size 60, matching the new hitbox |

- **Wind-up telegraphs need wind-up state in replay frames.** Verify the compact replay carries `preparingAbility` and `preparingMs`; if it doesn't, add them in both runtimes.
- No icons for weapons. Rename the existing icons for Sniper and Shotgun Blast only if the current icons say "gun" or "pistol".

## 5. Phases and timing

### Cycle per round

| Phase (existing name) | Duration | Clock |
|---|---|---|
| `LOADOUT_SELECT` (pick) | 30 s in round 1, 20 s in rounds 2–6, plus a 2 s hidden grace | Paused |
| Prep (existing, ≤ 2 s) | ≤ 2 s | Paused |
| `BUILDING` | Per-player deadline = build start + that player's remaining clock, plus a 2 s hidden grace. Ends when all players have submitted or expired | **Running** per player until they submit |
| `SIMULATION_LOADING` | Until the simulation finishes | Paused |
| `REPLAY` (`SIMULATION_PREPARING` 3 s + segment frames) | ≤ 20 s, shorter on KO | Paused |
| Result hold | 3 s (`roundReadyAt`) | Paused |

Then the next pick, or `MATCH_RESULT_READY` on KO or after round 6. The `OBJECT_PLACEMENT` phase is unchanged; confirm it can only occur where it does today.

### Clock rules (server-owned)

- `MatchPlayer` gains `clockRemainingMs`, `timeoutFallback` (`CURRENT` or `PREVIOUS`, default `CURRENT`), and the build-phase submitted flag (reuse `finished`).
- At build start: `clockRemainingMs += incrementMs` for every player, and `buildStartedAt` is recorded.
- On an accepted submit: `clockRemainingMs = max(0, clockRemainingMs - (submitAt - buildStartedAt))`. A submit inside the grace period leaves 0.
- On a deadline: if the client sent nothing, create a fallback submission. If the setting is `CURRENT`, the client auto-submits its current brain just before its displayed clock hits zero. The server validates it, and if it's invalid, falls back to the previous round's brain. If the setting is `PREVIOUS`, or nothing valid arrived, use the existing `createBuildingTimeoutSubmission` (previous brain plus the new loadout).
- Round 1 with no previous brain falls back to an empty brain, as today.
- Policy constants go in `MatchTimingPolicy`: base 300 s (1v1) / 420 s (2v2), increment 30 s, pick 30 s / 20 s, segment 20 s, max rounds 6.
- **Custom lobbies:** the "round duration" setting becomes a base clock (30 s–10 min) plus an increment (0–60 s).

### Events (additive fields on existing DTOs)

- `MatchmakingPlayerDTO`: `clockRemainingMs`, `buildEndsAt` (that player's absolute deadline), `submitted`.
- `MatchmakingEventDTO`: `maxRounds`, `weaponOffers` (round 1), `segmentEndState` (the frozen frame's bot states, on `MATCH_ROUND_READY` and on reconnect), and `hpDecision` on the final result.
- The submission DTO gains `variableResets` (a bounded list of variable names) and `timeoutFallback`.
- Follow the `docs/MATCH_TIMING.md` rule: every new authoritative deadline is an absolute `Instant`, normalized on the client, with a server test for delayed delivery. **This changes the documented 60/62-second ability-selection contract on purpose.** Update `MATCH_TIMING.md` in the same change, including its round-transition checklist (rounds 2, 4, 5 and 6 now matter).

### Resolution (`MatchRoundResolutionService`)

- Remove `WINS_REQUIRED` and best-of logic. `TOTAL_ROUNDS = 6`.
- The match ends when a team is eliminated during a segment, or after round 6. At round 6, compare team HP sums: higher wins, equal is a draw. Both eliminated on the same tick is a draw.
- Add a completion reason `HP_DECISION` (persisted string; check whether the enum column needs a migration).
- `roundWins` is no longer meaningful. Stop showing it, but keep the field so existing payloads don't break.

### Persistence

- Next migration: `V57`. Store each round's `variable_resets` (JSON text) beside the V24 round-code history. Confirm V24 already stores brain and loadout per round per player. Those rows plus the match seed and ruleset must be enough to re-simulate a finished match.
- Persist the match `format` marker if useful for history (`TIMED_ROUNDS_V1`).

## 6. Frontend match flow

- **Pick panel** (`pages/game/components/AbilitySelectionPanel.jsx`, `matchmaking/loadoutDraft.js`, `selectionPhase.js`):
  - round 1 has two steps: choose a weapon (all weapons in a grid), then 1 of 3 abilities;
  - rounds 2–6 choose 1 of N;
  - the opponent's picks are revealed when the phase ends;
  - the arena shows the frozen frame.
- **Build HUD:**
  - chess clocks for every player: yours counting down, others shown frozen once they've submitted;
  - a hold-to-submit button that is blocked with a reason when the brain is invalid;
  - the timeout fallback toggle;
  - a "submitted, waiting for opponent" state that shows the opponent's running clock.
- **Variables:** in `coding/modals/CustomVariablesModal.jsx`, add a per-variable "Keep last value (shows the value) / Reset to default" choice during a live match. It's sent as `variableResets` on submit.
- **Frozen frame:** keep the last replay frame, or `segmentEndState` after reconnect. Seed the existing building testing room with the frozen positions, rotations and HP. The opponent becomes a stationary dummy at their frozen position. This is a non-authoritative preview.
- **Segment replay:** play only that segment's frames. Show "Round k / 6" and HP. No round win/loss result between segments.
- **Result screen:** KO, HP decision (show both HP values), or draw. Remove the per-round "R1 / R2" rows. The match is one story.
- **Remove guaranteed offers end to end:**
  - frontend: `pages/queue/QueueAbilityGuaranteePicker.jsx` and its uses in the queue, custom-lobby and home pages;
  - server: `MatchAbilityGuaranteeController`, `MatchAbilityGuaranteeService`, the guarantee DTOs and fields, and `guaranteedAbilitiesByUserId` on `MatchSession`;
  - their tests;
  - the paragraph in `MATCH_TIMING.md`.
- Stomp client and provider (`matchmaking/stompClient.js`, `MatchmakingProvider.jsx`): carry the new fields and keep reconnect behavior.
- UI follows the `botfight-ui-design` skill (game surface). Mock up the pick panel and build HUD before this package is implemented.

## 7. Content surfaces

- **Puzzles:** add `botfight.puzzles.public-enabled` (default `false`).
  - When it's off: the public list and play/attempt endpoints in `PuzzleController` return not-found for non-admins.
  - The navbar "Puzzles" link (`components/AppNavbar.jsx`, both desktop and mobile lists) is hidden for non-admins, and `/puzzles` routes redirect home for non-admins.
  - The admin builder and admin authoring are unchanged.
  - Puzzles that use reworked abilities are left for the owner to remake.
- **Tutorial** (`tutorial/TutorialContent.js`): remove the facts that are now wrong:
  - best of three rounds;
  - 3/2/1 picks;
  - guaranteed offers;
  - fixed 3- or 5-minute building.

  Replace them with a short placeholder describing the new loop, marked `TODO(owner)` for rewriting. Bump `tutorialVersion.js` if completion depends on the content. Tutorial presets and the "Slash" lesson already use Slash instead of Basic Strike; the old weapons should switch to Slash too.
- **Ability catalogue:** a Weapons section, the tier labels "Rounds 1–2", "Rounds 3–4" and "Rounds 5–6", and the renamed Sniper and Shotgun Blast.
- **Docs:**
  - update `AGENTS.md`: the timeout-is-draw rule becomes the HP-decision rule, and the format becomes timed rounds;
  - update `MATCH_TIMING.md`;
  - add the `duel-v2` notes in `docs/ABILITY_EFFECT_CONTRACT.md` if it lists ability numbers;
  - update context maps only if responsibilities moved.

## 8. Order, risks and checks

**Order:** small stages, each testable in the practice room before the next.

| Stage | What | Test in |
|---|---|---|
| S1 | Weapons: Slash retune, plus Thrust, Cleave and Smash (combat, both runtimes) | Practice room: equip each weapon, check reach, damage and knockback against a dummy |
| S2 | Weapon placeholder visuals | Practice room and a replay |
| S3 | Fireball and Sniper rework, plus their visuals | Practice room |
| S4 | Language: Approach Angle, Is Moving, Any Ability Winding Up, hide Speed | Write conditions in the practice room |
| S5 | Lead aim | Practice room against a moving dummy |
| S6 | Reach autofill UI (after a mockup) | Condition editor |
| S7 (last) | Multi-spawn engine, then Shotgun Blast as pellet projectiles | Practice room: fan spread, pellets per distance, dodging at range |

S1–S6 don't depend on the timed-rounds format. S7 is saved for the very end, after the format work below. Current 3-round matches keep working: the new weapons are not in the match draft until P4. Basic Strike has already left the standard set, so a current match has a melee attack only if Slash is drafted. The Slash retune and the ability reworks **do** apply to current matches right away.

Status (2026-10-04): S1–S6, Approach Angle with two entities, P0a, P0b, the Cancel Wind-up fixes, fast turn and C1–C4 are implemented. Lock On and Basic Strike are out of the base kit. S2's Cleave active effect still reuses the Heavy Slash sprite instead of its own wedge.

Then action chains (section 3d), before the format work:

| Stage | What | Test in |
|---|---|---|
| C1 | Time Since Hit ability value (both runtimes) | Practice room: conditions on a hit and a miss, a projectile hit |
| C2 | Chain engine, data model and validation (both runtimes, parity) | Engine tests only; nothing to click yet |
| C3 | Chain editor (direction A, "node column", approved) | Practice room: build the Punish and feint examples |
| C4 | Chain call stack in replay frames, highlight the running step | Replay and practice room |

Then the format work:

1. ~~P0a movement prototype~~ and ~~P0b movement on the server~~: done. ~~C1–C4 chains~~: done.
2. ~~P3 segmented simulation~~: done. `DuelSimulationRequest` takes ordered `segments` and `recordFromMs`; `ClosingZoneConfig.timedRoundsV2()` is mirrored in `ArenaHazardConfig.js`. The warning ring exists as data (`warningDiameterAt` / `closingZoneWarningDiameter`) but is not yet emitted into replay frames or drawn.
3. ~~P4 lifecycle~~: done on the server. Weapons are the round 1 pick, HP is 300 and the ruleset is `duel-v2` in both runtimes. Events carry the new fields as a `timedRounds` block (`maxRounds`, `baseClockSeconds`, `incrementSeconds`, `pickSeconds`, `segmentSeconds`, `weaponOffers`, `zoneStartsInRound`, `zoneNextDiameterUnits`, `segmentEndState`, `hpDecision`) and each player carries `clockRemainingMs`, `buildEndsAt` and `timeoutFallback`. `winsRequired` is always null now and `roundWins` stays 0. The `/app/matchmaking.timeoutFallback` message sets the fallback while building. Next migration: V57 is taken (`variable_resets`, `timeout_fallback` on `match_round_bot_codes`).
4. P5 frontend flow (after P4 and the UI mockups).
5. P6 content surfaces, at any time (puzzle hiding can ship first).
6. **S7 multi-spawn engine and Shotgun Blast**, last.

Weapon numbers were set before the movement system exists; expect to retune them after P0b.

**Main risks:**

- **Brain swap leaking state.** Test that brain *k* never runs on a tick after boundary *k*. Test that segment *k*'s frames are identical whether produced in round *k* or by re-simulating at round 6.
- **Round-transition state leaks.** The existing checklist in `MATCH_TIMING.md` warns about this, and it now spans 6 rounds. Test rounds 2, 3, 5 and 6 explicitly, including pick timeout auto-picks (weapon defaults to Slash; the ability defaults to the first offer).
- **Clock arithmetic at the edges:** a submit during the grace period, a reconnect mid-build, both clocks at 0, a 2v2 where one teammate has expired.
- **Stamina parity:** the regeneration pause, hit refunds and dash gaps are tick-counted state, which is exactly the "timer-driven state" class of bug in the regression checklist. Test tick-by-tick traces on both runtimes, including a stamina change at a round boundary (stamina carries over like everything else).
- **Browser/server parity for weapons and the zone.** The zone needs a new `ClosingZoneConfig.timedRoundsV2()`:
  - no zone in rounds 1–4: it starts at 80,000 ms, the start of round 5;
  - two contractions of 5 s each: 1200 → 900 units at the start of round 5 and 900 → 600 at the start of round 6;
  - a warning ring shows the next size during the round before each step (the 900 ring in round 4, the 600 ring in round 5);
  - damage unchanged;
  - `simulationDurationMs` 120,000.

  Mirror it in the browser's `gameconfig/ArenaHazardConfig.js`.

**Checks:**

- Server: `.\mvnw.cmd test`, with focused suites first (simulation, gameconfig/ecs parity, match lifecycle).
- Frontend: `npm test`, `npm run lint`, `npm run build`.
- Run `docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md` for S1 to S3 and S7.

## 9. Sonnet prompts

Each prompt is self-contained. Run them in the order in section 8. Each one ends with "update affected tests" and "don't commit".

### S1: Weapons (combat only)

```
Botfight: add the weapon set from docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md
section 3 ("Weapons") in BOTH runtimes: browser frontend/src/gameArena
(gameconfig/AbilityRegistry.js, gameconfig/Abilities.js,
ecs/contracts/AbilityContracts.js, loadout/BotLoadout.js) and server
simulation/gameconfig + simulation/ecs/contracts/AbilityContracts.java.
Follow docs/ADDING_AN_ABILITY_OR_MOVE.md; use the tools/botfight-mcp
scaffolds and parity report.

Weapons (all hitboxes start at the bot's center, includeTargetRadius: true,
no ammo; times in ms):
- Slash (1, retune): arc 120°, range 92; 8 damage; windup 0 / active 300 /
  cooldown 500.
- Thrust (35, new): rectangle length 190, width 30; 10 damage;
  100 / 300 / 700.
- Cleave (36, new): arc 160°, range 112; 15 damage; 450 / 300 / 650.
- Smash (37, new): rectangle length 125, width 100; 11 damage + knockback
  120 (existing KNOCKBACK effect, bots and summons, as Repelling Blast does);
  250 / 300 / 700.
attackDamageMultiplier and attackSpeedMultiplier apply as they do to Slash.

- Add category: "weapon" catalog metadata. Action and catalogue labels read
  "Weapon: <name>" for this category (instead of "Ability: <name>"). No icons:
  use the existing text fallback.
- New IDs need registry entries, compact ability codes on both sides
  (server CompactAbilityCode and the browser loadout encoding), and catalogue
  descriptions.
- Make all four weapons selectable in the practice-room loadout editor.
  Slash stays in the tier 1 draft pool; Thrust, Cleave and Smash are NOT
  added to any match draft pool. Do NOT change Basic Strike, HP, or the
  ruleset version (those come later with the match format).
- Visuals may use existing fallbacks; dedicated visuals are the next stage.

Add parity tests per weapon: a target just inside and just outside effective
reach (hitbox length + 30), arc and rectangle side edges, damage, timing,
and Smash knockback. Update affected tests. Run server tests (.\mvnw.cmd test
from server/) and frontend npm test. Don't commit.
```

### S2: Weapon placeholder visuals

```
Botfight frontend: add placeholder Pixi visuals for the weapons Thrust (35),
Cleave (36) and Smash (37), per docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md
section 4. Slash (1) keeps its existing meleeSwing visual unchanged.
Files: frontend/src/gameArena/pixi/botAbilityPresentationDefinitions.js,
PixiCanvas.jsx, pixiVisualState.js.

Rules:
- Presentation only: never affects hits, damage, cooldowns or results.
- Procedural Pixi Graphics or existing sprites only; no new image assets.
- No Math.random; drive everything from bot state (wind-up progress from
  preparingAbility/preparingMs, active progress from abilityActiveMs), so
  replays render identically to live play.
- Size every shape from the ability's real contract hitbox (range, arc,
  length, width), not hard-coded numbers, so retuning a weapon updates its
  visual.
- Register each effect in botAbilityPresentationDefinitions.js and implement
  it beside the existing effect types in PixiCanvas.jsx.

Effects:
- Thrust wind-up ("thrustWindup"): a 4 px metallic line (0xcbd5e1) pulling
  back about 40 units behind the bot's front edge as wind-up progresses.
- Thrust active ("thrust"): the same shaft with a 14 px triangular tip along
  the facing; length grows 0 -> hitbox length over the first 35% of active
  time, holds for 30%, retracts over the last 35%.
- Cleave wind-up ("cleaveWindup"): an amber (0xf59e0b) outline of the
  hitbox arc (160°, its range), plus a fill that grows from the bot outward
  with wind-up progress; alpha rises about 0.25 -> 0.6.
- Cleave active ("cleave"): its own effect, NOT the slash crescent. A filled
  wedge (0xfde68a, alpha about 0.35) sweeps across the full hitbox arc over
  the first 60% of active time, with a solid 8 px leading edge (0xfff4cc) from
  the bot to the tip and a 5 px rim along the outer edge; the trail fades over
  the last 40%.
- Smash wind-up ("smashWindup"): the hitbox rectangle outline in front of
  the bot, alpha rising with wind-up progress.
- Smash active ("smash"): the rectangle flashes filled (0xe2e8f0, alpha
  0.5 -> 0), a short bright impact line at its far edge, and 3 small dust
  puffs drifting outward and fading (reuse dashSmoke frames if they fit,
  otherwise circles).

Replay prerequisite: first verify the compact replay carries each bot's
wind-up state (preparingAbility, preparingMs) so wind-up telegraphs render in
match replays. If it doesn't, add it on both sides (server
simulation/core/replay + the replay DTO, browser replay mapping) and add a
parity test.

Run docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md. Add or update
pixi tests (pixiVisualState.test.js, botAbilityPresentationDefinitions.test.js)
for the new definitions and progress math. Run npm test, lint, build (and
server tests if you touched the replay). Don't commit.
```

### S3: Fireball and Sniper

```
Botfight: rework Fireball (5) and Gun (3) -> Sniper per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3 ("Reworked tier 1
abilities"), in both runtimes, keeping their IDs.
- Fireball: remove ammo/reload; cooldown, 64x64 hitbox, visual size 60,
  lifetime and damage as specified.
- Sniper: rename label and catalogue text; remove ammo and falloff; 900 ms
  wind-up during which the bot may still rotate; fires along its facing at
  release; range, width and damage as specified.
- Visuals from section 4: Fireball size; Sniper sight line during wind-up,
  rail_shot ray on fire.
- Check any puzzles, tutorial presets or tests that rely on Gun ammo, and
  update the tests (puzzles are remade by the owner later).
Add parity tests. Update affected tests. Run server tests and frontend
npm test, lint, build. Don't commit.
```

### S4: Language: new conditions

```
Botfight: implement the state-variable changes in
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3b (Approach Angle, Is
Moving, Any Ability Winding Up, hide Speed), in BOTH runtimes
(frontend/src/gameArena/botlogic/code + modelPayloads; server simulation/bots
+ simulation/core/logic).
- Stable new IDs; picker labels and one-line descriptions (VARIABLE_DESCRIPTIONS).
- Speed: remove it from the visible picker only; keep evaluating it for old
  brains.
- Validate the new IDs at the submission boundary.
Parity tests for each variable, including the stationary case of Approach
Angle (90) and knockback counting as moving. Update affected tests. Run
server tests and frontend npm test. Don't commit.
```

### S5: Lead aim

```
Botfight: add lead aim per docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section
3b to Rotate: Face Target and to ability actions that aim at a target, in
BOTH runtimes.
- New optional block fields: aim = current | lead | auto, leadSeconds
  (0-2, step 0.1), leadAbilityId. Default current = today's behavior; old
  brains unchanged.
- Predicted point = target position + last-tick velocity x lead time,
  clamped to the arena. Auto lead time = the chosen ability's remaining
  wind-up (full wind-up if not started) + projectile travel time (0 for
  hitscan and melee).
- Editor: an "Aim" segmented control (Current | Lead | Auto) in the action
  config, following the botfight-ui-design skill; validate and bound the
  fields at normalization and at the server boundary.
Parity tests: stationary target (no lead), straight-line mover, mid-segment
direction change. Update affected tests. Don't commit.
```

### S3–S5 combined (one Sonnet run)

```
Botfight: implement stages S3, S4 and S5 from
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md, in this order. Each part touches
BOTH runtimes (browser frontend/src/gameArena, server simulation/) and must
keep them in parity. Finish each part (code + its tests passing) before
starting the next, and at the end report what changed per part.

PART A: S3, Fireball and Sniper (plan sections 3 and 4)
- Fireball (id 5): remove ammo/reload (maxCharges, resourceModel, chargeType,
  reloadMs); cooldown 5500 ms; projectile hitbox 30x30 -> 64x64; visual size
  30 -> 60; lifetime 1000 -> 1400 ms; damage 15 -> 20; burn unchanged.
- Gun (id 3) -> Sniper: change the display label and catalogue text to
  "Sniper". Keep the internal registry name "gun" and the ID, because saved
  brains may refer to abilities by legacy name (abilityIdFromLegacyName).
  Remove ammo and damage falloff. Wind-up 900 ms, active 200, cooldown 9000.
  Ray range 1200, width 6, flat damage 40. The bot may keep rotating during
  the wind-up; the ray fires from the bot's position and facing at release,
  not where it was when the wind-up started.
- Visuals (presentation only, no Math.random, sized from the contract):
  Fireball uses its existing sprite at the new size. Sniper wind-up
  ("sniperSight"): a 2 px red (0xef4444) aim line along the facing to max
  range or the first bot it would hit, alpha pulsing 0.35-0.8. Sniper fire:
  reuse the abilityRay effect with rail_shot frames, height about 40, with a
  muzzle flash. Update presentation definition 3 accordingly.
- Update tests, tutorial presets and fixtures that rely on Gun or Fireball
  ammo. Leave puzzles alone (the owner remakes them later).
- Parity tests: Fireball hitbox edges at 64x64 and travel distance; Sniper
  hit at 1200, miss beyond, the aim follows rotation during the wind-up.

PART B: S4, new conditions (plan section 3b)
- Add state variables, mirrored in frontend botlogic/code/contracts/
  BotLogicContracts.js, runtime/stateVariableResolver.js,
  modelPayloads/strategyStatePayload.js and the server simulation/bots +
  simulation/core/logic:
  - selectable.approachAngle ("Approach Angle", group Movement, 0-180 deg):
    the angle between the entity's last-tick movement direction and the
    direction from it to My Bot. 0 = coming straight at me, 180 = moving
    straight away; 90 when it didn't move last tick.
  - selectable.moving ("Is Moving", boolean): moved last tick, including
    knockback and dash.
  - bot.anyAbilityPreparing ("Any Ability Winding Up", boolean, any bot
    selectable): true while any of its abilities is winding up.
- Remove selectable.speed from the visible picker only. Keep it in
  STATE_VARIABLES and keep evaluating it unchanged so old brains still work.
  Raw Move Direction stays.
- Add one-line picker descriptions (VARIABLE_DESCRIPTIONS). Validate and
  bound the new IDs at the server submission boundary.
- Parity tests for each, including Approach Angle when stationary (90),
  head-on (0), fleeing (180), and knockback counting as moving.

PART C: S5, lead aim (plan section 3b)
- Add an optional aim setting to Rotate: Face Target and to ability actions
  that aim at a target: aim = current (default; exactly today's behavior) |
  lead (with leadSeconds, 0-2, step 0.1) | auto (with leadAbilityId).
- Predicted point = target position + target velocity (last-tick
  displacement per second) x lead time, clamped to the arena. For auto, lead
  time = the chosen ability's remaining wind-up (full wind-up if not started)
  + projectile travel time (distance / projectile speed; 0 for hitscan and
  melee).
- Old brains without the field behave exactly as today. Normalize and bound
  the new fields in browser normalization and at the server boundary.
- Editor: an "Aim" segmented control (Current | Lead | Auto) in the action
  config, with a seconds input for Lead and an ability picker for Auto,
  following the botfight-ui-design skill (tool surface: Plex Sans, ~32 px
  controls, segmented toggle).
- Parity tests: a stationary target (no lead), a straight-line mover, a
  target that changes direction (the prediction misses).

Throughout: follow docs/ADDING_AN_ABILITY_OR_MOVE.md for the ability changes
and run docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md for Part A.
Update affected tests. Run server tests (.\mvnw.cmd test from server/) and
frontend npm test, lint, build. Don't commit.
```

### S6: Base Range ability variable

```
Botfight: replace the reach-autofill proposal in section 3b with a numeric
"Base Range" ability variable in the existing variable system.
- Select an equipped ability and read its configured base range directly,
  so conditions such as Distance(My Bot, Opponent) <= Base Range(Slash)
  stay linked to the ability's current tuning rather than inserting a number.
- Derive the value from the real ability contract in arena units: arc range,
  rectangle length, ray range, or projectile speed x lifetime (with matching
  time units). Do not add target radius; this is base range, not a hit check.
  Exclude abilities without a meaningful range from the ability picker.
- Do not add Base Arc or the Reach autofill button.
- Mirror the variable ID, ability selection, normalization, validation and
  evaluation in the browser and authoritative server. Add picker help text
  and parity tests for supported range types and invalid ability selections.
Update affected tests. Run server tests (.\mvnw.cmd test from server/) and
frontend npm test, lint, build. Don't commit.
```

Follow-up to S4: generalize Approach Angle to two entity selectors, "Moving
Entity" and "Target Entity". Measure the first entity's last-tick movement
against the direction from it to the second entity's position: 0 degrees toward,
90 sideways, 180 away; retain 90 when stationary or positions coincide. This
does not use relative velocity. Default the second selector to My Bot for saved
conditions, preserving existing behavior. Mirror the change in browser/server
contracts, normalization, validation and evaluation, with parity tests.

### P0a: Movement prototype (browser only)

```
Botfight frontend: prototype the movement system in the browser practice arena
only (non-authoritative), per docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md
section 3a and docs/TIMED_ROUNDS_MATCH_FORMAT.md section 5a. Do not touch
the server.
- Bot stamina (100, 20/s regen after 750 ms idle, 1.5 s no-regen
  exhaustion at 0, no slowdown); sprint (+50%, any direction, 30/s, ends on
  attack/ability use or 0 stamina); Dash costs 30 stamina instead of its
  cooldown, with a 300 ms gap between chained dashes; wind-up cancel (25
  stamina, no cooldown, no restart lock).
- New logic actions (sprint start/stop, cancel wind-up) and the
  conditions/state variables listed in section 3a, in
  frontend/src/gameArena/botlogic and modelPayloads. Mark them clearly as
  prototype so they can't be submitted to rated matches yet.
- A stamina bar on the fighter card (status panel), with an exhausted state.
- Keep all numbers in one config object so they're easy to tune.
Add focused tests for stamina regeneration and dash chaining. Update affected
tests. Run npm test, lint, build. Don't commit.
```

### P0b: Movement on the server, with parity

```
Botfight: make the movement system from P0a authoritative, per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3a, using the numbers the owner chose after
playtesting.
- Server: stamina/sprint/exhaustion/dash-gap state on the Bot in
  DuelSimulationService and BotStateService; the stamina-cost model for Dash
  (19); sprint and wind-up-cancel actions; the new conditions/state variables
  in simulation/bots and simulation/core/logic. Validate and bound the new
  action and condition IDs at the submission boundary.
- Include stamina fields in compact replay frames; mirror them in replay
  presentation.
- Remove the prototype gating from P0a and align the browser numbers with
  the server.
- Confirm hit checks happen at the active frame after the wind-up in both
  runtimes; flag any ability that captures its target position at wind-up
  start.
Add tick-by-tick parity tests (stamina regen delay, exhaustion, dash chains,
sprint cancel on attack, cancelled wind-up). Run
docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md. Update affected tests.
Don't commit.
```

### C1: Time Since Hit

```
Botfight: add the Time Since Hit ability value per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3d (C1), in BOTH runtimes,
in parity.
- Variable bot.selectedAbilitySinceHit ("Time Since Hit"), number, seconds,
  step 0.1, 0 to CUSTOM_NUMBER_MAX (99999), added to GENERIC_ABILITY_VARIABLES in
  frontend/src/gameArena/botlogic/code/contracts/BotLogicContracts.js (ability
  picker, My Bot or an opponent) and the server simulation/bots +
  simulation/core/logic mirror. One-line picker description and a catalogue
  description (pages/catalogue/ConditionalCataloguePage.jsx). Validate it at
  the submission boundary like the other ability variables.
- Per bot, record the time of the last hit per ability ID: the tick where
  that ability's own hitbox, or an entity it spawned (attribute by owner +
  ability ID), damages or applies an effect to an ENEMY BOT. Allies and
  summons don't count; several hits in one tick count once. Find the single
  place effects land on bots in each runtime (browser gameArena/ecs/abilities,
  server simulation/core/combat) rather than patching each ability.
- Value = seconds since that hit; the tick after the hit reads 0.1.
  99999 (the general number limit) if the ability never hit, so it
  round-trips through custom number variables. Carry it in the strategy state payload
  (modelPayloads/strategyStatePayload.js) and the server resolver.
- Tests (browser and server, same scenarios): Slash hit then misses; a
  Fireball hit attributed to Fireball at impact time, not cast time; a hit
  on a summon or ally doesn't count; opponent selectable; never-hit = 99999.
Update affected tests. Run server tests (.\mvnw.cmd test from server/) and
frontend npm test, lint, build. Don't commit.
```

### C2: Action chain engine

```
Botfight: implement the action chain engine per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3d (brain data, runtime
state, per-tick algorithm) and docs/TIMED_ROUNDS_MATCH_FORMAT.md section 5d,
in BOTH runtimes, in exact parity. No editor UI yet (that's C3).
- Brain data: `chains` with the step types in section 3d; root actions
  run_chain (chainId; a running chain is never replaced), which uses no
  movement/rotation/ability/cancel category. Keep this action out of the
  action picker until C3. Normalize and preserve `chains` on save (old brains
  have none and behave exactly as before). Count chain steps toward the
  existing brain size metrics.
- Validation (browser normalization and server BotSubmissionValidationService
  + BotLogicContracts.java): the bounds in section 3d, every ms value a
  multiple of 100, known step types only, existing chainId references, no
  call cycles, call depth <= 3, loop nesting <= 2.
- Runtime: a chainStack on the bot that persists across ticks (browser: carry
  it through the action plan like customVariables, see
  botlogic/code/runtime/actionSelector.js and
  botlogic/planner/ArenaActionPlanner.js; server: a Bot field used by
  DuelSimulationService.selectStrategyActionPlan). Put the step logic in one
  module per side (e.g. botlogic/code/runtime/chainRuntime.js,
  simulation/core/logic/ChainRuntime.java).
- Tick order and resumeChain exactly as section 3d: chain control from roots
  (the highest-priority Run chain), then the chain, then
  roots fill the categories the chain didn't use. A step that issues nothing
  claims nothing. A Use ability step that can't start skips and waits until next tick to continue. "When
  it ends" means no longer winding up or active, for any reason. Cancel
  Wind-up uses the cancel category and stops the chain for that tick. The
  end of a Repeat body jumps back and stops for the tick. Stun or death ends
  the chain. Chain variable writes are visible to later chain steps that
  tick; roots read start-of-tick values.
- Tests (browser and server, tick by tick, comparing step paths and actions):
  the Punish example (Use Smash, If Time Since Hit, Walk 0.5 s + Use Thrust /
  Dash); the feint (Use Cleave right away, Wait 0.3 s, Cancel Wind-up, Use
  Cleave): it doesn't end itself; Wait until Ability Ready with max; Repeat
  count and while + max, one pass per tick at most; call and return, End inside
  Repeat returns to the caller; root abilities alongside a continuing chain;
  one chain at a time; chain vs root claims per category;
  a Use step that can't start skips; first-matching If / Else if bodies across
  ticks; orphan Else if rejection; stun ends it; validation
  rejections (cycle, depth, bounds, unknown step).
Update affected tests. Run server tests (.\mvnw.cmd test from server/) and
frontend npm test, lint, build. Don't commit.
```

### C3: Chain editor (direction A approved 2026-10-02)

```
Botfight frontend: build the action chain editor per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3d ("Editor"), approved
direction A ("node column"), following the botfight-ui-design skill
(tool surface). Reuse the existing graph node components and styles in
frontend/src/gameArena/coding/nodes/GraphNodes.jsx and index.css; don't
restyle the main canvas.
- Navigation: the Roots panel gets a Chains tab listing each chain with its
  step count, plus "+ Chain". Opening a chain switches the workspace canvas
  to that chain. The toolbar identity slot shows "← Brain › <name>" (back
  returns to the main canvas) and a step meter "14 / 32 steps" that turns
  amber, then red, near the limit.
- Chain canvas: a fixed grey CHAIN header node (name, "Used by N roots").
  Steps auto-layout top to bottom in one column joined by short connector
  lines (no free drag), each with a step number in reading order (condition,
  nested body, then the following siblings):
  - action steps are green action nodes with the yellow category label
    (ABILITY / MOVE / ROTATE / VARIABLE / CANCEL) and a one-line summary
    ("Opp 1, continue right away", "sprint, for 0.5 s");
  - If / Else if are blue nodes with condition strips and a blue bracket
    around their nested body. Else if is offered only after If or Else if;
  - Repeat is a violet (#a78bfa) left bracket around its body, labelled
    "Repeat 2 times" / "Repeat while … (max N s)";
  - Wait, Exit loop, End and Run chain are grey nodes with a muted label;
  - "+ Step" at the end of each column and inside brackets and paths.
- Selection and config: click selects (white outline); the existing side
  panel edits the selected step. Use ability, in order: Ability, Target,
  Aim, Continue (When it ends | Right away), with an ⓘ "If <ability> can't
  start when this step is reached, skip it and continue next tick. Put 'Wait until
  <ability> Ready' before it to wait." Walk/Rotate add For N s | Until
  <conditions> + max; Wait: For | Until + max; Repeat: Times | While + max.
  Seconds in 0.1 steps. A quiet red "Delete step" at the bottom.
- Main canvas: show Run chain in the action picker. Run
  chain is a green node with a CHAIN label, the chain name, "if running:
  skip" or "replace" in its summary, and an Open button; its config has a
  chain picker with "New chain…". Opening is
  deliberate (Open button or double-click), never on drag.
- Rename keeps the ID. Deleting a chain that's in use asks for confirmation.
  The editor blocks call cycles and over-limit steps with a reason.
- Phones: the chain is its own screen with a back arrow and the step meter;
  If / Else if keep the same nested body layout.
Update affected tests. Run npm test, lint, build. Don't commit.
```

### C4: Chains in replays

```
Botfight: show running chains in replays and the practice room, per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3d, in BOTH runtimes.
- Compact replay frames carry each bot's top chain frame (chainId, step
  path) and call depth (server simulation/core/replay + DTO, browser replay
  mapping); nothing when no chain is running.
- Practice room and replays: a small "Chain: <name>" chip on the fighter
  card while one runs (botfight-ui-design game surface), and when the chain
  editor is open on that chain, highlight the running step.
Parity test for the frame fields. Update affected tests. Don't commit.
```

### P3: Segmented simulation

```
Botfight server: make DuelSimulationService run a match as consecutive
segments with a brain schedule, per docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md
section 2 (no snapshot serialization).
- Extend DuelSimulationRequest with ordered segments (endsAtMs, and per bot:
  brain, selectedLoadout, variableResets). At each boundary tick, before
  logic: swap brain + prepareStrategy, update abilities/combatLoadout, give
  newly added abilities fresh resources (extract a helper shared with
  BotStateService.create), and reconcile custom variables (keep same
  name+type unless reset; new/reset/type-changed get default; undeclared are
  dropped), and end any
  running action chain (empty chainStack). Nothing else resets.
- Add recordFromMs so the compact recorder keeps only the target segment and
  takes its initial state from the boundary.
- Add ClosingZoneConfig.timedRoundsV2() (plan section 8): starts at 80000 ms,
  1200 -> 900 units at the start of round 5 and -> 600 at the start of round 6
  (5 s contraction each), with a warning ring showing the next size during the
  round before each step, damage unchanged, simulationDurationMs 120000;
  mirror it in the browser's gameconfig/ArenaHazardConfig.js. Segments are 20 s.
  Lift the 90 s cap checks accordingly.
- Keep the single-segment path identical, so puzzles and existing callers are
  unaffected.
Tests: segment k frames identical whether produced alone or re-simulated after
later segments; a brain swap takes effect exactly at the boundary tick;
variable keep/reset/drop; a new ability is ready while existing cooldowns
persist; a KO mid-segment ends the run. Update affected tests. Don't commit.
```

### P4: Match lifecycle (server)

```
Botfight server: implement the timed-rounds lifecycle per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md sections 3 (pools/offers), 5 and 6
(guarantee removal), under service/match/.
- Format-level content switches, in both runtimes: add weapons 1/35/36/37
  to the draft as the round 1 weapon pick and remove Slash from the tier 1
  pool; base HP 150 -> 300 everywhere; DUEL_RULESET_VERSION
  "duel-v1" -> "duel-v2" (both constants). (Basic Strike and Lock On are
  already out of the standard set.)
- MatchTimingPolicy: base clock 300 s (1v1) / 420 s (2v2), increment 30 s,
  pick 30 s (round 1) / 20 s, segment 20 s, max rounds 6. Custom lobbies
  configure base (30 s-10 min) and increment (0-60 s) instead of round
  duration. Offers are shared by all four players in 2v2, and teammates can
  view each other's brains read-only during the build.
- Per-player clocks on MatchPlayer (clockRemainingMs, timeoutFallback);
  per-player build deadlines; submit deducts elapsed build time; the build
  ends when all have submitted or expired; fallback per plan section 5. Clocks
  only run in BUILDING.
- Picks: round 1 = weapon (any of 1/35/36/37) + 1 of 3 tier-1 offers; rounds
  2-6 per the tier mapping (2 offers in tier 3); never offer an owned ability;
  timeout auto-picks Slash + first offer. Validate weapon/offer allowlists.
- MatchSimulationService builds the segment request from all rounds' stored
  brains/loadouts/variableResets and returns only the current segment.
- Resolution: remove best-of; end on elimination or after round 6 with an HP
  decision (team HP sum; equal or simultaneous death = draw); add completion
  reason HP_DECISION.
- Additive DTO fields per plan section 5; submission DTO gains variableResets
  (bounded, validated against the brain's declared variables) and
  timeoutFallback. V57 migration for per-round variable_resets.
- Remove guaranteed offers end to end (controller, service, DTO fields,
  MatchSession map, tests).
- Update docs/MATCH_TIMING.md (this intentionally changes the 60/62 s
  selection contract) and its round-transition checklist for 6 rounds.
Tests: clock deduction and grace, both fallbacks, reconnect mid-build, picks
across rounds 1/2/3/5/6, KO end, round-6 HP decision and draw, 2v2 per-player
clocks. Update affected tests. Don't commit.
```

### S7: Multi-spawn engine and Shotgun Blast (last)

```
Botfight: implement the multi-spawn engine and Shotgun Blast per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3c, in BOTH runtimes.
- Contract: optional spawn.pattern (fan | ring | line; count 1-12, spreadDeg,
  spacing), normalized and bounded; no pattern = one entity, so existing
  abilities are unchanged.
- Spawning: abilitySpawn becomes abilitySpawns (server
  ActionExecutionService/DuelSimulationService; browser
  ecs/bots/ActionExecutionSystem.js and its consumers). Serial IDs assigned in
  index order; serial counter advances by the number spawned.
- Optional oncePerVolley on collision events and selectable: false on entity
  contracts, per section 3c.
- Shotgun Blast (Pistol, id 12): rename, remove ammo, 7-pellet fan per
  section 3c; pellets render through the normal entity pipeline plus a muzzle
  flash.
Parity tests: fan angles and serial order, pellets per distance (50, 120,
200, 260), a fast pellet never skipping through a bot, oncePerVolley, an
unchanged single-spawn ability. Update affected tests. Run server tests and
frontend npm test, lint, build. Don't commit.
```

### P5: Frontend match flow

```
Botfight frontend: implement the timed-rounds match flow per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 6, following the
botfight-ui-design skill and the approved mockups.
- Pick panel: round 1 weapon grid (all weapons) then 1 of 3 abilities; rounds
  2-6 one of N; reveal both picks; the frozen frame stays visible.
- Build HUD: per-player chess clocks from server deadlines (MATCH_TIMING.md
  normalization, 250 ms loop); hold-to-submit, blocked with a reason when the
  brain is invalid; a timeout fallback toggle; auto-submit the current brain
  just before the deadline when the fallback is CURRENT; a waiting state that
  shows the opponent's clock.
- CustomVariablesModal: per-variable keep-last-value/reset choice during live
  matches -> variableResets on submit.
- Seed the building testing room from the frozen frame (positions, rotations,
  HP; the opponent is a stationary dummy). Non-authoritative.
- Segment replay with "Round k / 6"; result screen for KO / HP decision /
  draw; remove per-round rows.
- Remove the guaranteed-offer UI and the stomp/provider fields; add the new
  event fields.
Update affected tests. Run npm test, lint, build. Don't commit.
```

### P6: Content surfaces

```
Botfight: per docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 7:
- Add the botfight.puzzles.public-enabled flag (default false): the public
  puzzle list/play/attempt endpoints return not-found for non-admins; hide the
  Puzzles nav links (desktop and mobile) and redirect /puzzles for
  non-admins; the admin builder is unchanged.
- Tutorial: remove the outdated match-format facts in
  tutorial/TutorialContent.js and replace them with a short placeholder
  marked TODO(owner); switch tutorial presets off the old weapons (Basic
  Strike is already replaced by Slash); bump tutorialVersion.js if needed.
- Ability catalogue: a Weapons section, tier labels by round pair, and the
  renamed abilities.
- Update AGENTS.md product constraints (HP decision instead of
  timeout-is-draw; timed-rounds format).
Update affected tests. Don't commit.
```

## 10. Owner decisions still open

- The final numbers after playtesting: weapon damage, HP, clock, zone, and segment length.
- Heavy Slash versus Cleave overlap.
- Whether to add AFK auto-submit (the clock already bounds waiting).
- ~~Whether teammates in 2v2 can see each other's brains read-only during the build.~~ Decided: yes, read-only; offers are shared by all four players. Whether 2v2 needs its own HP pool is a tuning item.
- Whether round 1 starts from an empty brain or from a saved one.
- The tutorial rewrite (owner-written).
- ~~Lock On and fast turn~~ Decided: Lock On leaves the base kit and fast turn replaces it.
- Optional movement depth (brace, back hits), added one at a time if fights still feel shallow.
- The active/recovery time refactor (owner will request it separately).
