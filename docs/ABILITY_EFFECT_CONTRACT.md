# Ability Effect Contract

Each selectable ability has one mirrored browser/server contract:

```text
delivery          how effects reach a target
effects[]         ordered game-state changes
shieldInteraction which effects a shield prevents and at what cost
```

Browser contracts: `frontend/src/gameArena/gameconfig/AbilityContracts.js`. Browser direct-effect execution: `frontend/src/gameArena/ecs/AbilityEffectSystem.js`. Server: `server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityContracts.java`. Authoritative numeric tuning lives in `gameconfig/Abilities.java`; values calculated during execution are marked `runtimeComputed` server-side.

## Delivery

Current types: `self`, `melee`, `ray`, `projectile`, `radial`, `field`, `trap`, and `summon`. Delivery owns travel, collision, and target timing. It does not imply damage or interpolation. Phase Strike uses `melee` delivery with a 100-unit range and a 90-degree facing arc; its teleport is an ordered effect.

For melee bot hit checks, range is measured from the attacker center to the defender center plus half the defender's size, so a defender's edge can reach the attack range. Phase Strike preserves its original 100-unit center-to-center range while adding its 90-degree facing arc. The browser preview and authoritative server must use the same range and facing arc.

For radial blasts and persistent fields, effect range is measured from the effect center to the bot center. A bot's outer edge does not extend the blast radius; this keeps shield bearing and damage decisions anchored to the same center point. Phase Strike uses the melee edge-inclusive range rule.

Spawning is an effect (`spawn_entity`). Target labels and capabilities remain in `BotLoadout.js` as schema/UI metadata.

## Effects

- HP: `damage`, `healing`.
- Displacement: `knockback`, `pull`, `movement`, `teleport`, `restore_state`.
- Status/control: `debuff`, `interrupt`.
- Defense: `damage_reduction`, `damage_immunity`, `damage_reflection`.
- World state: `spawn_entity`.

Apply effects in declared order. Add a new effect class only for reusable behavior that existing classes cannot express. Generic executors switch on effect class/subtype, not ability ID.

## Universal successful-damage consequence

After an impact resolves its shield, reduction, immunity, and reflection rules,
the shared combat damage settlement path compares the target bot's HP before
and after resolution. If hostile damage reduces that HP by more than zero, the
target receives universal hit stagger for 300 ms. The mirrored constants are
`HIT_STAGGER_DURATION_MS = 300`, `HIT_STAGGER_MOVEMENT_MULTIPLIER = 0.85`, and
`HIT_STAGGER_ROTATION_MULTIPLIER = 0.85` in the browser and authoritative Java
combat runtimes.

The timer is bot state, not a selectable logic status and not an authored
ability effect. It refreshes with `max(current, 300)` and never stacks. Damage
from a bot, that bot's entities, or attributed damage-over-time statuses
is hostile when it crosses bot slots; blocked, immune, zero, or shield-only
damage is not. Reflected damage uses the reflecting defender as its source, so a
reflection that removes the original attacker's HP can stagger that attacker.
Damage to arena entities never creates bot hit stagger.

Hit stagger and Concussive Shot keep independent timers. Movement uses the
stronger active multiplier: normal `1.00`, hit stagger `0.85`, Concussive slow
`0.60`, and both `0.60`. Hit stagger also multiplies the normal rotation step by
`0.85`; Concussive Shot does not change rotation.

## Shields

`shieldInteraction` defines mode (`block`, `ignore`, or `drain_while_active`), directional arc, charge cost, and prevented effect classes.

Resolve it once per impact, filter the effects, then apply the remainder in order. This supports partial blocks without special cases and prevents attached statuses from landing after their hit was blocked.

## Presentation boundary

Visuals may read contract/state metadata but never determine hits or mutate gameplay. Testing and replay share presentation; Java remains authoritative.

## Change checklist

1. Mirror numeric definitions and contract metadata.
2. Add loadout/target metadata only when required.
3. Connect generic delivery/effect execution.
4. Add the visual separately.
5. Test browser/server metadata parity, shield filtering, and real execution.
