# Modifying Abilities

This is the practical guide for tuning existing abilities and extending their
gameplay behavior.

For a concise, copy-paste prompt describing a new ability, see
[Requesting a New Ability](REQUESTING_NEW_ABILITIES.md).

Machiner has two gameplay runtimes:

- The browser arena is the practice-room preview.
- The Spring server is authoritative for rated matches.

Every gameplay change must be mirrored in both runtimes. Changing only the
browser makes the practice room look right while rated matches still use the
old behavior. Changing only the server makes the practice room misleading.

The stable ability ID is the key used everywhere. The name and label mapping is
in frontend/src/gameArena/gameconfig/AbilityRegistry.js and
server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityRegistry.java.
Never renumber an existing ability or reuse a retired ID.

## The short version

For a simple change:

1. Find the ability ID in AbilityRegistry.js.
2. If it changes damage, healing, range, radius, hitbox, speed, movement,
   visual state, or an effect, change the owning phase in the browser contract:
   `AbilityContracts.js` for both direct and entity-backed abilities.
3. Mirror the same phase change in the matching server contract.
4. Change `Abilities.js`/`Abilities.java` only for ability-level timing,
   resources, identity, or a still-supported compatibility consumer.
5. Run the focused tests, then the full frontend and server suites.

Use milliseconds for time values:

| Desired time | Number |
| --- | ---: |
| 0.1 seconds | 100 |
| 0.3 seconds | 300 |
| 0.5 seconds | 500 |
| 1 second | 1000 |
| 2 seconds | 2000 |
| 5 seconds | 5000 |
| 10 seconds | 10000 |

Gameplay distances, sizes, knockback, pull, and speed use arena units or
fixed-step units. They are not milliseconds.

## Where each kind of change lives

| What you want to change | Browser | Authoritative server |
| --- | --- | --- |
| Cooldown, windup, active/duration timing, charges, reload | gameconfig/Abilities.js | simulation/gameconfig/Abilities.java |
| Phase ownership, hitboxes, movement, visuals, and ordered effects | ecs/contracts/AbilityContracts.js | simulation/ecs/contracts/AbilityContracts.java |
| Status behavior and allowed status components | ecs/contracts/StatusContracts.js, ecs/bots/BotStatusSystem.js | StatusEffectState.java, BotStateService.java |
| Projectile, trap, zone, or summon lifecycle | ecs/contracts/AbilityContracts.js, ecs/entities/EntityFactory.js, ecs/abilities/AbilityEntitySystem.js | simulation/ecs/contracts/AbilityContracts.java, AbilityEntityFactory.java, AbilityEntitySystem.java |
| Ability readiness, charges, and resource timers | ecs/bots/BotResourceSystem.js | BotStateService.java |
| Catalogue name, label, tags, draft metadata | loadout/BotLoadout.js, AbilityRegistry.js | AbilityRegistry.java, loadout/config validation |
| Icons, animations, flashes, and other presentation | pixi/, visual-state helpers | replay/presentation metadata only; never gameplay authority |

The two most important authoring locations are the timing/resource catalog and
the phase contract:

- Browser timing/resource catalog: frontend/src/gameArena/gameconfig/Abilities.js
- Browser direct and entity phases: frontend/src/gameArena/ecs/contracts/AbilityContracts.js
- Server timing/resource catalog: server/src/main/java/com/example/botfight/simulation/gameconfig/Abilities.java
- Server direct and entity phases: server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java

## 1. Modify an ability stat

The timing/resource catalog is a numeric-keyed object. For example, Gun is
ability 3:

~~~js
3: {
    maxCharges: 6,
    reloadMs: 5000,
    cooldownMs: 1000,
    activeMs: 500,
},
~~~

Gun's phase owns the behavior values:

~~~js
3: {
    activation: {
        capture: { gunRayOriginX: "x", gunRayOriginY: "y", gunRayRotation: "rotation" },
    },
    phases: [{
        id: "active",
        type: "botAttached",
        hitbox: { shape: "ray", range: 700, width: 5 },
        effects: [{
            type: "damage",
            falloff: { maxAmount: 15, minAmount: 5, falloffStart: 100, falloffEnd: 700 },
        }],
        events: { collision: { actions: ["applyEffects"], effectTypes: ["damage"] } },
    }],
},
~~~

Common browser fields:

