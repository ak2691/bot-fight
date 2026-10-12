# Ability engine DRY audit

2026-10-10. This is a review of `shared/engine/` (effects, statuses, verbs, entities,
contracts) and the gameplay data. Its rule: where two things do the same job, make them one
thing with a key or field, not two functions, types or modules. Nothing here is built yet.
It goes with [`ABILITY_ROSTER.md`](ABILITY_ROSTER.md), whose building blocks should land on
top of this cleanup, not beside it.

What is **not** a duplicate, and should stay separate:
- **Verbs and effects.** A verb decides who and where; an effect changes one target.
- **Entities and statuses.** An entity lives in the world; a status lives on a bot.
  They should share an event model (S6), not merge.
- **Channels.** Several actions in one tick is real behavior.

## Findings

Effort: S is under a day, M is one to three days, L is more. "Planned" means a roster
building block depends on it.

### Statuses: one idea, many shapes

| # | Duplication today | Where | Make it one thing | Effort |
| --- | --- | --- | --- | --- |
| S1 | Code asks for status **names** ("stun", "silence", "slow", "movement-lock", "absolute-guard", "reactive-armor", "hit-stagger", "overclock") instead of what the status **does**. A new status that stuns would not stun. `channels.json` also blocks by name | `ActionExecutionSystem`, `HitStagger`, `DefensiveState`, `AbilityResourceSystem`, `AbilityEntitySystem`, `chainRuntime`, `channels.json` | Ask "does any active status apply `stun`?" (the effect inside the status). Blocking becomes one `block` effect with an `actions` list (`ability`, `dash`, `move`, `sprint`, `fastTurn`): silence is `block [ability]`, slow is a movement modifier plus `block [dash, sprint]`, and movement lock is `block [move, sprint]`. `stun` stays its own effect (it stops everything). `channels.json` drops `blockedByStatuses`, because the status says what it blocks. A new status is then only a preset | M, planned |
| S2 | Five statuses are built in code, not in `statuses.json`: hit-stagger, movement-lock, reactive-armor, absolute-guard, overclock. An entity's movement lock is even rebuilt as a stun | `effects.js`, `BotStatusSystem`, `AbilityEntitySystem` | Every status is a preset | S |
| S3 | Four effect types exist only to put a status on the owner: `damage_reduction`, `damage_reflection`, `damage_immunity`, `buff` (only `"overclock"`) | `effects.js` registry | The normal `status` effect with `targets: ["OWNER"]` and a preset. Remove the four types | S, planned |
| S4 | Modifiers come in five shapes, each with its own stacking rule:<br>• `incoming_damage_modifier` (`damageModifier`, added; or `multiplier`, the old form; or `amount`, inverted, on the effect);<br>• `movement_modifier` (`movementMultiplier` and `rotationMultiplier`; "slow wins, else stagger" is hard-coded by name);<br>• `cooldown_modifier` (`multiplier`);<br>• the planned `stamina_cost_modifier`;<br>• Overcharge's outgoing damage | `StatusContracts`, `HitStagger`, `AbilityResourceSystem` | **One `modifier` application:** `{ "type": "modifier", "stat": "incomingDamage" \| "outgoingDamage" \| "moveSpeed" \| "turnSpeed" \| "cooldown" \| "staminaCost", "multiply": 0.5 }`. One reader takes a stat name and combines every active modifier. The stacking rule is a small per-stat table: damage multiplies, movement takes the strongest (which keeps today's slow vs stagger) | M, planned |
| S5 | Status ticking is written twice, once for bots and once for entities, with different results: a movement lock on an entity becomes a stun | `BotStatusSystem.tickBotStatus`, `AbilityEntitySystem.tickEntityStatuses` | One ticker for any shape. The mutators already treat bots and entities alike | M |
| S6 | Tick effects (damage, movement lock) have their own hard-coded `applyTickEffect` instead of going through the effect registry | `BotStatusSystem` | A status `schedule` event (the entities' timer event, with `intervalMs`) whose effects run through `applyEffect`. Burn, bleed and shock become data. This is the roster's status-events block, with the **same event names as entities**: `schedule`, `lifetimeEnd`, `hit`, plus `hitDealt` | M, planned |
| S7 | `interrupt` is an effect type that equals "cancel the ability, plus a short stun". Every use in data is a 100–250 ms stun | `effects.js`, `AbilityEntitySystem` (`"interrupt"` status) | A stun preset flag, `interrupts: true`, so a stun of any length interrupts. Remove the effect type and the `"interrupt"` status check, which nothing creates (dead code) | S |
| S8 | Rewind has its own system: deferred-state contracts, a runner, seven `temporalRewind*` bot fields, and resets in `withoutBotStatuses` | `DeferredStateContracts`, `DeferredStateSystem`, `effects.js` `restore_state` | A status that captures a snapshot, plus a `lifetimeEnd` event that restores it. Delete both modules and the fields | M |
| S9 | Reflection reads the status named `"reactive-armor"` inside `dealDamage` | `effects.js` | A `hitTaken` reaction (roster section 3b). Goes away entirely if Reactive Armor is cut | S, planned |
| S10 | "A slow that expired this tick still blocks Dash" is special-cased for slow only | `ActionExecutionSystem` | Channel blocking reads the effect types that were active at the start of the tick, for every blocking status | S |

### Effects

| # | Duplication today | Make it one thing | Effort |
| --- | --- | --- | --- |
| E1 | `knockback` and `pull` are the same move in opposite directions. Their options sit on the **verb** (`knockbackDirection`, `pullDirection`), not the effect | One `displace` effect: `{ "direction": "away" \| "toward", "from": "source" \| "owner" \| "velocity", "amount" }`. Wall-slam later hangs off this one effect | S |
| E2 | Four loops apply an effect list, each building its own context and tracking hits: self effects (`applyEffectsVerb`), bot hit to bot (`hitOneDefender`), entity to bot (`applyEffectsFromEntity`), any source to entity (`applyEffectsToEntity`) | One `applyEffectList(effects, ctx)` that also records the landed hit and confirmed damage. Conditions (`when`) then live in one place | M, planned |
| E3 | `teleportOncePerActivation` is an activation flag just for Phase Strike | Put the teleport in its own `hit` verb with `nearestOnly: true`. The flag and its branch go | S |
| E4 | Healing's `requiresConfirmedDamage` is a one-off condition | `when: [{ measure: "damageDealt", op: ">", value: 0 }]` once conditions exist. `mirrorsDamage` stays as an amount source and is shared with reflection | S, after conditions |

### Hits and targeting

| # | Duplication today | Make it one thing | Effort |
| --- | --- | --- | --- |
| H1 | The `hit` verb has two implementations. From a bot: `hitVerb` and `hitOneDefender`, with `oncePerTarget`, `nearestOnly` and teleport. From an entity: `hitFromEntity`, with `aim` and its own ray rule ("thin line", where a bot's ray has a width). Options in one don't exist in the other | One hit verb that fires from a **source pose** (bot or entity), with every option available to both and one ray rule | M |
| H2 | Bot attacks on objects are resolved somewhere else. The entity stage re-reads the bot's `triggeredAbility` and re-tests **all** its hit verbs (`applyIncomingEntityEffects`). **Likely bug:** this ignores the trigger timeline. A 3-step combo applies every step to an object on the trigger tick, and nothing on later steps. Confirm with a test | The hit verb queries bots and objects together through `findTargets`, which ABILITIES.md already claims happens | M |
| H3 | Six copies of "are these two on opposing teams?": `isHostileDamageSource`, `opposingBots`, `areOpposingTeams`, `isEnemyOf`, `entityOwnersAreHostile`, `isEnemy` | One `areEnemies(a, b, bots)` | S |
| H4 | Six number resolvers (`resolveNumber`, `resolvePhaseNumber`, two `phaseStat`, `resolveStatValue`, `resolveValue` and `resolveStat`). Between them they accept forms the data never uses (stat-name strings, `{stat}`, `{value}`, `statOverrides`) | One resolver for the forms the data actually uses (`context` / `ownerStat` + `fallback`, `add`). The validator rejects the rest | S |
| H5 | Two stat projections are derived from the same data: `Abilities.js` `ABILITY_STATS` and `effects.js` `phaseStatsFor`, `entityEffectStats` and `buildAbilityStats`. Runtime timing reads the projection, not the data | The runtime reads the data. One projection is kept for presentation only | M |

### Data and catalogue

| # | Duplication today | Make it one thing | Effort |
| --- | --- | --- | --- |
| D1 | Tiers and weapons are defined twice: `round` and `category` in `BotLoadout.js`, and `TIER_ABILITIES` and `WEAPON_IDS` in `MatchLoadoutService.java` | `tier` (1–3) or `weapon: true` in `abilities.json`, which Spring already reads for codes. **Do this before the roster changes**, or every roster edit needs two edits | S |
| D2 | Catalogue text repeats numbers ("8 damage over a 120° arc", Dash "150-unit"), which drift: the Dash text has been wrong before | Summaries carry no numbers; the stats panel shows the data. Or generate the numbers from data | S |
| D3 | `gameplayValidation.js` keeps its own vocabulary lists, which already drift from `EFFECT_TYPES`, `VERBS` and `STATUS_EFFECT_APPLICATIONS` (its `statusEffectType` list is missing reflection and immunity) | The validator imports the contract enums | S |
| D4 | `activationActiveMs` chooses "no active time" by **effect type** (reduction, immunity, reflection, overclock) | `timing.activeMs: 0` in the data | S |

### Looked at and left alone, for now

- **The trap `trigger` and `collision` events.** A trigger is close to a collision with
  its own radius plus `chain`, `attackHits` and `projectileOverlap`. Merging is possible,
  but the trap rules are subtle. Revisit after H1–H2.
- **Dash's `move` verb, `displace`, teleport and Rewind's restore.** They all set a position.
  Sharing one "place at" mutator (clamp plus a velocity reset) is a small tidy-up during
  E1 and S8, not a merge of the features.

## What changes in the plan

With these merged, the roster's building blocks get smaller:

- **Status events:** a status gets the entities' events under the same names (`schedule`,
  `lifetimeEnd`, `hit`, plus `hitDealt`). It's not a second event system. Burn, bleed,
  shock (S6) and Rewind (S8) become ordinary data, which proves the system before Parry
  uses it.
- **Damage pipeline:** its "outgoing" and "incoming" stages are just the `modifier` reader
  for `outgoingDamage` and `incomingDamage` (S4). Only `cancel` (Parry), the HP floor (Last
  Stand) and the after-hit reactions are new.
- **Overdrive and Overcharge** need no new application type. They're
  `modifier { stat: "staminaCost", multiply: 0 }` and a `hitDealt` handler with
  `modify` (or a charge-limited `outgoingDamage` modifier).
- **Conditions (`when`)** are checked in one place, the shared effect-list applier (E2),
  so every verb and event gets them for free.
- **Stacking:** modifiers now **multiply**, not add. Today only Bleed modifies incoming
  damage, and Reactive Armor is being cut, so no golden changes. Per-stat rules keep
  movement as "strongest only".

**Vocabulary after the cleanup:**
- **Effect types** go from 12 to 7: `damage`, `healing`, `displace`, `status`,
  `teleport`, `removeStatus`, and the planned `cooldown`.
- **Status applications** go from 9 to 4: `modifier`, `block`, `stun` (`interrupts`), and
  `damage` (tick, until S6 moves it into events).
- **Code modules removed:** `DeferredStateContracts`, `DeferredStateSystem`, `HitStagger`'s
  name branches, `DefensiveState`'s guard check, and the duplicate status ticker.

## Order

These replace step 1 of the roster's order of work. Each step should leave the goldens
unchanged unless it says otherwise.

1. **D1, D3, D4, H3, H4.** Pure deduplication with no behavior change. A good first
   Sonnet run.
2. **S2, S3, S7, S1, S10.** Every status becomes a preset, and code asks what a status
   does. Slow also blocks sprint here, which is an intended golden change.
3. **S4.** The single `modifier` application and its reader.
4. **E2, then H1 and H2.** One effect applier, one hit verb, bots and objects together.
   Add the timeline-vs-object test first; the bug fix may change goldens.
5. **S5 and S6, then S8 and S9.** One status ticker, then status events, used first by burn
   and bleed, then Rewind. After that the roster's Parry and Overcharge work starts.
6. **E1, E3, E4.** As their abilities come up.
7. **D2.** With the roster's text pass.
