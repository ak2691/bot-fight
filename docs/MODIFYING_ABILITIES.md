# Modifying Abilities

This is the practical guide for tuning existing abilities and extending their
gameplay behavior.

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

For a simple number change:

1. Find the ability ID in AbilityRegistry.js.
2. Change the browser value in frontend/src/gameArena/gameconfig/Abilities.js.
3. Change the matching server value in
   server/src/main/java/com/example/botfight/simulation/gameconfig/Abilities.java.
4. If the number is an effect amount or duration, update the matching entry in
   AbilityContracts.js and AbilityContracts.java too.
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
| Cooldown, windup, damage, range, charges, reload, geometry | gameconfig/Abilities.js | simulation/gameconfig/Abilities.java |
| Delivery and ordered effects | gameconfig/AbilityContracts.js | simulation/gameconfig/AbilityContracts.java |
| Status behavior and allowed status components | ecs/contracts/StatusContracts.js, ecs/bots/BotStatusSystem.js | StatusEffectState.java, BotStateService.java |
| Projectile, trap, zone, or summon lifecycle | ecs/contracts/EntityContracts.js, ecs/entities/EntityFactory.js, ecs/abilities/AbilityEntitySystem.js | simulation/ecs/contracts/EntityContracts.java, AbilityEntityFactory.java, AbilityEntitySystem.java |
| Ability readiness, charges, and resource timers | ecs/bots/BotResourceSystem.js | BotStateService.java |
| Catalogue name, label, tags, draft metadata | loadout/BotLoadout.js, AbilityRegistry.js | AbilityRegistry.java, loadout/config validation |
| Icons, animations, flashes, and other presentation | pixi/, visual-state helpers | replay/presentation metadata only; never gameplay authority |

The two most important files are the numeric catalog and the effect contract:

- Browser numeric catalog: frontend/src/gameArena/gameconfig/Abilities.js
- Browser effects: frontend/src/gameArena/gameconfig/AbilityContracts.js
- Server numeric catalog: server/src/main/java/com/example/botfight/simulation/gameconfig/Abilities.java
- Server effects: server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityContracts.java

## 1. Modify an ability stat

The browser catalog is a numeric-keyed object. For example, Gun is
ability 3:

