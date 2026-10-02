import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import BackToTopButton from "../../components/BackToTopButton.jsx";
import { getAbilityCatalogueIcon, getAbilityCatalogueIconLayout } from "../../abilityCatalogueIcons.js";
import { ABILITY_STATS } from "../../gameArena/gameconfig/Abilities.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    abilityEffectChips,
    abilityHighlights,
    abilityPhaseSteps,
    abilityStatGroups,
} from "./abilityStatsPresentation.js";
import { EFFECT_GUIDE } from "./statusEffectCatalogue.js";
import { useSectionSpy } from "./useSectionSpy.js";
import {
    COMBAT_CHIP_STYLE,
    DEFAULT_STATUS_CHIP_STYLE,
    STATUS_CHIP_STYLES,
    TAG_LABELS,
    abilityTypeLabels,
    titleCase,
    typeTagClass,
} from "./abilityTypeTags.js";

const ROUNDS = [0, 1, 2, 3];

const ABILITY_TYPE_GUIDE = Object.freeze([
    {
        label: "Melee",
        alias: "Close-range",
        description: "An instant close-ranged attack.",
    },
    {
        label: "Hitscan",
        alias: "Ray",
        description: "An instant ray.",
    },
    {
        label: "Projectile",
        alias: "Travelling object",
        description: "A moving object travels through the arena for some duration.",
    },
    {
        label: "Self",
        alias: "Self-targeted",
        description: "The ability applies its effect to the user.",
    },
    {
        label: "Status Effect",
        alias: "Timed modifier",
        description: "The ability applies a positive or negative status effect..",
    },
    {
        label: "Radial",
        alias: "Centered effect",
        description: "The effect starts from the center of some point or bot and applies its effect radially outward.",
    },
    {
        label: "Summon",
        alias: "Logical Entity",
        description: "The ability creates a logical entity that persists in the arena for some duration.",
    },
    {
        label: "Zone",
        alias: "Persistent region",
        description: "The ability creates a persistent region in the arena. Zones can damage, control, or otherwise affect bots inside them.",
    },
    {
        label: "Trap",
        alias: "Triggered entity",
        description: "The ability creates an entity that persists until the end of its lifetime or some specific condition.",
    },
]);

function phaseProfileDetails(ability) {
    const type = ability.phaseTag;
    const tag = type === "ray" ? "ray" : type;
    const guide = ABILITY_TYPE_GUIDE.find(({ label }) => label.toLowerCase() === TAG_LABELS[tag]?.toLowerCase());
    if (TAG_LABELS[tag]) return { label: TAG_LABELS[tag], description: guide?.description ?? "The ability applies its effects through this phase profile." };
    return { label: titleCase(type), description: "The ability applies its effects through this phase profile." };
}

const ALL_STATS_OPEN_KEY = "botfight:ability-modal-all-stats-open";
const PHONE_QUERY = "(max-width: 639px)";
const TILE_TONES = Object.freeze({
    damage: "border-rose-400/60 text-rose-300",
    heal: "border-emerald-400/60 text-emerald-300",
    neutral: "border-[#262c33] text-slate-100",
});
const HEADER_TINTS = Object.freeze({
    damage: "rgba(248, 113, 113, .16)",
    heal: "rgba(52, 211, 153, .14)",
    neutral: "rgba(95, 212, 240, .12)",
});

