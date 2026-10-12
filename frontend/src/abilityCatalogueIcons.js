/** Static decorative artwork generated from the arena presentation assets. */

export const ABILITY_CATALOGUE_ICONS = Object.freeze({
    slash: "/assets/ability-list/icons/swing.webp",
    gun: "/assets/ability-list/icons/fire_gun.webp",
    grenade: "/assets/ability-list/icons/throw_grenade.webp",
    fireball: "/assets/ability-list/icons/shoot_fireball.webp",
    stun: "/assets/ability-list/icons/stun.webp",
    repelling_blast: "/assets/ability-list/icons/repulsor_burst.webp",
    silence_pulse: "/assets/ability-list/icons/silence_pulse.webp",
    hunter_drone: "/assets/ability-list/icons/hunter_drone.webp",
    wind_burst: "/assets/ability-list/icons/wind_burst.webp",
    dash: "/assets/ability-list/icons/dash.webp",
    rewind: "/assets/ability-list/icons/temporal_rewind.webp",
    orbital_strike: "/assets/ability-list/icons/orbital_strike.webp",
    phase_strike: "/assets/ability-list/icons/phase_strike.webp",
    frost_ring: "/assets/ability-list/icons/frost_ring.webp",
    singularity: "/assets/ability-list/icons/singularity.webp",
    tether_bolt: "/assets/ability-list/icons/tether_bolt.webp",
    snare_bomb: "/assets/ability-list/icons/static_snare.webp",
    disruptor_dart: "/assets/ability-list/icons/disruptor_dart.webp",
    vampiric_beam: "/assets/ability-list/icons/vampiric_beam.webp",
});

export const ABILITY_CATALOGUE_ICON_LAYOUTS = Object.freeze({
    tether_bolt: "wide",
    vampiric_beam: "wide",
    disruptor_dart: "wide",
    snare_bomb: "square",
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
import { abilityIdentity } from "../../shared/engine/gameconfig/AbilityRegistry.js";
