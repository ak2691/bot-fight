# Ability List poster images

Place one WebP poster image here for each ability or named move. The image
appears on its Ability List card.

## Naming scheme

Use the ability's canonical ID exactly as it appears in
`frontend/src/beta/loadout/BotLoadout.js`:

```text
<ability-id>.webp
```

Examples:

```text
swing.webp
throw_grenade.webp
reactive_armor.webp
orbital_strike.webp
phase_strike.webp
```

The Ability List automatically looks for:

```text
/assets/ability-list/posters/<ability-id>.webp
```

Recommended format: WebP, 16:9, 1280x720 or larger. Keep the important action
near the center so the card's title band does not cover it.

## Canonical IDs by round

Round 1:

```text
swing
block
dash
fire_gun
throw_grenade
shoot_fireball
stun
heavy_slash
repulsor_burst
concussive_shot
basic_heal
proximity_mine
quick_jab
pistol_shot
```

Round 2:

```text
rail_shot
gravity_grenade
silence_pulse
reactive_armor
hunter_drone
thrust
dash
```

Round 3:

```text
temporal_rewind
orbital_strike
absolute_guard
null_zone
phase_strike
```
