# Ability Effect Contract

Each selectable ability has one mirrored browser/server timing definition and one
normalized ability contract:

```text
Abilities         identity, resource, cooldown, active, and duration metadata
AbilityContracts  direct and spawned abilities in one normalized registry
activation        optional activation-time targeting/capture metadata
phases[]          ordered hitboxes, movement, visuals, events, and effects
```

The canonical browser and server registries are `frontend/src/gameArena/ecs/contracts/AbilityContracts.js` and `server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java`. Both direct bot abilities and spawned entities use the same normalized contract and phase shape; the category distinguishes whether a contract stays attached or enters the entity world. Browser effect execution is generic in `frontend/src/gameArena/ecs/abilities/AbilityEffectSystem.js`. `Abilities.js`/`Abilities.java` author ability identity, resource, and timing metadata; their legacy stats/definition views are derived compatibility projections. Phase behavior is authoritative in the unified contract.

## Phase ownership and geometry

There is no separate delivery field. A phase's `type` describes its host or
lifecycle, while `hitbox.shape` describes the actual geometry. A direct ability
uses a `botAttached` phase; its transform stays on the owner. An entity ability
has an `AbilityContracts` root with spawn/lifetime metadata and phases such as
`projectile`, `zone`, `trap`, or `summon`. The phase event (`activation`,
`collision`, `interval`, and so on) determines when its concrete effects run.
Phase Strike therefore has a `botAttached` phase with a forward `rectangle`
hitbox 100 units long and 60 units wide; its teleport is simply one ordered
effect in that phase.

An entity contract may also contain a list of small contract-owned abilities.
For example, a summon can keep its circular body and health on its `summon`
phase while a scheduled mini ability owns a separate ray hitbox, effects, and
visual. Each mini ability also has its own spawn point and rotation relative to
the entity that owns it (for example, the drone itself). The phase
`execution.abilityId` selects that mini ability; its interval is the firing
cadence, not a game ability cooldown.

For arc melee bot hit checks, `includeTargetRadius` controls whether the defender's circular hitbox participates in filled-sector collision. When enabled, the defender radius expands the sector's radial edges and outer range, so an overlapping target or a target whose edge crosses the authored arc can be hit even when its center is outside the raw bearing. Phase Strike declares the same target-radius inclusion for its 100-by-60 forward rectangle, so contact with a bot's edge counts even when its center is just outside the raw rectangle. It has no facing arc. Its rectangle is captured at activation, so movement or a teleport later in the same tick cannot move the hitbox. If it intersects multiple opposing bots, each receives the normal effects, while the teleport is consumed once by the nearest valid hit in deterministic distance order. The `center_distance` teleport mode measures the activation bot center to the hit bot center at impact, then places the attacker on the opposite side at that same center distance. Its `phaseFacingMode` is a relative degree offset from the attacker's facing at impact: `0` keeps the facing, `90` turns clockwise, and `180` reverses it.

For radial blasts, persistent zones, and trap contact, the collision radius is expanded by half the moving bot's size, so contact with the bot's outer edge counts. Damage falloff still uses the center-to-center distance, so edge contact does not change the configured damage profile.

Distance falloff is a generic linear profile rather than a table of range bands. An effect may declare `falloff: { maxAmount, minAmount, falloffStart, falloffEnd }` for a distance-dependent amount, or `falloff: { maxDurationMs, minDurationMs, falloffStart, falloffEnd }` for a distance-dependent duration. The profile is clamped to the ability's effective maximum range (or a phase `range`/`radius` override), so a start or end beyond that range cannot extend the hitbox. Values stay at the maximum through the start distance, interpolate to the minimum at the effective end distance, then remain at the minimum until the hit range ends. Browser and server execution round the same calculated value.

Entity existence is keyed by ability ID in `AbilityContracts`; it is not an effect. The unified registry is the only source that decides whether an activation stays attached or creates a projectile, trap, zone, or summon. Target labels and catalogue capabilities remain in `BotLoadout.js` as schema/UI metadata.

