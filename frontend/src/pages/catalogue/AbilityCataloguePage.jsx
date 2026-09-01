import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import { getAbilityCatalogueIcon, getAbilityCatalogueIconLayout } from "../../abilityCatalogueIcons.js";
import { ABILITY_STATS } from "../../gameArena/gameconfig/Abilities.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { abilityStatsForDisplay } from "./abilityStatsPresentation.js";
import { STATUS_EFFECT_GUIDE } from "./statusEffectCatalogue.js";

const ROUNDS = [0, 1, 2, 3];

const ABILITY_TYPE_GUIDE = Object.freeze([
    {
        label: "Melee",
        alias: "Close-range arc",
        description: "An instant attack with no travel time. The target must be within range and inside the attacker's forward-facing angle.",
    },
    {
        label: "Hitscan",
        alias: "Ray",
        description: "An instant line attack. Nothing travels through the arena; the target must intersect the ray from the attacker to its range limit.",
    },
    {
        label: "Projectile",
        alias: "Travelling object",
        description: "A moving object travels through the arena before applying its effect. It can be dodged, and some projectiles can be intercepted or destroyed.",
    },
    {
        label: "Self",
        alias: "Self-targeted",
        description: "The ability applies its effect to the user. Self is independent from whether the status effect is positive or negative.",
    },
    {
        label: "Status Effect",
        alias: "Timed modifier",
        description: "The ability applies a positive or negative status effect. A self-targeted status effect is positive in the current catalogue.",
    },
    {
        label: "Radial",
        alias: "Centered effect",
        description: "The effect resolves around a point or bot instead of following a single line or facing arc.",
    },
    {
        label: "Summon",
        alias: "Ally entity",
        description: "The ability creates a controllable or targetable ally entity that persists in the arena.",
    },
    {
        label: "Zone",
        alias: "Persistent region",
        description: "The ability creates a persistent region in the arena. Zones can damage, control, or otherwise affect bots inside them.",
    },
    {
        label: "Trap",
        alias: "Triggered entity",
        description: "The ability creates an entity that waits for an attack, projectile, or bot contact before resolving.",
    },
]);

