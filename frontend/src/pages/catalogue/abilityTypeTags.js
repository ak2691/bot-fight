// Shared ability type tags (labels and colours) for the catalogue and the ability draft.

export const TAG_LABELS = Object.freeze({
    melee: "Melee",
    ray: "Hitscan",
    projectile: "Projectile",
    self: "Self",
    "status-effect": "Status Effect",
    radial: "Radial",
    summon: "Summon",
    zone: "Zone",
    trap: "Trap",
});

export const HIDDEN_ABILITY_LIST_TAGS = new Set(["status-effect"]);

export function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function abilityTypeLabels(ability) {
    return (ability.catalogueTags ?? [])
        .filter((tag) => !HIDDEN_ABILITY_LIST_TAGS.has(tag))
        .map((tag) => TAG_LABELS[tag] ?? titleCase(tag));
}

export const TYPE_TAG_STYLES = Object.freeze({
    melee: "border-rose-400/40 bg-rose-500/10 text-rose-300",
    hitscan: "border-cyan-400/40 bg-cyan-500/10 text-cyan-300",
    projectile: "border-violet-400/40 bg-violet-500/10 text-violet-300",
    charges: "border-amber-400/40 bg-amber-500/10 text-amber-300",
    "hp charges": "border-amber-400/40 bg-amber-500/10 text-amber-300",
    self: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300/90",
    zone: "border-teal-500/30 bg-teal-500/10 text-teal-300/90",
    trap: "border-orange-500/30 bg-orange-500/10 text-orange-300/90",
    summon: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300/90",
    radial: "border-sky-500/30 bg-sky-500/10 text-sky-300/90",
});
export const DEFAULT_TYPE_TAG_STYLE = "border-slate-500/40 bg-slate-500/10 text-slate-300";


export function typeTagClass(type) {
    return TYPE_TAG_STYLES[String(type).toLowerCase()] ?? DEFAULT_TYPE_TAG_STYLE;
}

export const STATUS_CHIP_STYLES = Object.freeze({
    burn: "border-orange-500/50 text-orange-300",
    bleed: "border-rose-500/50 text-rose-300",
    stun: "border-amber-400/50 text-amber-300",
    slow: "border-sky-400/50 text-sky-300",
    shock: "border-yellow-400/50 text-yellow-300",
    silence: "border-violet-400/50 text-violet-300",
    overclock: "border-emerald-400/50 text-emerald-300",
});
export const DEFAULT_STATUS_CHIP_STYLE = "border-cyan-500/40 text-cyan-300";
export const COMBAT_CHIP_STYLE = "border-[#2d353c] text-slate-300";
