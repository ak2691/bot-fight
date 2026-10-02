import { useState } from "react";
import AppNavbar from "../../components/AppNavbar";
import ArenaDegreesCompass from "../../components/ArenaDegreesCompass";
import {
    VISIBLE_STATE_VARIABLES,
    VARIABLE_SELECTABLE_TYPES,
} from "../../gameArena/botlogic/code/BotCode";
import { useSectionSpy } from "./useSectionSpy.js";

const GROUP_ORDER = ["General", "Entity", "Health & Combat", "Position & Movement", "Abilities & Status", "Movement", "Rotation", "Ability Entity"];

const DESCRIPTIONS = Object.freeze({
    "match.elapsedSeconds": "Seconds elapsed since the 1v1 began.",
    "selectable.distance": "Straight-line, center-to-center distance from one entity to another entity or an absolute arena coordinate. It defaults to My Bot and Opponent.",
    "selectable.hp": "Current HP of the selected entity. Entities without health report 0.",
    "selectable.damageTakenLastTick": "Damage received by the selected entity during the last tick. Entities that cannot be hit report 0.",
    "selectable.hpNetChangeLastTick": "The selected entity's total HP change last tick, including damage and healing. Entities without health report 0.",
    "selectable.x": "The selected entity's horizontal position.",
    "selectable.y": "The selected entity's vertical position.",
    "selectable.alive": "True when the selected entity exists and has HP remaining.",
    "selectable.absoluteBearing": "The arena heading from the Facing Entity toward the Target, as a signed degree measurement. The first selection must have the facing identity.",
    "selectable.movementDirection": "The selected entity's direction of travel, or 0 when it has no movement direction.",
    "selectable.speed": "The selected entity's movement speed in arena units per tick.",
    "selectable.relativeBearing": "How far off the first entity's facing direction is from a target entity, absolute coordinate, or absolute angle, from 0 to 180 degrees. Near zero means it is aimed at the target. The first selection must have the facing identity.",
    "selectable.facing": "The selected entity's facing direction. Only entities with the facing identity are available.",
    "selectable.count": "Number of matching ability entities of the selected type.",
    "selectable.age": "Age or active timer of the selected ability entity, in seconds.",
    "selectable.edgeDistance": "Distance from the selected entity to an arena boundary. Note that it measures from the center of the entity.",
    "selectable.dangerZoneEdgeDistance": "Distance from the selected entity to the danger zone. The distance is positive when the entity is not in the danger zone, negative when it is inside the danger zone. Note that it measures from the center of the entity so the entity can be taking damage while the number is still positive.",
    "selectable.exists": "True when an ability entity exists in the arena.",
});

function describeVariable(variable) {
    if (DESCRIPTIONS[variable.id]) return DESCRIPTIONS[variable.id];

    const lowerLabel = variable.label
        .replace(/^My /, "")
        .replace(/^Opponent(?: 1)? ?/, "")
        .toLowerCase();

    if (variable.id.startsWith("bot.selectedAbility")) {
        if (variable.id.endsWith("Ready")) return "Whether the selected drafted ability is ready for the selected bot to use.";
        if (variable.id.endsWith("Active")) return "Whether the selected drafted ability is currently active for the selected bot.";
        if (variable.id.endsWith("ActiveMs")) return "Time remaining while the selected drafted ability stays active for the selected bot, in seconds.";
        if (variable.id.endsWith("CooldownMs")) return "Cooldown remaining on the selected drafted ability for the selected bot, in seconds.";
        if (variable.id.endsWith("Charges")) return "Current charges for the selected bot's drafted ability.";
        if (variable.id.endsWith("Preparing")) return "Whether the selected bot is currently preparing the drafted ability.";
        return "Preparation time remaining for the selected bot's drafted ability, in seconds.";
    }
    if (variable.id.startsWith("bot.selectedStatusEffect")) {
        return variable.id.endsWith("Active")
            ? "Whether the selected status effect is active on the selected bot."
            : "Remaining time for the selected status effect on the selected bot, in seconds.";
    }
    if (variable.id.endsWith("Ready")) return `Whether ${lowerLabel} is currently ready to use.`;
    if (variable.id.endsWith("CooldownMs")) return `Time remaining on ${lowerLabel}, in seconds.`;
    if (variable.id.endsWith("Charges")) return `Current ${lowerLabel}.`;
    return `Current value of ${lowerLabel}.`;
}