const TAG_LABELS = Object.freeze({
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

function statsForAbility(ability) {
    return abilityStatsForDisplay({
        ...ability,
        stats: ABILITY_STATS[ability.id] ?? {},
    });
}

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deliveryDetails(ability) {
    const type = ability.delivery?.type;
    const tag = type === "ray" ? "ray" : type;
    const guide = ABILITY_TYPE_GUIDE.find(({ label }) => label.toLowerCase() === TAG_LABELS[tag]?.toLowerCase());
    if (TAG_LABELS[tag]) return { label: TAG_LABELS[tag], description: guide?.description ?? "The ability applies its effects through the delivery method shown here." };
    return { label: titleCase(type), description: "The ability applies its effects through the delivery method shown here." };
}

function abilityTypeLabels(ability) {
    return (ability.catalogueTags ?? []).map((tag) => TAG_LABELS[tag] ?? titleCase(tag));
}

function playerFacingEffects(ability) {
    const effects = ability.effects.flatMap((effect) => {
        if (effect.type === "spawn_entity") return [];
        if (effect.type === "debuff" && effect.debuff) return [titleCase(effect.debuff)];
        return [titleCase(effect.type)];
    });
    return [...new Set(effects)];
}

export function AbilityModal({
    ability,
    onClose,
    onTestAbility = null,
    overlayClassName = "z-50",
}) {
    const closeButtonRef = useRef(null);
    const dialogRef = useRef(null);
    const stats = statsForAbility(ability);
    const effects = playerFacingEffects(ability).join(" · ");
    const delivery = deliveryDetails(ability);
    const statGroups = stats.reduce((groups, stat) => {
        const previous = groups.at(-1);
        if (stat.section && previous?.section === stat.section) {
            previous.rows.push(stat);
        } else {
            groups.push({ section: stat.section ?? null, rows: [stat] });
        }
        return groups;
    }, []);

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    return (
        <div className={`fixed inset-0 ${overlayClassName} grid place-items-center bg-[#02070de8] p-4 backdrop-blur-sm`} onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ability-modal-title"
                tabIndex={-1}
                className="ability-modal max-h-[92vh] w-full max-w-4xl overflow-y-auto border border-green-400/60 bg-[#202427] text-white shadow-[0_32px_100px_rgba(0,0,0,.72)]"
            >
                <div className="relative overflow-hidden border-b border-slate-700/70 px-6 py-7 sm:px-8">
                    <div className={`ability-modal-glow ability-modal-glow-${ability.round}`} aria-hidden="true" />
                    <div className="relative flex items-start justify-between gap-6">
                        <div>
                            <p className="font-mono text-[10px] font-bold tracking-[.28em] text-green-300">
                                {ability.standard ? "STANDARD" : `ROUND ${ability.round}`} · {ability.kind.toUpperCase()}
                            </p>
                            <h2 id="ability-modal-title" className="mt-2 font-display-action text-4xl uppercase tracking-wide text-white sm:text-5xl">
                                {ability.label}
                            </h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{ability.summary}</p>
                            {onTestAbility && (
                                <button
                                    type="button"
                                    onClick={() => onTestAbility(ability)}
                                    className="arena-toolbar-button arena-toolbar-button--green arena-toolbar-button--inline mt-5"
                                >
                                    TEST ABILITY
                                </button>
                            )}
                        </div>
                        <button
                            ref={closeButtonRef}
                            type="button"
                            onClick={onClose}
                            aria-label={`Close ${ability.label} details`}
                            className="modal-close-button"
                        >
                            <span aria-hidden="true">×</span>
                        </button>
                    </div>
                </div>

                <div className="grid gap-7 px-6 py-7 sm:px-8 lg:grid-cols-[1.35fr_.65fr]">
                    <div>
                        <h3 className="font-mono text-[10px] font-bold tracking-[.24em] text-slate-400">COMBAT STATS</h3>
                        <dl className="mt-4 columns-1 gap-x-10 sm:columns-2">
                            {statGroups.map((group, groupIndex) => (
                                <div key={`${group.section ?? "stat"}-${groupIndex}`} className="mb-3 break-inside-avoid">
                                    {group.section && <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[.16em] text-green-300">{group.section}</p>}
                                    {group.rows.map((stat) => (
                                        <div key={`${stat.label}-${stat.value}`} className="flex items-baseline justify-between gap-4 border-b border-slate-700/70 py-2.5">
                                            <dt className="text-xs text-slate-500">{stat.label}:</dt>
                                            <dd className="text-right font-mono text-sm font-bold text-slate-100">{stat.value}</dd>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </dl>
                    </div>

                    <aside className="border border-slate-700/70 bg-slate-950/35 p-5">
                        <h3 className="font-mono text-[10px] font-bold tracking-[.24em] text-green-300">MECHANICS</h3>
                        <dl className="mt-4 space-y-5">
                            <div>
                                <dt className="text-xs text-slate-500">Delivery</dt>
                                <dd className="mt-1 text-sm font-semibold text-slate-200">{delivery.label}</dd>
                                <p className="mt-1 text-xs leading-5 text-slate-400">{delivery.description}</p>
                            </div>
                            <div>
                                <dt className="text-xs text-slate-500">Effects</dt>
                                <dd className="mt-1 text-sm leading-6 text-slate-200">{effects || "None"}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-slate-500">Shield interaction</dt>
                                <dd className="mt-1 text-sm font-semibold text-slate-200">{titleCase(ability.shieldInteraction?.mode)}</dd>
                            </div>
                        </dl>
                    </aside>
                </div>
            </section>
        </div>
    );
}

export default function AbilityCataloguePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const abilityFromRoute = new URLSearchParams(location.search).get("ability");
    const abilityFromRouteDefinition = ALL_ABILITY_DEFINITIONS.find(({ id }) => id === abilityFromRoute) ?? null;
    const [selectedAbility, setSelectedAbility] = useState(abilityFromRouteDefinition);

    useEffect(() => {
        setSelectedAbility(abilityFromRouteDefinition);
    }, [abilityFromRouteDefinition]);

    const selectAbility = (ability) => {
        setSelectedAbility(ability);
        navigate(`/ability-catalogue?ability=${encodeURIComponent(ability.id)}`, { replace: true });
    };

    const closeAbility = () => {
        setSelectedAbility(null);
        if (abilityFromRoute) navigate("/ability-catalogue", { replace: true });
    };

    const testAbility = (ability) => {
        navigate(`/practice?ability=${encodeURIComponent(ability.id)}`);
    };

    return (
        <main className="ability-catalogue min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="abilities" />

            <header className="relative overflow-hidden border-b border-slate-800/80 px-5 py-14 sm:px-8 sm:py-20">
                <div className="ability-hero-glow" aria-hidden="true" />
                <div className="relative mx-auto max-w-7xl">
                    <p className="font-mono text-[10px] font-bold tracking-[.32em] text-green-300">COMBAT DATABASE</p>
                    <h1 className="mt-3 font-display-action text-5xl uppercase tracking-wide text-white sm:text-7xl">Ability List</h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
                        Explore abilities here. Click one to inspect its details.
                    </p>
                </div>
            </header>

            <div className="mx-auto max-w-7xl space-y-12 px-5 py-12 sm:px-8 sm:py-16">
                <section aria-labelledby="status-effects-title" className="border border-slate-700/70 bg-slate-950/30 p-5 sm:p-6">
                    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-700/60 pb-3">
                        <div>
                            <p className="font-mono text-[9px] font-bold tracking-[.28em] text-green-300">COMBAT EFFECTS</p>
                            <h2 id="status-effects-title" className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white">Status effects</h2>
                        </div>
                        <span className="font-mono text-[9px] tracking-widest text-slate-500">HOW THEY FUNCTION</span>
                    </div>
                    <div className="mt-4 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                        {STATUS_EFFECT_GUIDE.map((status) => (
                            <article key={status.id} className="border border-slate-700/70 bg-[#07131f] px-3 py-2.5">
                                <h3 className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-slate-100">{status.label}</h3>
                                <p className="mt-1 text-[11px] leading-4 text-slate-400">{status.description}</p>
                            </article>
                        ))}
                    </div>
                </section>

                {ROUNDS.map((round) => {
                    const roundAbilities = ALL_ABILITY_DEFINITIONS.filter((ability) => ability.round === round);
                    const standard = round === 0;
                    return (
                        <section key={round} aria-labelledby={`round-${round}-title`}>
                            <div className="mb-6 flex items-end justify-between gap-6 border-b border-slate-700/60 pb-3">
                                <div>
                                    <p className="font-mono text-[9px] font-bold tracking-[.28em] text-slate-500">{standard ? "EVERY BOT" : `DRAFT TIER 0${round}`}</p>
                                    <h2 id={`round-${round}-title`} className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white">
                                        {standard ? "Standard abilities" : `Round ${round}`}
                                    </h2>
                                </div>
                                <span className="font-mono text-[10px] tracking-widest text-green-300">{roundAbilities.length} {standard ? "ALWAYS EQUIPPED" : "ABILITIES"}</span>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {roundAbilities.map((ability, index) => {
                                    const iconPath = getAbilityCatalogueIcon(ability.id);
                                    const isSelected = selectedAbility?.id === ability.id;
                                    return (
                                    <button
                                        key={ability.id}
                                        type="button"
                                        onClick={() => selectAbility(ability)}
                                        className={`ability-card ability-card-${round} group relative min-h-56 overflow-hidden rounded-none border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 ${isSelected ? "ability-card-selected" : ""}`}
                                        aria-label={`View ${ability.label} stats`}
                                        aria-pressed={isSelected}
                                    >
                                        {iconPath && (
                                            <img
                                                src={iconPath}
                                                alt=""
                                                aria-hidden="true"
                                                className={`ability-card-art ability-card-art-${getAbilityCatalogueIconLayout(ability.id)}`}
                                                onError={(event) => {
                                                    event.currentTarget.hidden = true;
                                                }}
                                            />
                                        )}
                                        <span className="ability-card-gradient" aria-hidden="true" />
                                        <span className="absolute right-4 top-2 font-display-action text-6xl text-white/[.035]" aria-hidden="true">
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <span className="ability-card-content absolute inset-x-0 bottom-0 border-t border-white/10 px-5 py-4">
                                            <span className="block font-display-action text-xl uppercase tracking-wider text-white">{ability.label}</span>
                                            <span className="mt-2 flex flex-wrap gap-1.5">
                                                <span className="font-mono text-[8px] font-bold tracking-[.16em] text-green-300/70">{ability.kind.toUpperCase()}</span>
                                                {abilityTypeLabels(ability).map((type) => (
                                                    <span key={type} className="border border-green-400/40 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[.12em] text-green-300/80">
                                                        {type}
                                                    </span>
                                                ))}
                                            </span>
                                        </span>
                                    </button>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>

            {selectedAbility && <AbilityModal ability={selectedAbility} onClose={closeAbility} onTestAbility={testAbility} />}
        </main>
    );
}
