# Adding an Authoritative Backend Ability or Move

Spring owns rated `duel-v1` results. Mirror the browser contract, but independently validate and execute the submitted structured brain.

Start with [Adding an Ability or Move](ADDING_AN_ABILITY_OR_MOVE.md) and [Ability Effect Contract](ABILITY_EFFECT_CONTRACT.md).

## Definitions and draft identity

- `simulation/gameconfig/AbilityRegistry.java`: permanent positive numeric IDs and the only server-side ID/name mapping. Never derive IDs from catalog position or reuse a retired ID.
- `simulation/gameconfig/Abilities.java`: numeric definitions for all abilities.
- `simulation/gameconfig/GameConfig.java`: shared duel configuration access.
- `simulation/gameconfig/AbilityContracts.java`: delivery, ordered effects, and shield policy.
- `simulation/gameconfig/GameConfigCatalog.java`: active ruleset selection.

Match browser IDs, milliseconds, arena units, ranges/arcs, damage rounding, resources, and compact loadout code. Runtime definitions, actions, state maps, entities, DTOs, and replay fields use the numeric ID. Ability names are limited to presentation metadata and explicit legacy migration through `LegacyAbilityPayloadMigration`. Update the round pool and enforce cumulative picks, issued offers, selection limits, and stat budget on the server. Timeout picks must come from the same deterministic offer list.

## Hostile-input validation

Update `BotSubmissionValidationService.java` allowlists and ownership checks for abilities, actions, preparing abilities, variables, targets, offsets, coordinates, identifiers, and payload bounds.

Reject actions outside the loadout, targets the loadout cannot produce, preparing queries for instant abilities, and unknown, fractional, duplicate, or out-of-range ability IDs. Never trust client-selected actions, targets, collision, damage, seeds, or outcomes.

## Simulation flow

`DuelSimulationService.java` remains the fixed-step coordinator. Its focused
services own the corresponding decisions and state transitions:

- `ConditionResolutionService`: normalized conditions, state variables, and
  target resolution;
- `ActionExecutionService`: readiness/resources, preparation, movement, and
  immediate or entity-backed actions;
- `BotStateService`: initialization, timed bot effects, damage/healing,
  and same-tick settlement;
- `ProjectileSimulationService`: generic short-lived projectile motion,
  collision, explosions, and contract-declared projectile effects;
- `TargetingService` and `ReplayMappingService`: target offsets and replay
  state conversion.

The coordinator should:

1. select a normalized action from the brain;
2. resolve its live target and offsets;
3. ask the action service to check ownership, readiness, resources, preparation,
   silence, and target existence;
4. activate it and record state;
5. apply an immediate effect or spawn an entity;
6. tick effects/entities in deterministic order;
7. ask the bot-state service to settle accumulated HP changes and emit replay
   state through the replay mapper.

Use generic variables, targets, deliveries, and effects where available. Keep the service as orchestrator; persistent behavior belongs in the ECS, not a second simulation loop.

## Persistent entities

- `ArenaEntity.java`: deterministic transform, motion, lifetime, collider, owner, optional HP, and phase state.
- `AbilityEntityFactory.java`: initial state only; no targeting, damage, or ticking.
- `AbilityEntityBot.java`: minimal reusable bot interface.
- `AbilityEntitySystem.java`: deterministic lifecycle, collision, effects, phase changes, chain reactions, and removal.
- `ArenaBounds.java`: shared clamping and expiry bounds.

Resolve `shieldInteraction` once per impact, then apply remaining effects in declared order. Specify friendly-fire eligibility, swept versus point collision, impact timing, status refresh/stack rules, and rounding. Settle simultaneous damage and healing as one net HP change.

## Replay

Emit state, not client-side gameplay instructions: stable entity ID/type/owner, position, needed motion/rotation, size, phase, timer/lifetime, HP, and bot preparation/cooldown/resource/status fields. Include only timing needed to reconstruct presentation.

## Regression tests

- validation allowlists, ownership, target IDs, offsets, and preparation rules;
- an `ALWAYS` action reaching real activation/effect;
- both slots where symmetry matters;
- readiness, resource, cooldown, preparation, and missing-target fallthrough;
- deterministic collision, same-tick settlement, KO/timeout, and replay fields;
- ECS factory, lifetime, interaction, HP, removal, and chain-reaction tests;
- repeated runs producing the same result.

Run `.\mvnw.cmd test` from `server`.

An ability is authoritative only when it validates, selects, activates, executes, appears in replay, and repeats deterministically.