| Field | Meaning |
| --- | --- |
| cooldownMs | Recovery between uses. It begins after the active phase. |
| windupMs | Preparation time before activation. |
| activeMs | Post-activation action lock/recovery phase. |
| durationMs | Duration phase for a continuing effect or entity, when that ability uses this field. For a moving entity, motion is active during this phase. |
| maxCharges | Maximum ammunition/charges in the browser catalog. |
| reloadMs | Time to reload after a charged ability is empty. |
| damage, healing, falloff | Phase-owned effect payloads in the direct or entity phase contract. Do not duplicate them in the timing catalog. |
| range, radius, hitboxWidth, hitboxLength, arc | Phase-owned hitbox geometry. A projectile's physical length is independent of travel/display range. |
| knockback, pullPerTick | Phase-owned displacement effect values. |
| speed | Numeric movement speed on the active entity phase. Use `0` for a stopped phase. |
| visualSize, phase.visual | Presentation metadata on the phase that is visible at that moment. It does not affect collision, damage, range, or authority. |
| phases | Declarative direct/entity phases with `id`, `type`, numeric movement, hitbox, event handlers, effects, target policies, and optional visuals. Use phases whenever behavior changes during the lifecycle. |
| intervalMs | Cadence for a generic `interval` entity action. Orbital Strike uses this for repeated hits. |
| visibleMs | Presentation timing for the current phase or transient phase event visual. It does not affect gameplay lifetime unless the phase explicitly uses it as its duration. |
| visualMs | Direct-ability cast visual timing. Persistent entity visuals should use `phase.visual.visibleMs`. |

The server mirrors the same timing/resource concepts. Its positional
`AbilityDefinition` remains a public compatibility projection, derived from
the timing catalog and phase contracts; do not add authored phase-dependent
values there. New behavior belongs in the phase contracts above:

~~~java
new AbilityDefinition(
        cooldownMs,
        windupMs,
        activeMs,
        durationMs,
        damage,
        range,
        arc,
        charges,
        rechargeMs,
        reuseCooldownMs,
        resourceModel,
        falloffMode,
        falloff,
        damageOverTime,
        stats)
~~~

The browser names reloadMs and maxCharges; the server names those fields
rechargeMs and charges. Keep the values equivalent.

### Timing is sequential

activeMs and cooldownMs are not parallel timers. The active phase is consumed
first, and the cooldown phase follows it. For example:

~~~text
windup:   300 ms before activation
active:   500 ms after activation
cooldown: 1000 ms after active time ends
~~~

For an entity-backed ability, the bot's active phase and the entity's lifetime
are separate. A mine, zone, or summon can remain in the arena after the bot is
ready to use another ability.

An interrupt effect cancels preparation before activation or stops the bot-owned
active phase, then starts the normal cooldown/reload gate. It must not remove an
already-spawned projectile, trap, zone, or summon; those continue under their
entity contract.

### Generic distance falloff

Use a linear profile when an effect's amount or duration changes with distance.
For a damage effect, the phase effect uses the generic `falloff` object:

~~~js
effect(EFFECT_TYPES.DAMAGE, {
    falloff: {
        maxAmount: 40,
        minAmount: 25,
        falloffStart: 0,
        falloffEnd: 64,
    },
}),
// The phase hitbox carries the effective range.
hitbox: { shape: "circle", radius: 70 },
~~~

For a duration-dependent status effect, keep the amount fixed and use the
duration fields in the same profile:

~~~js
effect(EFFECT_TYPES.STATUS, {
    subtype: "slow",
    durationMs: 2_000,
    falloff: {
        maxDurationMs: 2_000,
        minDurationMs: 750,
        falloffStart: 0,
        falloffEnd: 500,
    },
}),
~~~

The server phase and effect overrides use the same generic `Falloff` fields.
The browser and server must have the same maximum, minimum,
start distance, end distance, effective range, and rounding behavior.

For a generic amount override, use the same object on the effect instance:

~~~java
new AbilityContracts.Falloff(25.0, 40.0, null, null, 0.0, 64.0)
~~~

## 2. Add, remove, or reorder an effect

`Abilities.js`/`Abilities.java` contain ability-level timing and resource
metadata. Contracts describe what happens during activation and each phase.
The phase is the source of truth for authored damage, geometry, movement,
visuals, and effects. A direct ability's attached contract contains:

~~~text
activation -> optional activation-time targeting/capture behavior
phases[] -> ordered phase-owned geometry, movement, visuals, events, and effects
~~~

### Existing effect types

| Effect | What it does | Typical values |
| --- | --- | --- |
| damage | Removes HP. | amount, or runtime-computed falloff |
| healing | Restores HP. | amount, recipient, requiresConfirmedDamage, mirrorsDamage |
| knockback | Pushes a target away. | amount |
| pull | Pulls a target toward a point. | amount |
| phase movement | Moves the current phase's source/entity. | numeric speed, optional distance/trail/blocked status |
| teleport | Moves a target instantly. | fixed distance or `distanceMode: center_distance` |
| restore_state | Restores a captured state after a delay. | delay/completion metadata |
| status | Applies a timed or presence status. Each subtype is a separate effect object, so one phase may apply several statuses. | subtype, duration, optional duration falloff |
| buff | Applies a positive timed or presence status. | subtype, duration, strength |
| interrupt | Cancels preparation without activation or stops a bot-owned active phase, then starts cooldown/reload. | duration when needed |
| damage_reduction | Reduces incoming damage while active. | amount, converted to a negative additive modifier at runtime; duration |
| damage_immunity | Prevents damage while active. | duration |
| damage_reflection | Reflects damage under the declared defensive rules. | multiplier/amount, duration |
| entity contract | Creates and advances a projectile, trap, zone, or summon when the ability ID has an entry in `AbilityContracts`. | root lifetime/spawn metadata and phase-owned behavior |

Effects are applied in the order listed. Reordering effects can change gameplay
if an effect depends on a confirmed hit or changes the target's state.

### Adding an already-supported effect

Suppose ability 30 should also knock the target backward by 100 units. Put the
complete gameplay payload on its active phase. The compact helpers below write
the effect list into that phase; they do not create a second parent-level
effect list:

~~~js
30: {
    phases: [{
        id: "active",
        type: "botAttached",
        hitbox: { shape: "ray", range: 600, width: 8 },
        effects: [
            { type: "damage", amount: 15 },
            { type: "knockback", amount: 100 },
            { type: "interrupt", durationMs: 250 },
            { type: "status", subtype: "slow", durationMs: 2_000 },
        ],
        events: { collision: { actions: ["applyEffects"], effectTypes: ["damage", "knockback", "interrupt", "status"] } },
    }],
},
~~~

The server mirrors the same phase payload:

