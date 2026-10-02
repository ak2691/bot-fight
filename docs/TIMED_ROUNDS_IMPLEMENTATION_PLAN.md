# Timed Rounds Implementation Plan

Status: plan, not started. This turns the design in [`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md) into implementation work for Sonnet. Section 9 has one prompt per work package. File paths and symbols were checked against the code on 2026-10-01; confirm them again before editing.

## 1. Locked decisions

| Area | Decision |
|---|---|
| Rounds | Up to 6 rounds in one continuous fight. No best-of series |
| Base kit | Dash (19) and Lock On (20). Basic Strike (34) is no longer granted |
| Weapon | Round 1 only, chosen from **all** weapons. All weapons are melee, reach ≤ 300 units |
| Abilities | 1 per round. Rounds 1–2 tier 1, 3–4 tier 2, 5–6 tier 3. 3 offers (2 in tier 3) |
| Offers | Shared seed, never an owned ability, no guarantees, no role tags |
| Clock | 2:00 base per player, +20 s at the start of every build (round 1 starts at 2:20), no per-round cap |
| Pick time | 30 s in round 1 (weapon + ability), 20 s in rounds 2–6. Not taken from the clock |
| Submit | Final, validated, hold-to-submit |
| Timeout | Player setting: submit current code (if valid), or last round's code |
| Segment | 30 s of simulation per round, continuing exactly from the previous segment |
| Variables | Keep their last-frame value, or reset to default, per variable |
| Ending | KO ends the match. After round 6, higher HP wins (2v2: team HP sum). Draw on equal HP or a simultaneous death |
| HP | 150 → **300** |
| Ruleset | `duel-v1` → `duel-v2` |
| Puzzles | Hidden from the public. Admins can still edit them |
| 2v2 | Per-player clocks, picks, brains and fallback settings |

## 2. Architecture: one continuous simulation with a brain schedule

**Don't serialize snapshots. Re-run the match.** To produce segment *k*, the server runs the whole match from tick 0 with the original seed, swapping each bot's brain and loadout at each round boundary. It records only segment *k*'s frames.

Reasons:

- **Determinism is guaranteed by construction.** There is no snapshot format to keep complete. `Bot` has more than 60 mutable fields (statuses, pending cooldowns, charges, wind-ups, rewind state, entities, zone state, RNG), and a snapshot that misses one breaks resume silently.
- **It's cheap.** The whole match is at most 1,800 ticks, which takes milliseconds.
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
4. Everything else continues untouched: position, HP, statuses, cooldowns, wind-ups, entities, zone.

Live match state needs nothing new except per-player clocks, picks, fallback settings and variable resets, all in memory under the existing match lock. The **only** real-time element is the clock, and it's a set of server deadlines, the same pattern as today's building deadline.

## 3. Weapons and ability rework (both runtimes)

Cycle = wind-up + active + cooldown. Today, cooldown starts after the active phase ends (`abilityPendingCooldownMs`). Damage per second assumes every hit lands. With 300 HP, the weapon damage-per-second band of about 8–11 gives about 30 s time-to-kill at 100% uptime, roughly 3 segments at realistic uptime.

### Weapons (new category `weapon`)

| Weapon | ID | Hitbox | Damage | Wind-up / active / cooldown | Damage per second | Identity |
|---|---|---|---|---|---|---|
| Slash | 1 (retuned) | arc 120°, range 92 | 8 | 0 / 300 / 500 | 10.0 | Baseline |
| Spear | 35 (new) | rectangle length 170, width 36 | 9 | 0 / 300 / 800 | 8.2 | Reach, narrow |
| Axe | 36 (new) | arc 150°, range 105 | 14 | 400 / 300 / 600 | 10.8 | Wind-up telegraph, big hits |
| Daggers | 37 (new) | arc 70°, range 72 | 4 × 2 hits, 150 ms apart | 0 / 300 / 450 | 10.7 | Shortest reach, two hits |

- All weapon hitboxes use `includeTargetRadius: true`, like Slash today.
- Daggers use the existing `EVENT_SCHEDULE_MODES.REPEAT` with `count: 2` and `intervalMs: 150` (it is already supported by the contract normalizer).
- No ammo on any weapon.
- `attackDamageMultiplier` and `attackSpeedMultiplier` apply as they do to Slash today.

### Reworked tier 1 abilities

| Ability | ID | Change |
|---|---|---|
| Fireball | 5 | Remove ammo and reload. Cooldown 5,500. Projectile hitbox 30×30 → **64×64**, visual 30 → 60. Lifetime 1,000 → 1,400 (about 700 units at speed 50). Damage 15 → 20, burn unchanged (2/s for 5 s) |
| Sniper (was Gun) | 3 | Rename (label and catalogue text). Remove ammo and falloff. Wind-up **900** (aim telegraph), active 200, cooldown 9,000. Ray range 1,200, width 6. Flat damage 40 |
| Shotgun Blast (was Pistol) | 12 | Rename. Remove ammo. Wind-up 150, active 200, cooldown 5,000. Arc hitbox range 220, 50°. Damage falloff 24 at ≤ 80 units to 8 at 220. Knockback 120 on bots. If damage falloff only supports rays today, use a flat 18 and note it |

- Keep IDs 3, 5 and 12. No code re-simulates old matches, and `duel-v2` marks the change.
- **Basic Strike (34)** is removed from `STANDARD_ABILITY_IDS` (browser) and the server's equivalent standard set, and is never offered. Keep its definition for now.
- **Heavy Slash (7)** stays a tier 1 ability, unchanged. The owner may revisit it, since it overlaps with Axe.
- Other abilities keep their numbers for now. HP doubling makes them relatively weaker; a balance pass comes after playtesting.

### Pools

- Tier 1 (rounds 1–2): `3, 4, 5, 7, 9, 10, 11, 12, 26, 28, 29` (Slash removed).
- Tier 2 (rounds 3–4): unchanged.
- Tier 3 (rounds 5–6): unchanged, with 2 offers.
- Weapons: `1, 35, 36, 37`.
- Server: `MatchLoadoutService.ROUND_ABILITIES` becomes tier pools plus `tierForRound(r) = (r + 1) / 2`. Browser mirror: `ROUND_ABILITY_DRAFT` and the catalog `round` field in `gameArena/loadout/BotLoadout.js`. Add `category: "weapon"` metadata.
- **Offer generation:** shuffle the tier pool with `simulationSeed ^ (constant * round)` (as today), then for each player take the first N abilities they don't own. Offers stay shared except where ownership differs.
- **New IDs** need entries in: `AbilityRegistry.js`, `Abilities.js` timing, `AbilityContracts.js` (browser), the server `simulation/gameconfig/` and `simulation/ecs/contracts/AbilityContracts.java`, both compact ability code tables (`CompactAbilityCode` on the server and the loadout encoding on the browser), and the catalogue. Use `tools/botfight-mcp` scaffolds and its parity report, and follow `docs/ADDING_AN_ABILITY_OR_MOVE.md`.

## 4. Placeholder visuals (Pixi, presentation-only)

Rules:

- Use procedural `Graphics` or reuse existing sprites. No new image assets.
- Drive every effect only from shape state (`abilityActiveMs`, wind-up state). **No `Math.random`**: any jitter derives from ability ID and activation tick, so replays render identically.
- Register each one in `pixi/botAbilityPresentationDefinitions.js` and implement it next to the existing effect types in `pixi/PixiCanvas.jsx`.

| Ability | Effect | Placeholder |
|---|---|---|
| Spear (35) | `spearThrust` | A 4 px metallic shaft (`0xcbd5e1`) from the bot edge, with a 14 px triangular tip. Length extends 0 → 170 over the first 35% of the active time, holds for 30%, then retracts |
| Axe (36) wind-up | `axeWindup` | An amber (`0xf59e0b`) 150° pie outline at radius 105, filling with wind-up progress, alpha 0.25 → 0.6 |
| Axe (36) active | reuse `heavySlash` | Sized by the Axe hitbox (`sizingHitboxAbilityId: 36`), tint `0xfde68a` |
| Daggers (37) | reuse `meleeSwing` frames | Two swings at 0.6 scale, the second 150 ms later and mirrored. Tint `0xe2e8f0` |
| Sniper (3) wind-up | `sniperSight` | A 2 px red (`0xef4444`) aim line to range or the first bot hit, alpha pulsing 0.35–0.8 |
| Sniper (3) fire | reuse `abilityRay` | `rail_shot` frames, height about 40, muzzle flash |
| Shotgun Blast (12) | `shotgunCone` | Muzzle flash plus 7 pellet streaks (1.5 px) spread across 50° to 220 units, with deterministic jitter; a faint cone fill (alpha 0.12), fading over the 200 ms active phase |
| Fireball (5) | existing sprite | Visual size 60, matching the new hitbox |

- **Wind-up telegraphs need wind-up state in replay frames.** Verify the compact replay carries `preparingAbility` and `preparingMs`; if it doesn't, add them in both runtimes.
- Add simple SVG catalogue icons for Spear, Axe and Daggers (`getAbilityCatalogueIcon`). Rename the icons for Sniper and Shotgun Blast.

## 5. Phases and timing

### Cycle per round

| Phase (existing name) | Duration | Clock |
|---|---|---|
| `LOADOUT_SELECT` (pick) | 30 s in round 1, 20 s in rounds 2–6, plus a 2 s hidden grace | Paused |
| Prep (existing, ≤ 2 s) | ≤ 2 s | Paused |
| `BUILDING` | Per-player deadline = build start + that player's remaining clock, plus a 2 s hidden grace. Ends when all players have submitted or expired | **Running** per player until they submit |
| `SIMULATION_LOADING` | Until the simulation finishes | Paused |
| `REPLAY` (`SIMULATION_PREPARING` 3 s + segment frames) | ≤ 30 s, shorter on KO | Paused |
| Result hold | 3 s (`roundReadyAt`) | Paused |

Then the next pick, or `MATCH_RESULT_READY` on KO or after round 6. The `OBJECT_PLACEMENT` phase is unchanged; confirm it can only occur where it does today.

### Clock rules (server-owned)

- `MatchPlayer` gains `clockRemainingMs`, `timeoutFallback` (`CURRENT` or `PREVIOUS`, default `CURRENT`), and the build-phase submitted flag (reuse `finished`).
- At build start: `clockRemainingMs += incrementMs` for every player, and `buildStartedAt` is recorded.
- On an accepted submit: `clockRemainingMs = max(0, clockRemainingMs - (submitAt - buildStartedAt))`. A submit inside the grace period leaves 0.
- On a deadline: if the client sent nothing, create a fallback submission. If the setting is `CURRENT`, the client auto-submits its current brain just before its displayed clock hits zero. The server validates it, and if it's invalid, falls back to the previous round's brain. If the setting is `PREVIOUS`, or nothing valid arrived, use the existing `createBuildingTimeoutSubmission` (previous brain plus the new loadout).
- Round 1 with no previous brain falls back to an empty brain, as today.
- Policy constants go in `MatchTimingPolicy`: base 120 s, increment 20 s, pick 30 s / 20 s, segment 30 s, max rounds 6.
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

  Replace them with a short placeholder describing the new loop, marked `TODO(owner)` for rewriting. Bump `tutorialVersion.js` if completion depends on the content. Tutorial presets that use Basic Strike or old weapons should switch to Slash.
- **Ability catalogue:** a Weapons section, the tier labels "Rounds 1–2", "Rounds 3–4" and "Rounds 5–6", and the renamed Sniper and Shotgun Blast.
- **Docs:**
  - update `AGENTS.md`: the timeout-is-draw rule becomes the HP-decision rule, and the format becomes timed rounds;
  - update `MATCH_TIMING.md`;
  - add the `duel-v2` notes in `docs/ABILITY_EFFECT_CONTRACT.md` if it lists ability numbers;
  - update context maps only if responsibilities moved.

## 8. Order, risks and checks

**Order:**

1. P1 combat content and P3 segmented simulation, in parallel.
2. P2 visuals (after P1).
3. P4 lifecycle (after P3).
4. P5 frontend flow (after P4 and the UI mockups).
5. P6 content surfaces, at any time (puzzle hiding can ship first).

**Main risks:**

- **Brain swap leaking state.** Test that brain *k* never runs on a tick after boundary *k*. Test that segment *k*'s frames are identical whether produced in round *k* or by re-simulating at round 6.
- **Round-transition state leaks.** The existing checklist in `MATCH_TIMING.md` warns about this, and it now spans 6 rounds. Test rounds 2, 3, 5 and 6 explicitly, including pick timeout auto-picks (weapon defaults to Slash; the ability defaults to the first offer).
- **Clock arithmetic at the edges:** a submit during the grace period, a reconnect mid-build, both clocks at 0, a 2v2 where one teammate has expired.
- **Browser/server parity for weapons and the zone.** The zone needs a new `ClosingZoneConfig.timedRoundsV2()`:
  - no zone in round 1 (`startDelayMs` 30,000);
  - 5 contraction phases of 30 s (5 s approach, 25 s hold) with targets 4/5 → 0;
  - damage unchanged;
  - `simulationDurationMs` 180,000.

  Mirror it in the browser's `gameconfig/ArenaHazardConfig.js`.

**Checks:**

- Server: `.\mvnw.cmd test`, with focused suites first (simulation, gameconfig/ecs parity, match lifecycle).
- Frontend: `npm test`, `npm run lint`, `npm run build`.
- Run `docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md` for P1 and P2.

## 9. Sonnet prompts

Each prompt is self-contained. Run them in the order in section 8. Each one ends with "update affected tests" and "don't commit".

### P1: Weapons, ability rework, HP

```
Botfight: implement the weapon/ability changes in
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 3, in BOTH runtimes
(browser frontend/src/gameArena/gameconfig + ecs/contracts + loadout, server
simulation/gameconfig + simulation/ecs/contracts). Follow
docs/ADDING_AN_ABILITY_OR_MOVE.md and use tools/botfight-mcp scaffolds and its
parity report.
- New weapons Spear (35), Axe (36), Daggers (37); retune Slash (1). Add a
  "weapon" category in catalog metadata. Daggers use the existing REPEAT
  schedule (count 2, 150 ms).
- Rework Fireball (5), Gun (3) -> Sniper, Pistol (12) -> Shotgun Blast exactly
  as specified; keep IDs.
- Base HP 150 -> 300 (BASE_BOT_STATS, server default HP and any other
  copies). Remove Basic Strike (34) from the standard/granted set on both
  sides; keep its definition.
- Update tier pools per section 3 (Slash out of tier 1), compact ability codes
  for new IDs on both sides, and catalogue text. Rename "duel-v1" to "duel-v2"
  in both DUEL_RULESET_VERSION constants.
- Existing visuals may fall back for new IDs; dedicated visuals are a later
  task.
Add parity tests for every new or changed ability (damage, hitbox, timings,
multi-hit). Update affected tests. Run server tests and frontend npm test.
Don't commit.
```

### P2: Placeholder visuals

```
Botfight: add placeholder Pixi visuals per
docs/TIMED_ROUNDS_IMPLEMENTATION_PLAN.md section 4 (Spear thrust, Axe wind-up
and swing, Daggers double swing, Sniper sight and shot, Shotgun cone, Fireball
size). Files: frontend/src/gameArena/pixi/botAbilityPresentationDefinitions.js,
PixiCanvas.jsx, pixiVisualState.js, and catalogue icons.
- Presentation-only: no gameplay reads, no Math.random (derive any jitter from
  ability id + activation tick), procedural Graphics or existing sprites only.
- Verify the compact replay carries wind-up state (preparingAbility/
  preparingMs). If not, add it on both runtimes so wind-up telegraphs render
  in replays.
- Run docs/ARENA_VISUAL_AND_COMBAT_REGRESSION_CHECKLIST.md.
Update affected pixi tests. Run npm test, lint, build. Don't commit.
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
  dropped). Nothing else resets.
