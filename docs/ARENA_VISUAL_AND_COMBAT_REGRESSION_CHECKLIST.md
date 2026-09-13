# Arena visual and combat regression checklist

Use this when an ability, entity, replay field, or bot visual changes.

## Transforms

- Do not CSS-transition normalized bot rotation; `359 -> 0` may spin the long way.
- Teleports and Phase Strike are discrete; do not reuse movement interpolation.
- Do not animate `transform` on the element that owns centering/positioning. Use a stationary wrapper and animate a child.
- Centered pulses begin at the caster center and expand outward.

## Timed visuals

- Phase-bound visuals belong to the entity/phase view, follow its transform, and
  end when that visual phase ends; standalone event visuals are independent
  instances keyed by event occurrence and remain at their spawn transform until
  their own expiry.
- Once spawned, each transient visual owns its presentation start and expiry;
  later gameplay snapshots, source removal, or repeated events must not replace
  its `visualMs` countdown.
- Rays derive opacity from remaining visual time.
- Melee sweeps derive pose from active time and render from first through final active frame.
- Keep activation visuals separate from gameplay-effect duration/status icons.
- Temporal Rewind keeps saved activation coordinates; its completion visual occurs there.

## Collision schedules

- `once` effects are checked when the phase event checker starts; a target entering an explosion later is not retroactively hit.
- `continuous` collision effects check every fixed simulation tick; projectile `targetPolicy: once` remains a per-target ledger rule.
- `repeat` effects check at scheduled cadence; Orbital Strike's 500 ms repeats do not create a continuously active hitbox.
- Event keys identify what is checked and `schedule` identifies when; target policy remains a separate target-selection rule.
- Root entity lifetime, phase duration, and event-visual duration are tested independently; a 100 ms explosion may keep a 300–400 ms standalone visual alive.

## Combat state

- Each source in a tick reads the latest accumulated bot state, never a stale pre-hit snapshot.
- DOT, direct damage, projectiles, explosions, reflection, and healing settle as one net HP result.
- Arena bots show a compact `hp / maxHp` bar; numeric HP belongs in the side panel.
- Timed silence and Null Zone presence are distinct; clear zone presence after leaving every active zone.

## Required surfaces and tests

Verify Bot Room for both slots, match testing, and authoritative replay. For each changed action, run an `ALWAYS` brain through the real executor and add focused timing/state tests. Picker or schema coverage alone is insufficient.
