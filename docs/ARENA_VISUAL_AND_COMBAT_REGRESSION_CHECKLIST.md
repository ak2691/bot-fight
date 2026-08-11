# Arena visual and combat regression checklist

Use this when an ability, entity, replay field, or bot visual changes.

## Transforms

- Do not CSS-transition normalized bot rotation; `359 -> 0` may spin the long way.
- Teleports and Phase Strike are discrete; do not reuse movement interpolation.
- Do not animate `transform` on the element that owns centering/positioning. Use a stationary wrapper and animate a child.
- Centered pulses begin at the caster center and expand outward.

## Timed visuals

- Rays derive opacity from remaining visual time.
- Melee sweeps derive pose from active time and render from first through final active frame.
- Keep activation visuals separate from gameplay-effect duration/status icons.
- Temporal Rewind keeps saved activation coordinates; its completion visual occurs there.

## Combat state

- Each source in a tick reads the latest accumulated bot state, never a stale pre-hit snapshot.
- DOT, direct damage, projectiles, explosions, reflection, and healing settle as one net HP result.
- Arena bots show a compact `hp / maxHp` bar; numeric HP belongs in the side panel.
- Timed silence and Null Zone presence are distinct; clear zone presence after leaving every active zone.

## Required surfaces and tests

Verify Bot Room for both slots, match testing, and authoritative replay. For each changed action, run an `ALWAYS` brain through the real executor and add focused timing/state tests. Picker or schema coverage alone is insufficient.