Entity-backed projectile and segment contracts declare their hitbox shape and
dimensions on the active phase in `AbilityContracts`. Entity phases reuse the
shared `AbilityPhase` contract and own concrete effect payloads, including
status subtype, amount, and duration; the runtime does not hydrate phase
effects from an effect-type allowlist. The browser preview and authoritative
server use mirrored swept rectangle-versus-circle collision math against
moving bots. Rectangle width and length are independent stats. Other entity
behavior keeps its phase-owned circular hitbox unless it declares a different
shape. Practice-mode hitbox overlays
read this same metadata and never participate in gameplay decisions. The
overlay also renders the captured melee-sector or rectangle, radial, and hitscan geometry
for direct phases, summon shot rays, and derived visual explosions during
their existing active or visible-ms windows. Those debug primitives are
presentation-only; they do not create or extend a gameplay hit window.

## Effects

- HP: `damage`, `healing`.
- Displacement: `knockback`, `pull`, `teleport`, `restore_state`. Phase movement
  is numeric phase data, not an effect.
- Status: `status`, `buff`. A timed modifier that changes a bot's stats or
  functionality is applied as a bot-local status and owns its remaining time
  and expiry through the status contracts. Each status is its own effect object,
  so one phase can declare multiple status instances, for example
  `statusEffect("burn", ...)` and `statusEffect("slow", ...)`. Status effect
  overrides use a qualified key such as `status:slow`, allowing each subtype to
  receive its own duration profile. Overclock is the current positive example:
  its `buff` subtype is `overclock`; its 0.5 cooldown-start multiplier is read
  only when a new ability cooldown or charge reload timer is created, so timers
  already running when Overclock activates remain unchanged. The multiplier is
  cleared when the status expires.
  The browser catalogue marks these effects with `ABILITY_TAGS.STATUS_EFFECT`
  (`"status-effect"`). There is no separate positive `"buff"` catalogue tag;
  `self` remains independent, so `self` plus `status-effect` identifies a
  positive self-applied status in the current catalogue.
- Immediate control: `interrupt`.
- Defensive modifiers: `damage_reduction`, `damage_immunity`,
  `damage_reflection`. These carry their numeric strength in the contract and
  are applied as timed positive statuses by the generic runtime. Reactive Armor
  owns `reactive-armor` status time; Absolute Guard owns `absolute-guard`
  status time. Neither effect duration is an ability action lock. Self-applied
  positive effects also receive the `self` catalogue tag.
- World state: entity contracts and phase events.

Apply effects in declared order. Add a new effect class only for reusable behavior that existing classes cannot express. Generic executors switch on effect class/subtype, not ability ID.

### Status-driven stat changes

Status components are resolved according to how the affected stat is used,
not by writing a new multiplier field onto the bot. Incoming damage is settled
through one shared resolver that adds every active
`incoming_damage_modifier` application. A modifier may declare
`excludedDamageSourceTypes` when it should not affect a particular source
category, and may declare `rounding: "truncate_tenths"` when its modified
damage must be truncated to one decimal place.

Bleed uses this generic path: its `+0.25` incoming-damage modifier excludes
damage whose source is the `bleed` status itself, so its own damage-over-time
remains unchanged while other damage is increased. The source exclusion is
metadata on the modifier; the damage resolver does not contain a Bleed-specific
conditional. If another weakening status is added, it can contribute another
incoming modifier, and active modifiers add together. For example, Bleed's
`+25%` and a `-50%` damage reduction produce a net `-25%` modifier, applied
once to the base damage.

This differs from Overclock's cooldown modifier. Overclock is read when a new
cooldown or reload timer is created, so existing timers are intentionally not
rewritten. The runtime therefore evaluates a status at the boundary where its
affected value is consumed: damage at damage settlement, cooldown modifiers at
timer creation, and movement modifiers during movement resolution.

## Generic runtime architecture

New abilities must extend the declarative contracts and generic systems. Do not
add a new ability-specific tick branch when an existing contract type already
describes the behavior.

