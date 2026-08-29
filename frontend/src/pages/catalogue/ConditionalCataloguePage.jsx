import AppNavbar from "../../components/AppNavbar";
import {
    VISIBLE_STATE_VARIABLES,
    VARIABLE_SELECTABLE_TYPES,
} from "../../gameArena/botlogic/code/BotCode";

const GROUP_ORDER = ["General", "Entity", "Health & Combat", "Position & Movement", "Abilities & Status", "Movement", "Rotation", "Ability Entity"];

const DESCRIPTIONS = Object.freeze({
    "match.elapsedSeconds": "Seconds elapsed since the 1v1 began.",
    "selectable.distance": "Straight-line distance from the first selected entity to either another entity or an absolute arena coordinate. It defaults to My Bot and Opponent.",
    "selectable.hp": "Current HP of the selected entity. Entities without health report 0.",
    "selectable.damageTakenLastTick": "Damage received by the selected entity during the last simulation tick. Entities that cannot be hit report 0.",
    "selectable.hpNetChangeLastTick": "The selected entity's total HP change last tick, including damage and healing. Entities without health report 0.",
    "selectable.x": "The selected entity's horizontal arena position.",
    "selectable.y": "The selected entity's vertical arena position.",
    "selectable.alive": "True when the selected entity exists and has HP remaining.",
    "selectable.absoluteBearing": "The absolute arena bearing of the Target from the Facing Entity, represented as a signed degree measurement. The first selection must have the facing identity.",
    "selectable.movementDirection": "The selected entity's direction of travel, or 0 when it has no movement direction.",
    "selectable.speed": "The selected entity's movement speed in arena units per simulation tick, independent of direction; entities without movement speed report 0.",
    "selectable.relativeBearing": "Smallest angle between the Facing Entity's facing direction and a target entity, absolute coordinate, or absolute angle. The first selection must have the facing identity.",
    "selectable.relativeBearingClockwise": "Clockwise turn needed for the Facing Entity to face a target entity, absolute coordinate, or absolute angle. The first selection must have the facing identity.",
    "selectable.relativeBearingCounterclockwise": "Counterclockwise turn needed for the Facing Entity to face a target entity, absolute coordinate, or absolute angle. The first selection must have the facing identity.",
    "selectable.facing": "The selected entity's facing direction. Only entities with the facing identity are available.",
    "selectable.count": "Number of matching ability entities of the selected type; ordering and ordinal selection do not apply.",
    "selectable.age": "Age or active timer of the selected ability entity, in seconds.",
    "selectable.edgeDistance": "Shortest edge-to-edge distance from the selected entity's hitbox to an arena boundary. Positive values measure the closest gap from the shape's nearest edge.",
    "selectable.closingZoneEdgeDistance": "Signed edge-to-edge clearance from the selected entity's hitbox to the circular closing-zone edge: positive inside, zero at the edge, and negative outside. It is unavailable until the zone starts.",
    "selectable.exists": "True when an ability entity matching the selected type exists.",
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
        if (variable.id.endsWith("Preparing")) return "Whether the selected bot is currently winding up the drafted ability.";
        return "Current wind-up timer for the selected bot's drafted ability, in seconds.";
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

const COMPASS_DIRECTIONS = Object.freeze([
    { label: "N", positive: "0° / 360°", negative: "0° / -360°", x: 50, y: 7, anchor: "middle" },
    { label: "NE", positive: "45°", negative: "-315°", x: 77, y: 19, anchor: "start" },
    { label: "E", positive: "90°", negative: "-270°", x: 93, y: 50, anchor: "start" },
    { label: "SE", positive: "135°", negative: "-225°", x: 77, y: 81, anchor: "start" },
    { label: "S", positive: "180°", negative: "-180°", x: 50, y: 93, anchor: "middle" },
    { label: "SW", positive: "225°", negative: "-135°", x: 23, y: 81, anchor: "end" },
    { label: "W", positive: "270°", negative: "-90°", x: 7, y: 50, anchor: "end" },
    { label: "NW", positive: "315°", negative: "-45°", x: 23, y: 19, anchor: "end" },
]);

function ArenaDegreesCompass() {
    return (
        <aside className="self-start">
            <div className="mx-auto aspect-square w-full max-w-[22rem]" role="img" aria-label="Arena compass degrees. North is 0 or 360 degrees, east is 90, south is 180, and west is 270. Equivalent negative angles run counterclockwise.">
                <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
                    <circle cx="50" cy="50" r="31" fill="#081b2a" stroke="#155e75" strokeWidth="0.8" />
                    <circle cx="50" cy="50" r="24" fill="none" stroke="#1e3a4c" strokeWidth="0.5" />
                    {COMPASS_DIRECTIONS.map((direction, index) => {
                        const angle = index * 45 * Math.PI / 180;
                        const innerX = 50 + Math.sin(angle) * 24;
                        const innerY = 50 - Math.cos(angle) * 24;
                        const outerX = 50 + Math.sin(angle) * 31;
                        const outerY = 50 - Math.cos(angle) * 31;
                        return <line key={direction.label} x1={innerX} y1={innerY} x2={outerX} y2={outerY} stroke="#38bdf8" strokeWidth={index % 2 === 0 ? 1.1 : 0.6} />;
                    })}
                    <path d="M50 22 L46.5 50 L50 47 L53.5 50 Z" fill="#38bdf8" />
                    <path d="M50 78 L46.5 50 L50 53 L53.5 50 Z" fill="#334155" />
                    <circle cx="50" cy="50" r="2" fill="#e2e8f0" />
                    {COMPASS_DIRECTIONS.map((direction) => (
                        <g key={direction.label} textAnchor={direction.anchor}>
                            <text x={direction.x} y={direction.y - 2.5} fill="#e2e8f0" fontSize="4.5" fontWeight="700">{direction.label}</text>
                            <text x={direction.x} y={direction.y + 2.5} fill="#7dd3fc" fontSize="3.4">{direction.positive}</text>
                            <text x={direction.x} y={direction.y + 6.5} fill="#a78bfa" fontSize="3.2">{direction.negative}</text>
                        </g>
                    ))}
                </svg>
            </div>
        </aside>
    );
}

export default function ConditionalCataloguePage() {
    const groups = groupedVariables();

    return (
        <main className="conditional-catalogue min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="conditionals" />

            <header className="border-b border-slate-800/80 px-5 py-12 sm:px-8 sm:py-16">
                <div className="mx-auto max-w-6xl">
                    <p className="font-mono text-[10px] font-bold tracking-[.3em] text-blue-300">BOT BRAIN REFERENCE · 1V1</p>
                    <h1 className="mt-3 font-display-action text-5xl uppercase tracking-wide text-white sm:text-7xl">Conditional List</h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
                        Everything a bot can check while building 1v1 logic. Pick a value, compare it, and run the branch when the result is true.
                    </p>
                </div>
            </header>

            <div className="mx-auto grid max-w-[92rem] gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(18rem,22rem)]">
                <aside className="self-start border border-blue-500/40 bg-[#081522]/85 p-5">
                    <p className="font-mono text-[10px] font-bold tracking-[.22em] text-blue-300">HOW CONDITIONS WORK</p>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                        Numbers use comparisons such as <span className="font-mono text-blue-200">&lt;</span>, <span className="font-mono text-blue-200">=</span>, or <span className="font-mono text-blue-200">&gt;</span>. Booleans check true or false. Direction values use signed degrees.
                    </p>
                    <div className="my-5 h-px bg-slate-700/70" />
                    <p className="font-mono text-[10px] font-bold tracking-[.22em] text-blue-300">CUSTOM VARIABLES</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        Create a number or boolean variable in the bot code workspace and give it an initial value. It then appears in conditional value pickers, so you can compare it just like the built-in values listed here.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        Use <strong className="text-slate-200">Variable: Modify Custom Variable</strong> in an action node to set a value or, for numbers, add to or subtract from it. Stored values persist between ticks during the fight.
                    </p>
                    <div className="my-5 h-px bg-slate-700/70" />
                    <p className="font-mono text-[10px] font-bold tracking-[.22em] text-blue-300">ENTITY INPUTS</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        Entity selectors use the identities attached to each entity. Single-entity variables are labeled <strong className="text-slate-200">Entity</strong> and filter their options by the required identity. Position, health, movement, distance, and edge measurements accept any entity; unsupported HP or movement values resolve to 0.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        Entities can be ordered by closest, farthest, oldest, or newest, then selected by position: first, second, and so on. <strong className="text-slate-200">Ability Entity Type Count</strong> selects only an entity type and does not use ordering or ordinal selection. Bearing pairs label their selectors <strong className="text-slate-200">Facing Entity</strong> and <strong className="text-slate-200">Target</strong>; other pairs use <strong className="text-slate-200">Entity</strong> for both.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        Edge-distance measurements are edge-to-edge: they use the nearest edge of the entity hitbox, not its center. Arena-edge values are positive inside the arena; closing-zone values are signed relative to the zone boundary.
                    </p>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                        Only entity and ability choices available in the current draft appear in the editor.
                    </p>
                </aside>

                <div className="min-w-0 space-y-12">
                    <section aria-labelledby="conditional-basic">
                        <div className="mb-3 flex items-end justify-between gap-4 border-b border-slate-700/70 pb-3">
                            <h2 id="conditional-basic" className="font-display-action text-3xl uppercase tracking-wider text-white">Basic</h2>
                            <span className="font-mono text-[9px] tracking-[.18em] text-slate-500">1 CONDITIONAL</span>
                        </div>
                        <div className="conditional-row grid gap-2 border-b border-slate-800/80 px-1 py-4 sm:grid-cols-[minmax(12rem,.8fr)_minmax(0,1.2fr)] sm:gap-7">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-100">Always</h3>
                                <p className="mt-1 font-mono text-[9px] tracking-wider text-slate-600">BOOLEAN · NO ENTITY INPUT</p>
                            </div>
                            <p className="text-sm leading-6 text-slate-400">Always true. Use it for a fallback action or a branch that should run every tick.</p>
                        </div>
                    </section>

                    {groups.map(({ group, variables }) => (
                        <section key={group} aria-labelledby={`conditional-${group.replaceAll(" ", "-").toLowerCase()}`}>
                            <div className="mb-1 flex items-end justify-between gap-4 border-b border-slate-700/70 pb-3">
                                <h2 id={`conditional-${group.replaceAll(" ", "-").toLowerCase()}`} className="font-display-action text-3xl uppercase tracking-wider text-white">{group}</h2>
                                <span className="font-mono text-[9px] tracking-[.18em] text-slate-500">{variables.length} {variables.length === 1 ? "CONDITIONAL" : "CONDITIONALS"}</span>
                            </div>
                            <div>
                                {variables.map((variable) => {
                                    const selectable = selectableRule(variable);
                                    return (
                                        <article key={variable.id} className="conditional-row grid gap-2 border-b border-slate-800/80 px-1 py-4 sm:grid-cols-[minmax(12rem,.8fr)_minmax(0,1.2fr)] sm:gap-7">
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-semibold text-slate-100">{variable.label}</h3>
                                                <p className="mt-1 flex flex-wrap gap-x-2 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                                                    <span>{variable.valueType}</span>
                                                    <span>·</span>
                                                    <span className={selectable ? "text-blue-300/80" : ""}>{selectable ?? "No entity input"}</span>
                                                    {variable.supportsAbility && <><span>·</span><span className="text-blue-300/80">Ability picker</span></>}
                                                </p>
                                            </div>
                                            <p className="text-sm leading-6 text-slate-400">{describeVariable(variable)}</p>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>

                <ArenaDegreesCompass />
            </div>
        </main>
    );
}
