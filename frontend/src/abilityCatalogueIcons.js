/** Static decorative artwork generated from the arena presentation assets. */
const lockOnIconUrl = new URL("./assets/arena/abilities/support/crosshair.png", import.meta.url).href;

export const ABILITY_CATALOGUE_ICONS = Object.freeze({
    swing: "/assets/ability-list/icons/swing.png",
    fire_gun: "/assets/ability-list/icons/fire_gun.png",
    throw_grenade: "/assets/ability-list/icons/throw_grenade.png",
    shoot_fireball: "/assets/ability-list/icons/shoot_fireball.png",
    stun: "/assets/ability-list/icons/stun.png",
    heavy_slash: "/assets/ability-list/icons/heavy_slash.png",
    repulsor_burst: "/assets/ability-list/icons/repulsor_burst.png",
    concussive_shot: "/assets/ability-list/icons/concussive_shot.png",
    basic_heal: "/assets/ability-list/icons/basic_heal.png",
    proximity_mine: "/assets/ability-list/icons/proximity_mine.png",
    pistol_shot: "/assets/ability-list/icons/pistol_shot.png",
    rail_shot: "/assets/ability-list/icons/rail_shot.png",
    gravity_grenade: "/assets/ability-list/icons/gravity_grenade.png",
    silence_pulse: "/assets/ability-list/icons/silence_pulse.png",
    reactive_armor: "/assets/ability-list/icons/reactive_armor.png",
    hunter_drone: "/assets/ability-list/icons/hunter_drone.png",
    wind_burst: "/assets/ability-list/icons/wind_burst.png",
    dash: "/assets/ability-list/icons/dash.png",
    lock_on: lockOnIconUrl,
    temporal_rewind: "/assets/ability-list/icons/temporal_rewind.png",
    orbital_strike: "/assets/ability-list/icons/orbital_strike.png",
    absolute_guard: "/assets/ability-list/icons/absolute_guard.png",
    null_zone: "/assets/ability-list/icons/null_zone.png",
    phase_strike: "/assets/ability-list/icons/phase_strike.png",
    frost_ring: "/assets/ability-list/icons/frost_ring.png",
    singularity: "/assets/ability-list/icons/singularity%20%282%29.png",
    tether_bolt: "/assets/ability-list/icons/tether_bolt.png",
    static_snare: "/assets/ability-list/icons/static_snare.png",
    disruptor_dart: "/assets/ability-list/icons/disruptor_dart.png",
    repeller_drone: "/assets/ability-list/icons/repeller_drone.png",
    siphon_lance: "/assets/ability-list/icons/siphon_lance.png",
    overclock: "/assets/ability-list/icons/overclock.png",
});

export const ABILITY_CATALOGUE_ICON_LAYOUTS = Object.freeze({
    tether_bolt: "wide",
    siphon_lance: "wide",
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