~~~js
3: {
    maxCharges: 6,
    reloadMs: 5000,
    cooldownMs: 1000,
    activeMs: 500,
    maxDamage: 15,
    minDamage: 5,
    damageFalloffStart: 100,
    damageFalloffEnd: 700,
    range: 700,
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
| damage | Fixed damage amount. |
| healing | Fixed healing amount. |
| maxDamage, minDamage | Endpoints of a linear damage-falloff profile. |
| damageFalloffStart, damageFalloffEnd | Distances where falloff begins and reaches minimum damage. |
| range | Hit, targeting, or falloff range. For moving projectiles, keep it equal to the duration-phase displacement. |
| throwRange | Maximum displacement shown for a thrown projectile or trap. Keep it separate from the impact radius or trigger radius. |
| arcDegrees | Facing arc for abilities that use an arc. |
| hitboxWidth | Width of a forward rectangle when the delivery declares rectangle geometry. |
| knockback | Displacement strength for a knockback effect. |
| pullPerTick | Displacement applied by a persistent pull effect each simulation tick. |
| radius, zoneSize, explosionRadius | Collision or presentation geometry, depending on the contract. |
| speed, speedPerTick, moveSpeed | Movement speed for the relevant projectile/entity. |
| phases | Declarative entity phases with `id`, `startMs`, movement, triggers, effect types, and optional entry actions. |
| intervalMs | Cadence for a generic `interval` entity action. Orbital Strike uses this for repeated hits. |
| explosionVisibleMs, visualMs | Presentation timing only unless explicitly used by gameplay state. |

The server uses the same concepts, but its AbilityDefinition constructor is
positional:

~~~java
new AbilityDefinition(
        cooldownMs,
        windupMs,
        activeMs,
        durationMs,
        damage,
        range,
        arcDegrees,
        charges,
        rechargeMs,
        reuseCooldownMs,
        activationModel,
        resourceModel,
        falloffMode,
        damageFalloff,
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

### Damage falloff

Use a linear profile when damage changes with distance. In the browser:

~~~js
maxDamage: 40,
minDamage: 25,
damageFalloffStart: 0,
damageFalloffEnd: 64,
range: 70,
~~~

In the server, the equivalent is a list of damage anchors:

~~~java
linearFalloff(40, 25, 0, 64)
~~~

The browser and server must have the same maximum, minimum, start distance,
end distance, overall range, and rounding behavior.

## 2. Add, remove, or reorder an effect

Stats describe values. Contracts describe what the ability does with those
values. An ability's contract contains:

~~~text
delivery -> how the hit reaches a target
effects[] -> ordered game-state changes
shieldInteraction -> which effects a shield prevents
execution -> activation-time targeting/capture behavior
~~~

### Existing effect types

| Effect | What it does | Typical values |
| --- | --- | --- |
| damage | Removes HP. | amount, or runtime-computed falloff |
| healing | Restores HP. | amount, recipient, requiresConfirmedDamage, mirrorsDamage |
| knockback | Pushes a target away. | distance |
| pull | Pulls a target toward a point. | perTick or amount |
| movement | Moves the source or target through a movement contract. | distance/stat references |
| teleport | Moves a target instantly. | fixed distance or `distanceMode: center_distance` |
| restore_state | Restores a captured state after a delay. | delay/completion metadata |
| debuff | Applies a negative timed or presence status. | subtype, duration, strength |
| buff | Applies a positive timed or presence status. | subtype, duration, strength |
| interrupt | Cancels preparation without activation or stops a bot-owned active phase, then starts cooldown/reload. | duration when needed |
| damage_reduction | Reduces incoming damage while active. | multiplier/amount, duration |
| damage_immunity | Prevents damage while active. | duration |
| damage_reflection | Reflects damage under the declared defensive rules. | multiplier/amount, duration |
| spawn_entity | Creates a projectile, trap, zone, or summon. | entity type and entity stats |

Effects are applied in the order listed. Reordering effects can change gameplay
if an effect depends on a confirmed hit or changes the target's state.

### Adding an already-supported effect

Suppose ability 30 should also knock the target backward by 100 units.

Browser numeric catalog:

~~~js
30: {
    damage: 15,
    knockback: 100,
    statuses: { slow: { durationMs: 2_000 } },
    // existing stats...
}
~~~

Browser contract:

~~~js
30: contract(DELIVERY_TYPES.RAY, [
    effect(EFFECT_TYPES.DAMAGE, { amount: A[30].damage }),
    effect(EFFECT_TYPES.KNOCKBACK, { distance: A[30].knockback }),
    effect(EFFECT_TYPES.INTERRUPT, { durationMs: A[30].interruptMs }),
    effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: A[30].statuses.slow.durationMs }),
], ignore),
~~~

Server numeric catalog:

~~~java
Map.of(
        "interruptMs", 250.0,
        "knockback", 100.0)
~~~

Server contract:

~~~java
entry(30, DeliveryType.RAY, IGNORE,
        effect(EffectType.DAMAGE, 15),
        effect(EffectType.KNOCKBACK, 100),
        timed(EffectType.INTERRUPT, 250),
        debuff("slow", 0, 2_000)),
~~~

This works without new ECS code because knockback is already a generic effect.
For a new effect type that the generic runtime does not understand, see
Adding a new effect type.

### Effect values can be stats or constants

Prefer a stat when the value is intended to be easy to tune:

~~~js
effect(EFFECT_TYPES.KNOCKBACK, { distance: A[30].knockback })
~~~

Some contracts currently use a direct literal, such as a fixed interrupt
duration. If you want that value to be a regular tuning knob, add it to the
numeric catalog in both runtimes and have both contracts read the catalog value.
This avoids accidentally changing one runtime but not the other.

