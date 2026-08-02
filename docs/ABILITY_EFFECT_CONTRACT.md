# Ability Effect Contract

Each selectable ability has one mirrored browser/server contract:

```text
delivery          how effects reach a target
effects[]         ordered game-state changes
shieldInteraction which effects a shield prevents and at what cost
```

Browser: `frontend/src/beta/combat/AbilityContracts.js`. Server: `server/src/main/java/com/example/botfight/simulation/combat/AbilityContracts.java`. Numeric tuning lives in `Abilities` and `Moves`; values calculated during execution are marked `runtimeComputed` server-side.

## Delivery

Current types: `self`, `melee`, `ray`, `projectile`, `radial`, `field`, `trap`, `summon`, and `teleport`. Delivery owns travel, collision, and target timing. It does not imply damage or interpolation.

Spawning is an effect (`spawn_entity`). Target labels and capabilities remain in `BotLoadout.js` as schema/UI metadata.

## Effects

- HP: `damage`, `healing`.
- Displacement: `knockback`, `pull`, `movement`, `teleport`, `restore_state`.
- Status/control: `debuff`, `interrupt`.
- Defense: `damage_reduction`, `damage_immunity`, `damage_reflection`.
- World state: `spawn_entity`.

Apply effects in declared order. Add a new effect class only for reusable behavior that existing classes cannot express. Generic executors switch on effect class/subtype, not ability ID.

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
