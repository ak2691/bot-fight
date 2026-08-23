# Ability Effect Contract

Each selectable ability has one mirrored browser/server contract:

```text
delivery          how effects reach a target
effects[]         ordered game-state changes
shieldInteraction which effects a shield prevents and at what cost
execution         activation-time payload behavior and captured inputs
```

Browser contracts: `frontend/src/gameArena/gameconfig/AbilityContracts.js`. Browser direct-effect execution: `frontend/src/gameArena/ecs/abilities/AbilityEffectSystem.js`. Server: `server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityContracts.java`. Authoritative numeric tuning lives in `gameconfig/Abilities.java`; values calculated during execution are marked `runtimeComputed` server-side.

## Delivery

Current types: `self`, `melee`, `ray`, `projectile`, `radial`, `zone`, `trap`, and `summon`. Delivery owns travel, collision, and target timing. It does not imply damage or interpolation. Gravity Grenade is a projectile that creates a zone; the catalogue exposes both tags. Phase Strike uses `melee` delivery with a 100-unit range and a 90-degree facing arc; its teleport is an ordered effect.

For melee bot hit checks, range is measured from the attacker center to the defender center plus half the defender's size, so a defender's edge can reach the attack range. Phase Strike preserves its original 100-unit center-to-center range while adding its 90-degree facing arc. The browser preview and authoritative server must use the same range and facing arc.

For radial blasts and persistent zones, effect range is measured from the effect center to the bot center. A bot's outer edge does not extend the blast radius; this keeps shield bearing and damage decisions anchored to the same center point. Phase Strike uses the melee edge-inclusive range rule.

Damage falloff uses a linear profile rather than a table of range bands. A profile declares `maxDamage`, `minDamage`, `damageFalloffStart`, `damageFalloffEnd`, and the overall `range` or `radius`. Damage stays at the maximum through the start distance, interpolates mathematically to the minimum at the end distance, then stays at the minimum until the hit range ends. Browser and server execution round the same calculated value.

Spawning is an effect (`spawn_entity`). Target labels and capabilities remain in `BotLoadout.js` as schema/UI metadata.

## Effects

- HP: `damage`, `healing`.
- Displacement: `knockback`, `pull`, `movement`, `teleport`, `restore_state`.
- Status: `debuff`, `buff`. A timed modifier that changes a bot's stats or
  functionality is applied as a bot-local status and owns its remaining time
  and expiry through the status contracts. Overclock is the current example:
  its `buff` subtype is `overclock`; its 0.5 cooldown-start multiplier is read
  only when a new ability cooldown or charge reload timer is created, so timers
  already running when Overclock activates remain unchanged. The multiplier is
  cleared when the status expires.
  The browser catalogue marks these effects with `ABILITY_TAGS.STATUS_EFFECT`
  (`"status-effect"`). There is no separate positive `"buff"` catalogue tag;
  `self` remains independent, so `self` plus `status-effect` identifies a
  positive self-applied status in the current catalogue.
- Immediate control: `interrupt`.
- Legacy defensive modifiers: `damage_reduction`, `damage_immunity`,
  `damage_reflection`. These carry their numeric strength in the contract and
  are applied as timed positive statuses by the generic runtime. Reactive Armor
  owns `reactive-armor` status time; Absolute Guard owns `absolute-guard`
  status time. Neither effect duration is an ability action lock. Self-applied
  positive effects also receive the `self` catalogue tag.
- World state: `spawn_entity`.

Apply effects in declared order. Add a new effect class only for reusable behavior that existing classes cannot express. Generic executors switch on effect class/subtype, not ability ID.

## Generic runtime architecture

New abilities must extend the declarative contracts and generic systems. Do not
add a new ability-specific tick branch when an existing contract type already
describes the behavior.