## 3. Change delivery and targeting

Delivery controls travel, collision, and when the target is resolved. It does
not automatically add damage.

| Delivery | Use for |
| --- | --- |
| self | Effects applied to the caster, such as healing or a self-buff. |
| melee | Immediate close-range hit with optional target radius/facing arc or an explicitly declared rectangle geometry. |
| ray | Instant line/ray hit. |
| projectile | Moving object that collides later. |
| radial | Immediate area effect around a center point. |
| zone | Persistent area that checks targets over time. |
| trap | Moving or placed object that becomes armed and checks targets later. |
| summon | Persistent owned object such as a drone. |

Changing delivery can change collision timing, shield bearing, target timing,
and whether an entity is needed. Mirror the browser and server contract exactly.

self is especially important: a visual/control ability such as Lock On is a
self-delivery action and should not become a hostile mine/projectile entity just
because it is active on another bot.

Targeting metadata may also live in the contract's execution section. Existing
options include target selection, facing captured at activation, phase-facing
defaults, movement behavior, one-time effects within a multi-target activation,
and whether an ability can ignore the global ability lock. Change these only
when you intend to change action semantics.

## 4. Add or modify a status effect

Use debuff or buff when an effect continues after the original hit. Examples
include slow, burn, bleed, silence, stun, damage reduction, and Overclock.

Status timing belongs to the ability that starts the status. Put it in nested
catalog metadata and resolve it into the applied status instance:

~~~js
// Numeric catalog
statuses: {
    slow: { durationMs: 2000 },
},

// Contract
effect(EFFECT_TYPES.DEBUFF, {
    debuff: "slow",
    durationMs: A[30].statuses.slow.durationMs,
}),
~~~

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

An effect such as this creates a world object:

~~~js
effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "proximity_mine" })
~~~

For an existing entity type, tune the supported stats in Abilities.js and
Abilities.java: size, speed, radius, `durationMs`, HP, shot cooldown, and
similar values. Keep phase boundaries and phase actions in the entity contract,
not as ability-specific lifetime or fuse fields.

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
- A phase begins at its declared `startMs`; its movement and effect actions are
  resolved by the generic phase handler.
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

## 6. Change shields and defensive interactions

Each contract has a shieldInteraction. It declares which effect types a shield
can prevent and the cost/geometry of that interaction. The current duel-v1
catalog mostly uses ignore because there is no active shield-absorption rule.

When adding or changing a defensive ability:

- declare the shield mode and prevented effect types in both contracts;
- resolve the shield once per impact;
- apply the remaining ordered effects only once;
- test blocked damage, blocked status, displacement, charge cost, and replay.

Do not independently re-apply an attached status after its hit was blocked.

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
activation, execution, replay, and tests.

## 8. Change visuals without changing gameplay

Visual values such as visualMs, visualDurationMs, explosionVisibleMs, sprite
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
5. Mirror shield handling, ordering, source ownership, friendly-fire behavior,
   rounding, and status/entity interaction.
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
- target, ownership, friendly-fire, and shield behavior;
- entity lifecycle and collision if an entity is involved;
- deterministic repeated runs and replay state;
- practice-room behavior and authoritative server behavior.

## Recommended workflow by change size

### Number-only tuning

Edit both numeric catalogs, update effect contract values if necessary, update
nearby expectations, and run the focused tests.

### Existing generic effect

Edit both numeric catalogs and both contracts. Usually no execution-system code
is needed. Add a real execution test so the effect is proven to reach gameplay.

### New status, entity, delivery, or effect type

Read [Adding an Ability or Move](ADDING_AN_ABILITY_OR_MOVE.md) and [Adding an
Authoritative Backend Ability or Move](ADDING_A_BACKEND_ABILITY_OR_MOVE.md).
These changes cross multiple systems and need full parity, validation, replay,
and deterministic tests.
