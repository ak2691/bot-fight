# Ability demonstration videos

Place one MP4 video here for each ability or named move.

## Naming scheme

Use the ability's canonical ID exactly as it appears in
`frontend/src/beta/loadout/BotLoadout.js`:

```text
<ability-id>.mp4
```

Examples:

```text
swing.mp4
throw_grenade.mp4
reactive_armor.mp4
orbital_strike.mp4
phase_strike.mp4
```

The Ability List automatically looks for:

```text
/assets/ability-list/videos/<ability-id>.mp4
```

Recommended format: H.264 MP4, 16:9, 1280x720 or 1920x1080, muted, and
trimmed so the end transitions cleanly back to the beginning.

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
repair_pulse
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
micro_dash
```

Round 3:

```text
temporal_rewind
orbital_strike
absolute_guard
null_zone
phase_strike
```