| Behavior | Contract shape | Browser owner | Server owner |
| --- | --- | --- | --- |
| Ability definition and ordered effects | ability/delivery/effect/shield/execution contract | `gameconfig/AbilityContracts.js` and `Abilities.js` | `simulation/gameconfig/AbilityContracts.java` and `Abilities.java` |
| Persistent, targetable, moving, or delayed world object | entity type, components, lifecycle, interaction | `ecs/contracts/EntityContracts.js`, `ecs/entities/EntityFactory.js`, `ecs/abilities/AbilityEntitySystem.js` | `simulation/ecs/contracts/EntityContracts.java`, `simulation/ecs/entities/AbilityEntityFactory.java`, `simulation/ecs/abilities/AbilityEntitySystem.java` |
| Effect applied to a bot over time | generic status record, clock, source, tick, expiry | `ecs/contracts/StatusContracts.js` and `ecs/bots/BotStatusSystem.js` | `StatusEffectState.java` and `BotStateService.java` |
| Cooldown, charge, or active resource timing | resource map and recharge contract | `ecs/bots/BotResourceSystem.js` | `BotStateService.java` resource handling |
| Match/transient cleanup and presentation timers | lifecycle component contract | `ecs/bots/BotLifecycleSystem.js` | bot-state tick lifecycle |
| Captured bot state resolved later | deferred remaining field, completion, optional completion visual | `ecs/contracts/DeferredStateContracts.js` and `ecs/bots/DeferredStateSystem.js` | `simulation/core/state/DeferredStateSystem.java` |

### Ability timing phases

`activeMs` is the post-activation action lock phase. `cooldownMs` is the
recovery timer that follows it; the two timers are sequential, not parallel.
While active time is positive, the public cooldown value is zero and the
reserved recovery is held in the internal pending-cooldown state. When active
time reaches zero, the pending value becomes the cooldown value. If the active
phase ends partway through a fixed step, only the unused part of that step can
consume cooldown. Charge reload/recharge timers follow the same active-first
rule. For a charged ability these gates are mutually exclusive: if charges
remain, only the between-charge cooldown is armed; after the final charge,
only the reload/recharge timer is armed.

Bot conditionals therefore have distinct phase meanings: ready means no
preparation, active, cooldown, or resource lock; active means active time is
positive; on cooldown means active and preparation are both finished while a
cooldown/reload remains; and preparation exposes its remaining wind-up while
active time remains zero.

For entity-backed abilities, this action lock is independent of the entity's
existence. The entity contract's duration/lifetime field controls how long the
spawned entity remains in the arena, so a bot can begin another ability after
`activeMs` expires while its summon, trap, or zone continues operating.

There is one global ability lock per bot. It is derived from the bot's action
state rather than stored as one independent boolean: the lock is held while
`preparingAbility` is set or while any `abilityActiveMs` entry is positive. A
different non-exempt ability cannot begin while that lock is held; the ability
already winding up continues its preparation, and ordinary movement/rotation
remain available. Dash is the declarative exception through
`ignoresGlobalAbilityLock`: Dash can begin while another ability is active, and
an active or preparing Dash does not block another ability. Channelled abilities
may continue their own active phase.

The current duel-v1 ability set has no blocking ability or shield-absorption
resource. The generic `abilityCharges` map remains available for ammunition
and other explicitly contracted resources.

### Entity lifecycles, phases, and intervals

`durationMs` is the complete lifecycle of an ability-created entity. Its clock
starts when the entity is spawned, regardless of whether the entity is still
travelling, fused, armed, active, or waiting to expire. Projectile range is a
derived tuning value: fixed-step displacement multiplied by the entity
duration. It is never an alternate removal timer.

Distinct entity behavior belongs in generic declarative phases. A phase has an
ID, a `startMs` offset from spawn, and the actions that apply while entering or
remaining in that phase:

```js
behavior: {
    kind: "phase",
    phases: [
        { id: "travel", startMs: 0, movement: { mode: "travel" } },
        {
            id: "armed",
            startMs: 800,
            movement: { mode: "stopped" },
            trigger: { radiusStat: "radius", botContact: true },
            effectTypes: ["damage"],
            explosion: { type: "mineExplosion" },
        },
    ],
}
```

The proximity mine therefore has one `durationMs` of 20,800 ms. It travels for
the first 800 ms, then enters its stopped armed phase. Only the armed phase
has a trigger and damage action; the mine does not switch to a second lifetime
clock. Gravity and Singularity use the same phase contract for travel, pull,
and damage/detonation behavior. Phase explosions are entry actions and occur
once when the phase starts.

For one action that repeats at a fixed cadence, use `kind: "interval"` and an
`intervalStat`. Orbital Strike is an interval entity: each interval applies its
declared hit/effect contract and may create its presentation event. This is
the generic replacement for a named `pulsedZone` behavior.

Classify the behavior before implementing it:

- A cast windup or readiness delay belongs to ability preparation/resources.
- A delayed projectile, zone, trap, summon, or explosion belongs to an
  ability entity and its generic entity lifecycle.
- A continuing effect applied to a bot belongs to the status contracts.
- A future bot mutation that depends on a snapshot captured at activation time
  belongs to deferred state handling. Temporal Rewind is the current example.

Deferred state handling is not a general replacement for delayed abilities. It
is specifically for snapshot-based future transitions. New completion behavior
must be represented by an allowlisted completion contract; do not execute
arbitrary callbacks or user-provided expressions.

### Generic status records

Every continuing bot status is represented by one generic record in
`statusEffects[]`:

```text
{
  type,
  mode: "duration" | "presence",
  remainingMs,
  tickMs?,
  tickElapsedMs?,
  sourceSlot?,
  abilityId?,
  effects: [{ type, mode: "constant" | "tick", ... }]
}
```

Status timing belongs to the ability that starts the status, not to a global
effect template. The mirrored catalogs use nested metadata such as:

```js
statuses: {
    burn: { durationMs: 5000, intervalMs: 1000 },
    slow: { durationMs: 2000 },
}
```

The ability contract resolves that metadata into the status instance's
`remainingMs` and `tickMs`; the instance also records its source `abilityId`.

Timed statuses use `remainingMs`; presence statuses use `mode: "presence"`
for as long as their owning zone or entity is active. Tick-based statuses also
declare `intervalMs`, and only effects with `mode: "tick"` run on those interval
boundaries. Constant effects apply for the status lifetime. There are no
effect-specific lifetime fields such as `burnRemainingMs` and no status-level
cooldown field such as `cooldownRecoveryMs`.

The shared allowlisted status component types are `damage`,
`movement_modifier`, `incoming_damage_modifier`, `damage_reflection`,
`damage_immunity`, `stun`, `silence`, `movement_lock`, and
`cooldown_modifier`. For example, Burn is a status with
`remainingMs`, `tickMs`, and a tick `damage` effect; Overclock is a status with
`remainingMs` and a constant `cooldown_modifier` effect. Ability cooldowns and
charge reloads remain in the separate `abilityCooldowns` and
`abilityRechargeMs` resource maps. The browser vocabulary is exported as
`STATUS_EFFECT_APPLICATIONS` in `StatusContracts.js`.

## Universal successful-damage consequence

After an impact resolves its reduction, immunity, and reflection rules, the
shared combat damage settlement path compares the target bot's HP before
and after resolution. If hostile damage reduces that HP by more than zero, the
target receives universal hit stagger for 300 ms. The mirrored constants are
`HIT_STAGGER_DURATION_MS = 300`, `HIT_STAGGER_MOVEMENT_MULTIPLIER = 0.85`, and
`HIT_STAGGER_ROTATION_MULTIPLIER = 0.85` in the browser and authoritative Java
combat runtimes.

The timer is bot state, not a selectable logic status and not an authored
ability effect. It refreshes with `max(current, 300)` and never stacks. Damage
from a bot, that bot's entities, or attributed damage-over-time statuses
is hostile when it crosses bot slots; immune or zero damage is not. Reflected
damage uses the reflecting defender as its source, so a reflection that removes
the original attacker's HP can stagger that attacker.
Damage to arena entities never creates bot hit stagger.

Hit stagger and slow/Concussive keep independent timers. Movement uses the
stronger active multiplier: normal `1.00`, hit stagger `0.85`, slow `0.50`, and
both `0.50`. Hit stagger also multiplies the normal rotation step by `0.85`;
slow/Concussive multiplies the normal rotation step by `0.50`.

## Shields

`shieldInteraction` remains an explicit extension point for future defensive
abilities. Every active duel-v1 ability currently uses `ignore`, with no
prevented effects and no damage absorption or displacement filtering.

## Presentation boundary

Visuals may read contract/state metadata but never determine hits or mutate gameplay. Testing and replay share presentation; Java remains authoritative.

## Change checklist

1. Mirror numeric definitions and contract metadata.
2. Add loadout/target metadata only when required.
3. Connect generic delivery/effect execution.
4. Classify timers and delayed behavior into preparation, entity lifecycle,
   status, resource, lifecycle, or deferred-state ownership.
5. Add the visual separately.
6. Test browser/server metadata parity, defensive-interaction metadata, and
   real execution.