| Behavior | Contract shape | Browser owner | Server owner |
| --- | --- | --- | --- |
| Ability definition and ordered effects | ability timing/resource metadata plus phase-owned activation, geometry, events, and effects | `ecs/contracts/AbilityContracts.js` and `Abilities.js` | `simulation/ecs/contracts/AbilityContracts.java` and `Abilities.java` |
| Persistent, targetable, moving, or delayed world object | entity type, components, lifecycle, interaction | `ecs/contracts/AbilityContracts.js`, `ecs/entities/EntityFactory.js`, `ecs/abilities/AbilityEntitySystem.js` | `simulation/ecs/contracts/AbilityContracts.java`, `simulation/ecs/entities/AbilityEntityFactory.java`, `simulation/ecs/abilities/AbilityEntitySystem.java` |
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

An `interrupt` effect cancels a bot's current preparation or active phase. A
preparation is discarded without firing its activation effects and immediately
enters the ability's cooldown or reload gate. An active bot-owned phase is
stopped and enters recovery; an entity that was already spawned is not removed
or rewound because its lifecycle remains owned by the entity contract.

There is one global ability lock per bot. It is derived from the bot's action
state rather than stored as one independent boolean: the lock is held while
`preparingAbility` is set or while any `abilityActiveMs` entry is positive. A
different non-exempt ability cannot begin while that lock is held; the ability
already winding up continues its preparation, and ordinary movement/rotation
remain available. Dash is the declarative exception through
`ignoresGlobalAbilityLock`: Dash can begin while another ability is active, and
an active or preparing Dash does not block another ability. Channelled abilities
may continue their own active phase.

The generic `abilityCharges` map remains available for ammunition and other
explicitly contracted resources. Defensive abilities use ordinary ordered
effects and bot-local defensive statuses; they do not use a separate shield
interaction layer.

### Entity lifecycles, phases, and intervals

`durationMs` is the default lifetime of an ability-created entity. A phase may
also define its own `durationMs`; that phase-local clock starts when the phase
is entered and ends by dispatching its `lifetimeEnd` event. This lets one
logical entity move, arm, detonate, and expire without creating child entities.
Projectile `range` remains a derived travel/display value when applicable; it
is never an alternate removal timer or the projectile rectangle's length.

Distinct entity behavior belongs in generic declarative phases. The same
phase shape is used by direct abilities and persistent entities:

```text
Ability
├─ metadata (name, cooldown, cast time, description, resources)
└─ phases
   ├─ phase 1
   ├─ phase 2
   └─ ...
```

Each phase has an unrestricted stable ID, a public `type`, optional
movement/lifetime data, a hitbox, presentation metadata, and allowlisted event
handlers. Entity phase types describe their runtime behavior; direct hitboxes
use `botAttached` to state that the bot hosts their transform. Their actual
geometry comes exclusively from `hitbox.shape`, rather than from catalogue
labels such as melee or ray. Geometry uses concrete phase-owned field names:
circular shapes use `radius`, rectangles use `width` and `length`, and rays or
arcs use `range`, `width`, and `arc` as applicable. For a projectile rectangle,
`length` is the physical longitudinal collision dimension and is independent of
travel/display `range`. Numeric phase values are the authored form; stat-name
references remain only at compatibility boundaries for older payloads/replays.

Entity root metadata is intentionally small: `lifetime`, owner-relative `spawn`,
`entityType`, `runtimeType`, category, and the initial phase list. Root motion,
root health, and root visual descriptors are not authored behavior contracts.
An optional `health` record belongs to the phase that can receive damage; the
runtime copies that phase data into its HP component. The factory initializes
motion from the first phase's numeric `movement.speed`, and renderers resolve
visuals from the current phase. Spawn
offsets use the owner's facing basis: positive x is right, positive y is
forward, negative y is behind, and `rotation: "owner"` follows the owner while
`rotation: "zero"` is world-aligned. Target-position spawns use the authored
target coordinates instead of an owner-relative offset.

For example, a mine can be described without naming an explosion behavior:

```js
phases: [
    {
        id: "travel",
        type: "projectile",
        movement: { speed: 22 },
        hitbox: { shape: "circle", radius: 12 },
        visual: { type: "proximityMine", state: "moving", visualSize: 24 },
    },
    {
        id: "armed",
        type: "zone",
        movement: { speed: 0 },
        hitbox: { shape: "circle", radius: 87.5 },
        trigger: { radius: 87.5, botContact: true },
        events: {
            collision: { actions: ["transition"], transition: { to: "active" } },
        },
        visual: { type: "proximityMine", state: "static", visualSize: 24 },
    },
    {
        id: "active",
        type: "zone",
        durationMs: 300,
        hitbox: { shape: "circle", radius: 87.5 },
        effects: ["damage"],
        events: {
            collision: { actions: ["applyEffects"] },
            lifetimeEnd: { actions: ["remove"] },
        },
        visual: { type: "mineExplosion", visualSize: 175, visibleMs: 300 },
    },
]
```

The phase event boundary is intentional. Geometry systems detect a collision
and provide target IDs; the phase event dispatcher runs the phase's allowlisted
actions. Incoming damage can dispatch `hit` for nonlethal damage or `killed`
when damage crosses the phase's HP from above zero to zero. A collision handler
may put a `targetPolicy` on its `applyEffects` event
to accept every contact, only the first contact per target, or one contact per
target interval. Other actions such as `transition`, `emitVisual`, and `remove`
are not target-ledger operations. The entity does not directly mutate arbitrary
bot state. A `self` phase uses the owner's ID as its target, while `summon`
phases keep their movement and health lifecycle on the summon. Any scheduled
mini abilities own their delivery geometry and effects and still dispatch those
effects as ordinary phase events.

Collision events may also declare `targetKinds`, using the shared semantic
values `BOT`, `HP_ENTITY`, or `ENTITY`. An omitted list preserves the legacy
bot-only scope. Damage-producing entity collisions explicitly target
`["BOT", "HP_ENTITY"]`: the source event controls whether the source applies
effects or is removed, while the target's phase-local `health` determines
whether it receives damage and can emit `hit` or `killed`. Two ordinary
projectiles therefore do not collide just because their geometry overlaps.

`applyEffects` may also select a subset of the phase effects. Set
`effectTypes` on the event, for example:

```js
effects: [
    effect("damage", { amount: 20 }),
    statusEffect("slow", { durationMs: 1000 }),
],
events: {
    collision: {
        actions: ["applyEffects"],
        effectTypes: ["damage"],
    },
}
```

Only the selected effect types run for that event; omitting `effectTypes`
keeps the phase's complete effect list. A summon is treated as bot-like for
an event whose target scope is bot-only, so bot-targeted status and
displacement effects can affect a summon. Other HP-bearing entities remain
damage-only unless the event explicitly includes `HP_ENTITY`.

Status effects can be narrowed further with `statusTypes` while retaining the
same `effectTypes: ["status"]` selection:

```js
effects: [
    statusEffect("silence", { durationMs: 2000 }),
    statusEffect("slow", { durationMs: 1000 }),
],
events: {
    collision: {
        actions: ["applyEffects"],
        effectTypes: ["status"],
        statusTypes: ["silence"],
    },
}
```

Only silence runs for that event. Omitting `statusTypes` applies every status
effect selected by `effectTypes` (or every phase effect when `effectTypes` is
also omitted).

Summon status state is persistent entity payload state. Timed `silence`,
`stun`/`interrupt`, and `slow` block or modify its movement/execution loop;
`knockback` and `pull` move it immediately; interval statuses such as `shock`,
`burn`, or `bleed` apply damage on their interval and can add a short movement
lock. A `whileInside` zone status is represented as a presence status and is
refreshed while the summon remains in the zone. Silence and interruption reset
the summon mini-ability's execution timer, so it resumes on a fresh cadence.

Transitions preserve the entity ID and reset phase-local state such as the
target hit ledger, timer, and visual descriptor. Thus two copies of one
repeating projectile keep independent ledgers and can hit the same target on
their own schedules.