function useIsPhone() {
    const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true);
    useEffect(() => {
        const query = window.matchMedia?.(PHONE_QUERY);
        if (!query) return undefined;
        const update = () => setPhone(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return phone;
}

function readAllStatsOpen() {
    try {
        return window.sessionStorage.getItem(ALL_STATS_OPEN_KEY) === "true";
    } catch {
        return false;
    }
}

function rememberAllStatsOpen(open) {
    try {
        window.sessionStorage.setItem(ALL_STATS_OPEN_KEY, String(open));
    } catch {
        // The open state is a per-session convenience only.
    }
}

/** A titled block that is always open on desktop and a collapsible row on phones (or when `always`). */
function ModalSection({ title, hint = null, collapsible, defaultOpen = false, onToggle = null, children }) {
    const [open, setOpen] = useState(defaultOpen);
    if (!collapsible) {
        return (
            <section className="min-w-0">
                <h3 className="mb-2 flex items-baseline gap-2 font-display text-sm font-bold text-white">{title}{hint && <span className="text-[11px] font-normal text-slate-500">{hint}</span>}</h3>
                {children}
            </section>
        );
    }
    return (
        <section className="min-w-0 border-t border-[#1c2228] pt-3">
            <button
                type="button"
                onClick={() => { const next = !open; setOpen(next); onToggle?.(next); }}
                aria-expanded={open}
                className="flex w-full items-baseline gap-2 text-left font-display text-sm font-bold text-white"
            >
                {title}
                {hint && <span className="text-[11px] font-normal text-slate-500">{hint}</span>}
                <span className="ml-auto text-slate-500" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
            </button>
            {open && <div className="mt-3">{children}</div>}
        </section>
    );
}

function effectChipClass(chip, effectGuideEntry) {
    if (chip.tone === "status") return STATUS_CHIP_STYLES[chip.guideId] ?? DEFAULT_STATUS_CHIP_STYLE;
    if (chip.guideId === "damage") return "border-rose-500/50 text-rose-300";
    if (chip.guideId === "healing" || chip.tone === "positive") return "border-emerald-500/50 text-emerald-300";
    return effectGuideEntry ? COMBAT_CHIP_STYLE : COMBAT_CHIP_STYLE;
}

export function AbilityModal({
    ability,
    onClose,
    onTestAbility = null,
    overlayClassName = "z-50",
}) {
    const closeButtonRef = useRef(null);
    const dialogRef = useRef(null);
    const phone = useIsPhone();
    const [selectedEffect, setSelectedEffect] = useState(null);
    const detailed = { ...ability, stats: ABILITY_STATS[ability.id] ?? ability.stats ?? {} };
    const highlights = abilityHighlights(detailed);
    const steps = abilityPhaseSteps(detailed);
    const effectChips = abilityEffectChips(detailed);
    const statGroups = abilityStatGroups(detailed);
    const phaseProfile = phaseProfileDetails(ability);
    const iconPath = getAbilityCatalogueIcon(ability.id);
    const types = abilityTypeLabels(ability);
    const description = ability.description ?? ability.summary;
    const tint = HEADER_TINTS[highlights[0]?.tone] ?? HEADER_TINTS.neutral;

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    // The navbar stays visible (and uncovered) whenever an ability is open; the modal sits below it.
    useEffect(() => {
        document.body.classList.add("has-ability-modal");
        return () => document.body.classList.remove("has-ability-modal");
    }, []);

    const testButton = onTestAbility && (
        <button
            type="button"
            onClick={() => onTestAbility(ability)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-b-[3px] border-[#1f6b3f] bg-[#2fa866] px-5 font-display text-sm font-bold text-white hover:bg-[#38bd74] max-sm:w-full"
        >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>
            Test in practice
        </button>
    );

    return (
        <div className={`fixed inset-0 ${overlayClassName} grid place-items-center bg-[#02070de8] px-4 pb-4 pt-[5.5rem] backdrop-blur-sm max-sm:grid-rows-[minmax(0,1fr)] max-sm:items-stretch max-sm:px-0 max-sm:pb-0 max-sm:pt-[72px]`} onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ability-modal-title"
                tabIndex={-1}
                className="ability-modal flex max-h-[calc(100dvh-7.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#262c33] bg-[#0f1418] text-white shadow-[0_32px_100px_rgba(0,0,0,.72)] max-sm:h-full max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none max-sm:border-0"
            >
                <header className="relative shrink-0 overflow-hidden border-b border-[#262c33] px-5 py-5 sm:px-7 sm:py-6" style={{ background: `linear-gradient(90deg, rgba(15,20,24,0) 35%, ${tint} 100%)` }}>
                    {iconPath && <img src={iconPath} alt="" aria-hidden="true" className="ability-modal-art" />}
                    <div className="relative flex items-start justify-between gap-4">
                        <div className="min-w-0 max-w-[34rem]">
                            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                                <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200">{ability.standard ? "Standard" : `Round ${ability.round}`}</span>
                                {types.map((type) => <span key={type} className={`rounded border px-1.5 py-0.5 ${typeTagClass(type)}`}>{type}</span>)}
                            </div>
                            <h2 id="ability-modal-title" className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">{ability.label}</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                            {testButton && <div className="mt-4 max-sm:hidden">{testButton}</div>}
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
                </header>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
                    {highlights.length > 0 && (
                        <section aria-label="At a glance" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                            {highlights.map((tile) => (
                                <div key={`${tile.label}-${tile.value}`} className={`rounded-xl border bg-[#12181d] px-3 py-2.5 ${TILE_TONES[tile.tone] ?? TILE_TONES.neutral}`}>
                                    <p className="font-display text-2xl font-bold leading-none">{tile.value}{tile.unit && <span className="ml-1 text-xs font-normal text-slate-400">{tile.unit}</span>}</p>
                                    <p className="mt-1.5 text-[11px] leading-4 text-slate-400">{tile.label}</p>
                                </div>
                            ))}
                        </section>
                    )}

                    <div className="grid gap-5">
                        <div className="min-w-0 space-y-5">
                            <ModalSection title="How it works" collapsible={phone}>
                                {steps.length > 0 ? (
                                    <ol className="grid divide-y divide-[#262c33] overflow-hidden rounded-xl border border-[#262c33] bg-[#12181d] sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0">
                                        {steps.map((step) => (
                                            <li key={step.key} className="px-3 py-2.5">
                                                <p className={`text-[10px] font-bold ${step.index === 1 ? "text-cyan-300" : step.index === steps.length ? "text-rose-300" : "text-amber-300"}`}>{step.index} &middot; {step.title}</p>
                                                <p className="mt-1 text-xs font-semibold text-white">{step.line}</p>
                                                {step.detail && <p className="mt-0.5 text-[11px] text-slate-500">{step.detail}</p>}
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <p className="text-sm leading-6 text-slate-300">{phaseProfile.description}</p>
                                )}
                            </ModalSection>

                            {effectChips.length > 0 && (
                                <ModalSection title="Effects" collapsible={phone}>
                                    <div className="flex flex-wrap gap-2">
                                        {effectChips.map((chip) => {
                                            const guideEntry = EFFECT_GUIDE.find((entry) => entry.id === chip.guideId) ?? null;
                                            const className = `inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold ${effectChipClass(chip, guideEntry)}`;
                                            return guideEntry ? (
                                                <button key={chip.key} type="button" onClick={() => setSelectedEffect(guideEntry)} className={`${className} hover:bg-white/5`} aria-label={`View ${guideEntry.label} details`}>
                                                    {chip.label} <span aria-hidden="true" className="ml-1 text-slate-500">&rsaquo;</span>
                                                </button>
                                            ) : <span key={chip.key} className={className}>{chip.label}</span>;
                                        })}
                                    </div>
                                </ModalSection>
                            )}
                        </div>

                    </div>

                    {statGroups.length > 0 && (
                        <ModalSection title="All stats" hint="for exact numbers" collapsible defaultOpen={readAllStatsOpen()} onToggle={rememberAllStatsOpen}>
                            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                                {statGroups.map((group) => (
                                    <div key={group.title} className="min-w-0">
                                        <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">{group.title}</p>
                                        <dl>
                                            {group.rows.map((row) => (
                                                <div key={`${row.label}-${row.value}`} className="flex items-baseline justify-between gap-4 border-b border-[#1c2228] py-1.5">
                                                    <dt className="text-xs text-slate-400">{row.label}</dt>
                                                    <dd className="text-right font-display text-sm font-bold text-slate-100">{row.value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </div>
                                ))}
                            </div>
                        </ModalSection>
                    )}
                </div>

                {testButton && <div className="sticky bottom-0 shrink-0 border-t border-[#262c33] bg-[#0f1418] p-3 sm:hidden">{testButton}</div>}
            </section>
            {selectedEffect && <EffectModal key={selectedEffect.id} effect={selectedEffect} onClose={() => setSelectedEffect(null)} overlayClassName="z-[70]" />}
        </div>
    );
}

export function EffectModal({
    effect,
    onClose,
    overlayClassName = "z-50",
}) {
    const closeButtonRef = useRef(null);
    const dialogRef = useRef(null);

    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });

    return (
        <div className={`fixed inset-0 ${overlayClassName} grid place-items-center bg-[#02070de8] p-4 backdrop-blur-sm`} onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="effect-modal-title"
                tabIndex={-1}
                className="ability-modal max-h-[92vh] w-full max-w-3xl overflow-y-auto border border-green-400/60 bg-[#202427] text-white shadow-[0_32px_100px_rgba(0,0,0,.72)]"
            >
                <div className="relative overflow-hidden border-b border-slate-700/70 px-6 py-7 sm:px-8">
                    <div className="relative flex items-start justify-between gap-6">
                        <div>
                            <p className="font-mono text-[10px] font-bold tracking-[.28em] text-green-300">{effect.category.toUpperCase()}</p>
                            <h2 id="effect-modal-title" className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                                {effect.label}
                            </h2>
                        </div>
                        <button
                            ref={closeButtonRef}
                            type="button"
                            onClick={onClose}
                            aria-label={`Close ${effect.label} details`}
                            className="modal-close-button"
                        >
                            <span aria-hidden="true">×</span>
                        </button>
                    </div>
                </div>

                <div className="grid gap-7 px-6 py-7 sm:px-8 sm:grid-cols-[1.3fr_.7fr]">
                    <div>
                        <h3 className="font-mono text-[10px] font-bold tracking-[.24em] text-green-300">WHAT IT DOES</h3>
                        <p className="mt-4 text-base leading-7 text-slate-200">{effect.description}</p>
                    </div>
                    <aside className="border border-slate-700/70 bg-slate-950/35 p-5">
                        <h3 className="font-mono text-[10px] font-bold tracking-[.24em] text-green-300">CLASSIFICATION</h3>
                        <p className="mt-4 font-display text-xl font-bold text-slate-100">{effect.category}</p>

                    </aside>
                </div>
            </section>
        </div>
    );
}

const SECTION_SUBTITLES = Object.freeze({
    0: "on every bot",
    1: "offered in the first draft",
    2: "offered in the second draft",
    3: "offered in the third draft",
});

const CATALOGUE_CHIPS = Object.freeze([
    { id: "round-0-abilities", label: "Standard" },
    { id: "round-1-abilities", label: "Round 1" },
    { id: "round-2-abilities", label: "Round 2" },
    { id: "round-3-abilities", label: "Round 3" },
    { id: "combat-effects", label: "Effects" },
]);

export default function AbilityCataloguePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const abilityFromRoute = new URLSearchParams(location.search).get("ability");
    const abilityFromRouteDefinition = ALL_ABILITY_DEFINITIONS.find(({ id }) => String(id) === abilityFromRoute) ?? null;
    const [selectedAbility, setSelectedAbility] = useState(abilityFromRouteDefinition);
    const [selectedEffect, setSelectedEffect] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const visibleAbilities = ALL_ABILITY_DEFINITIONS.filter((ability) => (
        `${ability.label} ${ability.kind} ${abilityTypeLabels(ability).join(" ")}`.toLowerCase().includes(normalizedSearch)
    ));
    const visibleChips = CATALOGUE_CHIPS.filter((chip) => (
        chip.id === "combat-effects"
            ? true
            : visibleAbilities.some((ability) => `round-${ability.round}-abilities` === chip.id)
    ));
    const { activeId, scrollToSection } = useSectionSpy(visibleChips.map((chip) => chip.id));

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

            <header className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 sm:pt-10">
                <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Abilities</h1>
            </header>

            <div className="catalogue-controls sticky z-20 mx-auto mt-4 flex max-w-7xl flex-wrap items-center gap-2 bg-[#171a1c]/95 px-5 py-3 backdrop-blur sm:px-8">
                <label className="catalogue-search min-w-0 basis-56">
                    <span className="sr-only">Find an ability</span>
                    <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by name or type" />
                </label>
                <nav aria-label="Jump to section" className="flex flex-wrap gap-1.5">
                    {visibleChips.map((chip) => (
                        <button
                            key={chip.id}
                            type="button"
                            onClick={() => scrollToSection(chip.id)}
                            aria-current={activeId === chip.id ? "true" : undefined}
                            className={`h-8 rounded-full border px-3 text-xs font-semibold transition ${activeId === chip.id ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-100" : "border-[#2d353c] text-slate-300 hover:border-slate-500"}`}
                        >
                            {chip.label}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="mx-auto max-w-7xl space-y-10 px-5 pb-12 pt-4 sm:px-8 sm:pb-16">
                {normalizedSearch && <p className="catalogue-results" role="status">{visibleAbilities.length} {visibleAbilities.length === 1 ? "ability" : "abilities"} found</p>}
                {normalizedSearch && visibleAbilities.length === 0 && <p className="condition-empty">No abilities match that search. Try a name or ability type.</p>}
                {ROUNDS.map((round) => {
                    const roundAbilities = visibleAbilities.filter((ability) => ability.round === round);
                    if (!roundAbilities.length) return null;
                    const standard = round === 0;
                    return (
                        <section id={`round-${round}-abilities`} key={round} aria-labelledby={`round-${round}-title`}>
                            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <h2 id={`round-${round}-title`} className="font-display text-xl font-bold text-white">
                                    {standard ? "Standard" : `Round ${round}`}
                                </h2>
                                <span className="text-xs text-slate-500">{roundAbilities.length} abilities · {SECTION_SUBTITLES[round]}</span>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {roundAbilities.map((ability) => {
                                    const iconPath = getAbilityCatalogueIcon(ability.id);
                                    const isSelected = selectedAbility?.id === ability.id;
                                    return (
                                        <button
                                            key={ability.id}
                                            type="button"
                                            onClick={() => selectAbility(ability)}
                                            className={`ability-card ability-card-${round} group relative min-h-48 overflow-hidden rounded-xl border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 ${isSelected ? "ability-card-selected" : ""}`}
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
                                            <span className="ability-card-content absolute inset-x-0 bottom-0 border-t border-white/10 px-4 py-3">
                                                <span className="block font-display text-base font-bold text-white">{ability.label}</span>
                                                <span className="mt-1.5 flex flex-wrap gap-1.5">
                                                    {abilityTypeLabels(ability).map((type) => (
                                                        <span key={type} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${typeTagClass(type)}`}>
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
                <section id="combat-effects" aria-labelledby="combat-effects-title">
                    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 id="combat-effects-title" className="font-display text-xl font-bold text-white">Effects</h2>
                        <span className="text-xs text-slate-500">what abilities do on hit</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {EFFECT_GUIDE.map((effect) => {
                            const isSelected = selectedEffect?.id === effect.id;
                            const isStatus = effect.category === "Status";
                            const chipStyle = isStatus ? (STATUS_CHIP_STYLES[effect.id] ?? DEFAULT_STATUS_CHIP_STYLE) : COMBAT_CHIP_STYLE;
                            return (
                                <button
                                    key={effect.id}
                                    type="button"
                                    onClick={() => setSelectedEffect(effect)}
                                    className={`h-8 rounded-full border px-3 text-xs font-semibold transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 ${chipStyle} ${isSelected ? "bg-white/10" : ""}`}
                                    aria-label={`View ${effect.label} details`}
                                    aria-pressed={isSelected}
                                    title={effect.category}
                                >
                                    {effect.label}
                                </button>
                            );
                        })}
                    </div>
                </section>
            </div>

            {selectedAbility && <AbilityModal ability={selectedAbility} onClose={closeAbility} onTestAbility={testAbility} />}
            {selectedEffect && <EffectModal key={selectedEffect.id} effect={selectedEffect} onClose={() => setSelectedEffect(null)} />}
            <BackToTopButton />
        </main>
    );
}