- Add recordFromMs so the compact recorder keeps only the target segment and
  takes its initial state from the boundary.
- Add ClosingZoneConfig.timedRoundsV2() (plan section 8) with
  simulationDurationMs 180000; mirror it in the browser's
  gameconfig/ArenaHazardConfig.js. Lift the 90 s cap checks accordingly.
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
- MatchTimingPolicy: base clock 120 s, increment 20 s, pick 30 s (round 1) /
  20 s, segment 30 s, max rounds 6. Custom lobbies configure base (30 s-10
  min) and increment (0-60 s) instead of round duration.
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
  marked TODO(owner); switch tutorial presets off Basic Strike and the old
  weapons; bump tutorialVersion.js if needed.
- Ability catalogue: a Weapons section, tier labels by round pair, and the
  renamed abilities.
- Update AGENTS.md product constraints (HP decision instead of
  timeout-is-draw; timed-rounds format).
Update affected tests. Don't commit.
```

## 10. Owner decisions still open

- The final numbers after playtesting: weapon damage, HP, clock, zone, and segment length.
- Heavy Slash versus Axe overlap.
- Whether to add AFK auto-submit (the clock already bounds waiting).
- Whether teammates in 2v2 can see each other's brains read-only during the build.
- The tutorial rewrite (owner-written).