function selectableRule(variable) {
    if (!variable.supportsSelectable) return null;
    if (variable.selectableType === VARIABLE_SELECTABLE_TYPES.PAIR) {
        if (variable.targetModes?.length) {
            return `${variable.selectableSelectorLabels?.[0] ?? "Entity"} + Target mode`;
        }
        return variable.selectableSelectorLabels?.join(" + ") ?? "Entity + Entity";
    }
    return "Entity";
}

function groupedVariables() {
    return GROUP_ORDER.map((group) => ({
        group,
        variables: VISIBLE_STATE_VARIABLES.filter((variable) => variable.group === group),
    })).filter(({ variables }) => variables.length);
}

function groupSectionId(group) {
    return `conditional-${group.replaceAll(" ", "-").replaceAll("&", "and").toLowerCase()}`;
}

function TypeTag({ valueType }) {
    const isBoolean = valueType === "boolean";
    return (
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${isBoolean ? "border-violet-400/40 bg-violet-500/10 text-violet-300" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-300"}`}>
            {isBoolean ? "True/false" : "Number"}
        </span>
    );
}

function ReferenceCard({ title, defaultOpen, children }) {
    return (
        <details open={defaultOpen} className="group rounded-xl border border-[#262c33] bg-[#0f1418]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-100 [&::-webkit-details-marker]:hidden">
                {title}
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-slate-400 transition group-open:rotate-180" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div className="space-y-3 border-t border-[#262c33] px-4 py-3 text-xs leading-5 text-slate-400">{children}</div>
        </details>
    );
}

export default function ConditionalCataloguePage() {
    const [searchTerm, setSearchTerm] = useState("");
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const referenceOpenByDefault = typeof window === "undefined" || !window.matchMedia
        ? true
        : window.matchMedia("(min-width: 1024px)").matches;
    const groups = groupedVariables().map(({ group, variables }) => ({
        group,
        variables: variables.filter((variable) => (
            `${variable.label} ${variable.valueType} ${variable.unit ?? ""} ${describeVariable(variable)}`.toLowerCase().includes(normalizedSearch)
        )),
    })).filter(({ variables }) => variables.length);
    const alwaysMatches = !normalizedSearch || "always boolean fallback action".includes(normalizedSearch);
    const resultCount = groups.reduce((count, group) => count + group.variables.length, 0) + (alwaysMatches ? 1 : 0);
    const totalCount = VISIBLE_STATE_VARIABLES.length + 1;
    const categories = [
        ...(alwaysMatches ? [{ id: "conditional-basic", label: "Basic" }] : []),
        ...groups.map(({ group }) => ({ id: groupSectionId(group), label: group })),
    ];
    const { activeId, scrollToSection } = useSectionSpy(categories.map((category) => category.id));

    return (
        <main className="conditional-catalogue min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="conditionals" />

            <header className="mx-auto flex max-w-[80rem] flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-8 sm:px-8 sm:pt-10">
                <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Conditionals</h1>
                <span className="text-xs text-slate-500">{totalCount} values you can check</span>
            </header>

            <div className="mx-auto grid max-w-[80rem] gap-6 px-5 pb-10 pt-5 sm:px-8 sm:pb-14 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(16rem,19rem)] lg:gap-6">
                <nav aria-label="Categories" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
                    <p className="mb-2 hidden text-[11px] text-slate-500 lg:block">Categories</p>
                    <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
                        {categories.map((category) => (
                            <button
                                key={category.id}
                                type="button"
                                onClick={() => scrollToSection(category.id)}
                                aria-current={activeId === category.id ? "true" : undefined}
                                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition lg:rounded-md lg:border-0 lg:px-2.5 lg:py-1.5 lg:text-left ${activeId === category.id ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-100 lg:bg-[#1b3a45]" : "border-[#2d353c] text-slate-400 hover:text-slate-200"}`}
                            >
                                {category.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="conditional-catalogue__list min-w-0 space-y-6">
                    <div className="catalogue-controls">
                        <label className="catalogue-search">
                            <span className="sr-only">Find a condition</span>
                            <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search health, distance, cooldown…" />
                        </label>
                        {normalizedSearch && <span className="catalogue-results" role="status">{resultCount} {resultCount === 1 ? "value" : "values"} found</span>}
                    </div>
                    {resultCount === 0 && <p className="condition-empty">No conditions match that search. Try another game state or value name.</p>}
                    {alwaysMatches && <section aria-labelledby="conditional-basic">
                        <h2 id="conditional-basic" className="mb-2 font-display text-xl font-bold text-white">Basic</h2>
                        <div className="overflow-hidden rounded-xl border border-[#262c33] bg-[#0f1418]">
                            <div className="conditional-row px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-semibold text-slate-100">Always</h3>
                                    <TypeTag valueType="boolean" />
                                </div>
                                <p className="mt-1 text-xs leading-5 text-slate-400">Always true. Use it for a fallback action or a branch that should run every tick.</p>
                            </div>
                        </div>
                    </section>}

                    {groups.map(({ group, variables }) => (
                        <section key={group} aria-labelledby={groupSectionId(group)}>
                            <h2 id={groupSectionId(group)} className="mb-2 font-display text-xl font-bold text-white">{group}</h2>
                            <div className="overflow-hidden rounded-xl border border-[#262c33] bg-[#0f1418]">
                                {variables.map((variable) => {
                                    const selectable = selectableRule(variable);
                                    const extras = [selectable ? `Input: ${selectable}` : null, variable.supportsAbility ? "Ability picker" : null].filter(Boolean);
                                    return (
                                        <article key={variable.id} className="conditional-row border-b border-[#1c2228] px-4 py-3 last:border-b-0">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                <h3 className="text-sm font-semibold text-slate-100">{variable.label}</h3>
                                                <TypeTag valueType={variable.valueType} />
                                                {variable.unit && <span className="text-[11px] text-slate-500">{variable.unit}</span>}
                                            </div>
                                            <p className="mt-1 text-xs leading-5 text-slate-400">{describeVariable(variable)}</p>
                                            {extras.length > 0 && <p className="mt-0.5 text-[11px] text-slate-600">{extras.join(" · ")}</p>}
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>

                <aside className="min-w-0 space-y-3 lg:self-start">
                    <ReferenceCard title="Angle reference" defaultOpen={referenceOpenByDefault}>
                        <ArenaDegreesCompass className="px-4 py-2" />
                    </ReferenceCard>
                    <ReferenceCard title="How conditions work" defaultOpen={referenceOpenByDefault}>
                        <p>
                            New v2 brains use centered, Y-up coordinates from -600 to 600; bot-center positions stop at ±570. Legacy v1 brains keep top-left, Y-down coordinates. Distances remain straight-line center-to-center, and the compass remains 0° up with positive angles clockwise. Numbers use comparisons such as <span className="font-mono text-blue-200">&lt;</span>, <span className="font-mono text-blue-200">=</span>, or <span className="font-mono text-blue-200">&gt;</span>. Booleans check true or false. Direction values use signed degrees.
                        </p>
                        <p>
                            Entity selectors use the identities attached to each entity. <strong className="text-slate-200">Entity</strong> is a general label for all entities that can exist in the arena. The options provided can be limited by the variable.
                        </p>
                        <p>
                            Entities created by abilities can be ordered by closest, farthest, oldest, or newest, then selected by position: first, second, and so on.
                        </p>
                        <p>
                            Edge-distance measurements use the entity&apos;s center, not its hitbox edge. Arena-edge distance is the nearest distance from that center to an arena boundary. Danger-zone distance is signed relative to the zone boundary, so it is negative when the entity&apos;s center is inside the danger zone.
                        </p>
                    </ReferenceCard>
                    <ReferenceCard title="Custom variables" defaultOpen={referenceOpenByDefault}>
                        <p>
                            Create a number or boolean variable in the bot code workspace and give it an initial value. It will appear in the standard variable list, so you can compare it just like the built-in values listed here.
                        </p>
                        <p>
                            Use <strong className="text-slate-200">Variable: Modify Custom Variable</strong> in an action node to set a value or, for numbers, add to or subtract from it. Stored values persist between ticks during the fight.
                        </p>
                    </ReferenceCard>
                </aside>
            </div>
        </main>
    );
}
