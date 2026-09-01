/** Static decorative artwork generated from the arena presentation assets. */
const lockOnIconUrl = new URL("./assets/arena/abilities/support/crosshair.png", import.meta.url).href;

export const ABILITY_CATALOGUE_ICONS = Object.freeze({
    slash: "/assets/ability-list/icons/swing.webp",
    gun: "/assets/ability-list/icons/fire_gun.webp",
    grenade: "/assets/ability-list/icons/throw_grenade.webp",
    fireball: "/assets/ability-list/icons/shoot_fireball.webp",
    stun: "/assets/ability-list/icons/stun.webp",
    heavy_slash: "/assets/ability-list/icons/heavy_slash.webp",
    repulsor_burst: "/assets/ability-list/icons/repulsor_burst.webp",
    concussive_shot: "/assets/ability-list/icons/concussive_shot.webp",
    basic_heal: "/assets/ability-list/icons/basic_heal.webp",
    proximity_mine: "/assets/ability-list/icons/proximity_mine.webp",
    pistol: "/assets/ability-list/icons/pistol_shot.webp",
    rail_shot: "/assets/ability-list/icons/rail_shot.webp",
    gravity_grenade: "/assets/ability-list/icons/gravity_grenade.webp",
    silence_pulse: "/assets/ability-list/icons/silence_pulse.webp",
    reactive_armor: "/assets/ability-list/icons/reactive_armor.webp",
    hunter_drone: "/assets/ability-list/icons/hunter_drone.webp",
    wind_burst: "/assets/ability-list/icons/wind_burst.webp",
    dash: "/assets/ability-list/icons/dash.webp",
    lock_on: lockOnIconUrl,
    temporal_rewind: "/assets/ability-list/icons/temporal_rewind.webp",
    orbital_strike: "/assets/ability-list/icons/orbital_strike.webp",
    absolute_guard: "/assets/ability-list/icons/absolute_guard.webp",
    null_zone: "/assets/ability-list/icons/null_zone.webp",
    phase_strike: "/assets/ability-list/icons/phase_strike.webp",
    frost_ring: "/assets/ability-list/icons/frost_ring.webp",
    singularity: "/assets/ability-list/icons/singularity%20%282%29.webp",
    tether_bolt: "/assets/ability-list/icons/tether_bolt.webp",
    static_snare: "/assets/ability-list/icons/static_snare.webp",
    disruptor_dart: "/assets/ability-list/icons/disruptor_dart.webp",
    repeller_drone: "/assets/ability-list/icons/repeller_drone.webp",
    vampiric_beam: "/assets/ability-list/icons/vampiric_beam.webp",
    overclock: "/assets/ability-list/icons/overclock.webp",
});

export const ABILITY_CATALOGUE_ICON_LAYOUTS = Object.freeze({
    tether_bolt: "wide",
    vampiric_beam: "wide",
    disruptor_dart: "wide",
    static_snare: "square",
    overclock: "square",
    singularity: "square",
    frost_ring: "square",
});

export function getAbilityCatalogueIcon(abilityId) {
    const name = abilityIdentity(abilityId)?.name;
    return name == null ? null : ABILITY_CATALOGUE_ICONS[name] ?? null;
}

export function getAbilityCatalogueIconLayout(abilityId) {
    const name = abilityIdentity(abilityId)?.name;
    return ABILITY_CATALOGUE_ICON_LAYOUTS[name] ?? "default";
}
import { abilityIdentity } from "./gameArena/gameconfig/AbilityRegistry.js";
