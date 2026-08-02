# Adding an Authoritative Backend Ability or Move

Spring owns rated `duel-v1` results. Mirror the browser contract, but independently validate and execute the submitted structured brain.

Start with [Adding an Ability or Move](ADDING_AN_ABILITY_OR_MOVE.md) and [Ability Effect Contract](ABILITY_EFFECT_CONTRACT.md).

## Definitions and draft identity

- `simulation/combat/Abilities.java` and `Moves.java`: numeric definitions.
- `CombatRules.java`: shared simulator access.
- `AbilityContracts.java`: delivery, ordered effects, and shield policy.
- `CombatCatalog.java`: ruleset selection and boundary compatibility only.

Match browser IDs, milliseconds, arena units, ranges/arcs, damage rounding, resources, and compact loadout code. Update the round pool and enforce cumulative picks, issued offers, selection limits, and stat budget on the server. Timeout picks must come from the same deterministic offer list.

## Hostile-input validation

Update `BotSubmissionValidationService.java` allowlists and ownership checks for abilities, actions, preparing abilities, variables, targets, offsets, coordinates, identifiers, and payload bounds.

Reject actions outside the loadout, targets the loadout cannot produce, preparing queries for instant abilities, and malformed/out-of-range data. Never trust client-selected actions, targets, collision, damage, seeds, or outcomes.

## Simulation flow

`DuelSimulationService.java` should:

1. select a normalized action from the brain;
2. resolve its live target and offsets;
3. check ownership, readiness, resources, preparation, silence, and target existence;
4. activate it and record state;
5. apply an immediate effect or spawn an entity;
6. tick effects/entities in deterministic order;
7. settle accumulated HP changes and emit replay state.

Use generic variables, targets, deliveries, and effects where available. Keep the service as orchestrator; persistent behavior belongs in the ECS, not a second simulation loop.

## Persistent entities

- `ArenaEntity.java`: deterministic transform, motion, lifetime, collider, owner, optional HP, and phase state.
- `AbilityEntityFactory.java`: initial state only; no targeting, damage, or ticking.
- `AbilityEntityCombatant.java`: minimal reusable fighter interface.
- `AbilityEntitySystem.java`: deterministic lifecycle, collision, effects, phase changes, chain reactions, and removal.
- `ArenaBounds.java`: shared clamping and expiry bounds.

Resolve `shieldInteraction` once per impact, then apply remaining effects in declared order. Specify friendly-fire eligibility, swept versus point collision, impact timing, status refresh/stack rules, and rounding. Settle simultaneous damage and healing as one net HP change.

## Replay

Emit state, not client-side gameplay instructions: stable entity ID/type/owner, position, needed motion/rotation, size, phase, timer/lifetime, HP, and fighter preparation/cooldown/resource/status fields. Include only timing needed to reconstruct presentation.

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