~~~java
entry(30, collisionPhase(30, directHitbox(30, false),
        List.of(effect(EffectType.DAMAGE, 15),
                effect(EffectType.KNOCKBACK, 100),
                timed(EffectType.INTERRUPT, 250),
                status("slow", 0, 2_000)),
        directVisual(30)),
~~~

This works without new ECS code because knockback is already a generic effect.
For a new effect type that the generic runtime does not understand, see
Adding a new effect type.

### Effect values belong to the phase

Put the concrete value on the phase so the hitbox, movement, visual, and
effects can be read together:

~~~js
effect(EFFECT_TYPES.KNOCKBACK, { amount: 100 })
~~~

Use a runtime-computed value only when it genuinely depends on the current
source/target state. If a value is authored, mirror the literal in the browser
and server phase contracts instead of creating a second phase-incomplete stat
catalog.

## 3. Change phase ownership and targeting

There is no separate delivery label. The phase owns travel, collision geometry,
event timing, and effects. Use an attached `botAttached` phase for an ability
that stays on its caster. Use an `AbilityContracts` root when the activation
creates a projectile, trap, zone, or summon.

| Contract choice | Use for |
| --- | --- |
| attached phase with an `activation` event | Effects applied to the caster, such as healing or a self-buff. |
| attached phase with a `collision` event | Immediate hostile geometry, such as an arc, rectangle, circle, or ray. |
| entity root with `projectile`/`zone`/`trap`/`summon` phases | A persistent, moving, targetable, or delayed world object. |

Changing phase ownership or event timing can change collision timing, target
timing, and whether an entity is needed. Mirror the browser and server phase
contracts exactly.

An activation-only ability such as Lock On remains an attached phase with its
targeting metadata and presentation; it should not become a hostile
mine/projectile entity just because it is active on another bot.

Targeting metadata lives in the contract's `activation` record. Existing
options include target selection, facing captured at activation, phase-facing
defaults, one-time effects within a multi-target activation, and whether an
ability can ignore the global ability lock. Phase movement belongs on the phase
itself. Change activation metadata only when you intend to change activation
semantics.

## 4. Add or modify a status effect

Use `status` or `buff` when an effect continues after the original hit. Each
status subtype is declared as its own effect object; do not combine multiple
status payloads into a single combined object. Examples include slow, burn,
bleed, silence, stun, damage reduction, and Overclock.

Status timing belongs to the phase effect that starts the status. Put it on
the phase effect so a later phase may own a different duration or tick cadence:

~~~js
// Phase contract
effect(EFFECT_TYPES.STATUS, {
    subtype: "slow",
    durationMs: 2_000,
}),
~~~

To apply more than one status, add more concrete objects to `effects[]`:

~~~js
effects: [
    statusEffect("burn", { amount: 2, durationMs: 5_000 }),
    statusEffect("slow", { durationMs: 2_000 }),
],
~~~

An entity phase declares the concrete status objects it applies. If a later
phase changes a status amount or duration, author that value directly on the
later phase. `effectOverrides` keys such as `status:burn` and `status:slow`
remain readable for older payloads/replays, but new contracts should not use
them for ordinary phase differences.

Server status effects use the same generic record shape:

~~~text
type, mode, remainingMs, optional tickMs, sourceSlot, abilityId, effects[]
~~~

Use remainingMs for the applied status instance and tickMs only for periodic
effects such as damage over time. Do not add baseline timing to effect
templates or invent ability-specific runtime fields such as burnRemainingMs.

When creating a completely new status subtype or status component, update the
allowlisted browser status contracts and the authoritative server status model,
then update the generic status systems. Do not add a one-off ability-ID branch
to a tick loop when an existing generic status component can express the
behavior.

Concussive Shot is a useful special case: its slow duration is represented in
the ability catalog/contract and also in the shared Hit Stagger timing constants.
If changing that behavior, update both browser/server copies.

## 5. Add or modify a projectile, trap, zone, or summon

An ability creates a world object when its numeric ID has an entry in the
browser and server `AbilityContracts` registry. Entity creation is registry
metadata, not an ability effect, and the delivery contract does not duplicate
the entity type.

For an existing entity type, tune root lifetime/spawn/health metadata and the
phase values in `AbilityContracts.js` and `AbilityContracts.java`: size, speed,
radius, hitbox, damage, status, visual, shot cooldown, and similar behavior.
Keep ability-level timing/resources in `Abilities.js`/`Abilities.java` and keep
phase boundaries/actions in the entity contract.

For a new entity type, you usually need all of these on both runtimes:

1. Add the entity type and components to the entity contracts.
2. Add initial-state construction to the entity factory.
3. Add generic lifecycle/collision/effect behavior to the entity system.
4. Add owner/friendly-fire and targetability rules.
5. Add replay state for position, phase, timer, HP, and required visual data.
6. Add factory, lifecycle, collision, effect, determinism, and replay tests.

Classify timers carefully:

- Cast delay: windupMs and action preparation.
- During an entity's duration phase, its contracted motion is active even if
  its velocity is zero or it is clamped by the arena. The phase ends from the
  timer, never from `traveled`.
- The first declared phase is the entity's initial phase. Later phases are
  entered only by an event action with an explicit `transition.to` phase ID.
- A phase-local `durationMs` is only a timer. When it expires, the runtime
  dispatches `lifetimeEnd`; that event may transition elsewhere, and an
  unhandled expiry removes the runtime object by default.
- Moving object: phase-defined motion across one full `durationMs` lifecycle.
- Trap: travel phase followed by an armed/trigger phase in the same lifecycle.
- Zone/summon: entity `durationMs`; use `interval` for one repeated action.
- Bot-local continuing effect: status remainingMs.
- Cooldown/ammunition: resource maps.

For a fixed-step projectile, effective travel range is derived from
`durationMs / 100 * displacementPerTick` (or the equivalent entity duration
stat). Keep the projectile's configured range equal to that value. The range is
not a `traveled`-based removal condition; lifetime, collision, and arena bounds
still own entity removal.

## 6. Change defensive effects

Defensive abilities use the same ordered effect contract as every other
ability. Use `damage_reduction`, `damage_reflection`, or `damage_immunity`
when the intended behavior is a timed defensive status. Hostile effects are
skipped by the normal defensive-state check; there is no separate shield
policy, absorption resource, or blocked-effect pass to maintain.

Test the status duration, effect strength, hostile-damage behavior, and replay
state on both runtimes.

## 7. Change catalogue and bot-logic behavior

These changes are broader than tuning a number:

- AbilityRegistry: add a permanent ID, name, label, and type.
- BotLoadout: add catalogue entry, draft pool/tags, action mapping, or entity
  capabilities when needed.
- Bot-code schema/normalization: change only when adding a new action, target
  mode, condition variable, or payload shape.
- Server validation: update allowlists and bounds for new IDs, actions, targets,
  and payload fields.
- Compact loadout encoding and migration: update only when the wire format or
  stable ability set changes.

Condition selectable menus are identity-driven. Ability definitions expose the
identities supplied by their spawned entity (`ability-entity`, `position`,
`health`, `facing`, or `movement`), while each variable declares the identities
required by each selectable slot. Add an identity only when the underlying runtime
state is meaningful and keep the browser and server declarations in parity.
Bot ability/status variables also declare a loadout dependency so their
secondary ability or status list is derived from the selected bot's loadout.

Do not add an ability to only the picker or only the browser catalog. A rated
ability needs browser normalization, server validation, authoritative
activation, phase execution, replay, and tests.

## 8. Change visuals without changing gameplay

Visual values such as visualMs, visualDurationMs, phase `visibleMs`, sprite
size, tint, glow, and animation timing belong to presentation code. They can
make an ability clearer but must not decide:

- whether an ability hits;
- how much damage it does;
- whether a cooldown is ready;
- where a collision occurs;
- whether a match is won.

Gameplay state should be produced by the fixed-step systems. Pixi and replay
presentation should read that state.

## 9. Adding a new effect type

Only add a new effect type when the existing generic effects cannot express the
behavior. The normal sequence is:

1. Add the effect name to browser EFFECT_TYPES and server EffectType.
2. Define its contract fields and allowed values.
3. Implement the generic browser executor in
   frontend/src/gameArena/ecs/abilities/AbilityEffectSystem.js or the owning
   generic system.
4. Implement the authoritative server effect in the corresponding combat/state
   system.
5. Mirror effect ordering, source ownership, friendly-fire behavior, rounding,
   and status/entity interaction.
6. Add a contract test and a real ALWAYS-brain execution test on both sides.
7. Add replay/presentation state only if the effect has a visible world result.

Never execute arbitrary user-provided code or expression text for an effect.
Effects must remain normalized, allowlisted, and deterministic.

## Testing after a change

Run the smallest relevant tests first:

~~~powershell
# From frontend/
node --test src/gameArena/gameconfig/AbilityRegistry.test.js src/gameArena/gameconfig/AbilityResourceSystem.test.js src/gameArena/ecs/tests/EntitySystems.test.js

# From server/
.\mvnw.cmd test "-Dtest=AbilitiesTest,AbilityContractsTest,AbilityEntitySystemTest"
~~~

Then run the full checks:

~~~powershell
# From frontend/
npm test
npm run lint
npm run build

# From server/
.\mvnw.cmd test
~~~

For a gameplay change, verify at least:

- browser/server catalog and contract parity;
- cooldown, windup, active, charge, and reload timing;
- damage/healing/effect order and rounding;
- target, ownership, and friendly-fire behavior;
- entity lifecycle and collision if an entity is involved;
- deterministic repeated runs and replay state;
- practice-room behavior and authoritative server behavior.

## Recommended workflow by change size

### Number-only timing/resource tuning

Edit both timing/resource catalogs, update the mirrored phase contracts when
behavior is affected, update nearby expectations, and run the focused tests.

### Existing generic effect

Edit both phase contracts. Usually no execution-system code is needed. Add a
real execution test so the effect is proven to reach gameplay.

### New status, entity, phase host, or effect type

Read [Adding an Ability or Move](ADDING_AN_ABILITY_OR_MOVE.md) and [Adding an
Authoritative Backend Ability or Move](ADDING_A_BACKEND_ABILITY_OR_MOVE.md).
These changes cross multiple systems and need full parity, validation, replay,
and deterministic tests.