Grenades use the same pattern with three explicit phases: `travel` carries a
rectangle hitbox, `armed` keeps the stopped grenade hitbox, and `active` uses
the circular `radius` hitbox for the explosion. The runtime entity's flat
`size` field remains the physical/display footprint used by simulation and
replay compatibility; it is derived at spawn from the first phase, while
collision always reads the current phase's `hitbox`. Sprite-backed entities may
also define a presentation-only `visualSize`; it never participates in
collision. Rectangle collision width and length come from the active phase's
`hitbox.width` and `hitbox.length`.

Sprite-backed phase contracts may also declare a presentation-only `visual`
descriptor such as `{ type, state, visualSize, visibleMs }`. The renderer
resolves that descriptor from the entity's current `phaseId`; transient event
visuals may override its `type`, `visualSize`, or `visibleMs`. This keeps a
grenade's travel, armed, and active visuals next to the lifecycle phase that
owns them instead of using a separate explosion-size or explosion-visibility
field.

That presentation descriptor is a browser contract, not replay state. Replay
payloads carry the authoritative phase and gameplay clocks (`phaseId`,
`phaseTimerMs`) plus semantic event occurrences (`eventType`,
`eventSequence`); they do not carry a visual type, size, or visibility
countdown. The frontend resolves each semantic event through its local ability
contract, so practice, live rendering, and replay use the same visual mapping.
For repeating events, the incremented sequence identifies a new occurrence;
the renderer owns the visual duration and animation timing.

The proximity mine's travel phase has an 800 ms `durationMs`. Its
`lifetimeEnd` event explicitly transitions to the stopped armed phase, whose
own 20-second timer either expires into or collides into the short active blast
phase. Gravity and Singularity use the same explicit event transitions for
travel, pull, and damage/detonation behavior. Phase array order only selects
the initial phase; elapsed entity age never selects a later phase.

Phase duration only schedules `lifetimeEnd`. If the current phase handles that
event, its declared actions decide what happens. If it has no handler, expiry
removes the runtime object by default, so a one-phase entity such as Tether
Bolt does not need a redundant `lifetimeEnd: remove` event.

For one action that repeats at a fixed cadence, keep one phase and attach a
`execution` scheduler to it. Orbital Strike, for example, can use
`execution: { event: "interval", intervalMs: "intervalMs", startImmediately: true }` and put its
`applyEffects`/`emitVisual` actions in `events.interval`. The scheduler runs
until that phase's duration or the entity lifetime ends; it does not require a
new phase object for every pulse. `startImmediately: false` waits for one full
interval before the first event. A collision handler that needs a per-target
cooldown declares `targetPolicy: { mode: "interval", intervalMs: ... }`; the
entity's target-ID ledger stores the last accepted effect application
independently for each target.

`execution.event` and `execution.abilityId` are the two scheduler modes. `event`
re-dispatches an event already owned by the current phase; `abilityId` selects
one of the entity contract's embedded mini abilities and runs that ability's
phase at the cadence. They are conceptually exclusive: an event is a response
inside the current entity, while an embedded ability is a separate reusable
behavior contract owned by that entity.

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

Status timing belongs to the phase effect that starts the status, not to a
global effect template. A phase may declare concrete status metadata such as:

```js
effects: [
    statusEffect("burn", { durationMs: 5000, intervalMs: 1000 }),
    statusEffect("slow", { durationMs: 2000 }),
]
```

The phase contract resolves that metadata into the status instance's
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

## Presentation boundary

Visuals may read contract/state metadata but never determine hits or mutate gameplay. Testing and replay share presentation; Java remains authoritative.

## Change checklist

1. Mirror numeric definitions and contract metadata.
2. Add loadout/target metadata only when required.
3. Connect generic phase/effect execution.
4. Classify timers and delayed behavior into preparation, entity lifecycle,
   status, resource, lifecycle, or deferred-state ownership.
5. Add the visual separately.
6. Test browser/server metadata parity and real execution.
