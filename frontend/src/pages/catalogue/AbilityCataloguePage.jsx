import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import { getAbilityCatalogueIcon } from "../../abilityCatalogueIcons.js";
import { ABILITY_STATS } from "../../gameArena/gameconfig/Abilities.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import { abilityStatsForDisplay } from "./abilityStatsPresentation.js";

const ROUNDS = [0, 1, 2, 3];

const DEFENSIVE_ABILITIES = new Set([2, 16, 23]);

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
        label: "Entity",
        alias: "Additional tag",
        description: "The ability leaves an object, zone, trap, or summon in the arena. Entity is not exclusive with projectile: a grenade is both a projectile and an entity.",
    },
    {
        label: "Area / field",
        alias: "Radial, zone, or trap",
        description: "The effect applies to a region instead of one direct target. Some regions resolve immediately; fields and traps remain active for a duration.",
    },
    {
        label: "Armor / defense",
        alias: "Self-targeted effect",
        description: "A defensive ability changes what happens to its user, such as reducing, reflecting, blocking, or ignoring hostile effects. It is not a hitbox type.",
    },
]);

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
    if (type === "ray") return { label: "Hitscan", description: ABILITY_TYPE_GUIDE[1].description };
    if (type === "melee") return { label: "Melee", description: ABILITY_TYPE_GUIDE[0].description };
    if (type === "projectile") return { label: "Projectile", description: ABILITY_TYPE_GUIDE[2].description };
    if (["radial", "field", "trap"].includes(type)) return { label: titleCase(type), description: ABILITY_TYPE_GUIDE[4].description };
    if (DEFENSIVE_ABILITIES.has(ability.id)) return { label: "Self / Defense", description: ABILITY_TYPE_GUIDE[5].description };
    return { label: titleCase(type), description: "The ability applies its effects through the delivery method shown here." };
}

function abilityTypeLabels(ability) {
    const labels = [deliveryDetails(ability).label];
    if (ability.effects.some((effect) => effect.type === "spawn_entity")) labels.push("Entity");
    if (DEFENSIVE_ABILITIES.has(ability.id)) labels.push("Defense");
    return [...new Set(labels)];
}

function playerFacingEffects(ability) {
    const effects = ability.effects.flatMap((effect) => {
        if (effect.type === "spawn_entity") return [];
        if (effect.type === "debuff" && effect.debuff) return [titleCase(effect.debuff)];
        return [titleCase(effect.type)];
    });
    return [...new Set(effects)];
}

export function AbilityModal({ ability, onClose, onTestAbility }) {
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#02070de8] p-4 backdrop-blur-sm" onMouseDown={(event) => {
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
                                    className="mt-5 min-h-11 border border-green-400/80 bg-green-950/45 px-5 py-3 font-mono text-[10px] font-bold tracking-[.2em] text-green-100 transition hover:border-green-200 hover:bg-green-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200"
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
                            className="grid h-11 min-h-11 min-w-11 w-11 flex-none place-items-center rounded-none border border-green-400/40 bg-slate-950/60 p-0 text-xl text-slate-300 hover:border-green-300/70 hover:text-white"
                        >
                            ×
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
        navigate(`/beta?ability=${encodeURIComponent(ability.id)}`);
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
                        Explore the two standard abilities every bot receives and every move available in the three-round draft. Select one to inspect its current arena stats.
                    </p>
                </div>
            </header>

            <div className="mx-auto max-w-7xl space-y-16 px-5 py-12 sm:px-8 sm:py-16">
                <section aria-labelledby="ability-types-title" className="border border-slate-700/70 bg-slate-950/30 p-6 sm:p-8">
                    <div className="max-w-3xl">
                        <p className="font-mono text-[9px] font-bold tracking-[.28em] text-green-300">HOW TO READ THE LIST</p>
                        <h2 id="ability-types-title" className="mt-2 font-display-action text-3xl uppercase tracking-wider text-white">Ability types</h2>
                        <p className="mt-3 text-sm leading-6 text-slate-400">
                            Delivery describes how an effect reaches a target. Entity and Defense are additional tags: they describe what the ability leaves behind or how it changes incoming effects.
                        </p>
                    </div>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {ABILITY_TYPE_GUIDE.map((type) => (
                            <div key={type.label} className="border border-slate-700/70 bg-[#07131f] p-4">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <h3 className="font-mono text-xs font-bold uppercase tracking-[.16em] text-slate-100">{type.label}</h3>
                                    <span className="font-mono text-[9px] uppercase tracking-wider text-green-300/80">{type.alias}</span>
                                </div>
                                <p className="mt-3 text-xs leading-5 text-slate-400">{type.description}</p>
                            </div>
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
                                                className="ability-card-art"
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
