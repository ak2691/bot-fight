import AppNavbar from "../../components/AppNavbar";
import { STATE_VARIABLES } from "../../gameArena/botlogic/code/BotCode";

const GROUP_ORDER = ["General", "My Bot", "Opponent", "Target", "Movement", "Rotation", "Objects"];

const DESCRIPTIONS = Object.freeze({
    "match.elapsedSeconds": "Seconds elapsed since the 1v1 began.",
    "my.hp": "Your bot's current hit points.",
    "my.damageTakenLastTick": "Damage your bot received during the last simulation tick.",
    "my.hpNetChangeLastTick": "Your bot's total HP change last tick, including damage and healing.",
    "my.x": "Your bot's horizontal arena position.",
    "my.y": "Your bot's vertical arena position.",
    "opponent.hp": "The opponent's current hit points.",
    "opponent.damageTakenLastTick": "Damage the opponent received during the last simulation tick.",
    "opponent.hpNetChangeLastTick": "The opponent's total HP change last tick, including damage and healing.",
    "opponent.x": "The opponent's horizontal arena position.",
    "opponent.y": "The opponent's vertical arena position.",
    "target.distance": "Straight-line distance from your bot to the selected target.",
    "target.hp": "Current HP of the selected target. Targets without HP read as 0.",
    "target.alive": "True when the selected target exists and has HP remaining.",
    "target.bearingFromMe": "The selected target's compass direction from your bot, checked as an angle range.",
    "target.movementDirection": "The selected target's direction of travel, checked as an angle range.",
    "target.velocity": "The selected target's current movement speed.",
    "my.bearingFromTarget": "Your bot's compass direction as seen from the selected target.",
    "target.relativeBearing": "Smallest angle between your facing and the selected target.",
    "target.relativeBearingClockwise": "Clockwise turn needed to face the selected target.",
    "target.relativeBearingCounterclockwise": "Counterclockwise turn needed to face the selected target.",
    "target.facing": "The opponent's current facing direction.",
    "target.count": "Number of matching objects of the selected target type.",
    "target.age": "Age or active timer of the selected object, in seconds.",
    "my.edgeDistance": "Shortest distance from your bot to an arena edge.",
    "target.edgeDistance": "Shortest distance from the selected target to an arena edge.",
    "target.exists": "True when an object matching the selected target slot exists.",
});

function describeVariable(variable) {
    if (DESCRIPTIONS[variable.id]) return DESCRIPTIONS[variable.id];

    const owner = variable.id.startsWith("my.") ? "your bot" : "the opponent";
    const lowerLabel = variable.label
        .replace(/^My /, "")
        .replace(/^Opponent 1? ?/, "")
        .toLowerCase();

    if (variable.id.includes("selectedAbility")) {
        if (variable.id.endsWith("Ready")) return `Whether the selected drafted ability is ready for ${owner} to use.`;
        if (variable.id.endsWith("CooldownMs")) return `Cooldown remaining on the selected drafted ability for ${owner}, in seconds.`;
        if (variable.id.endsWith("Ammo")) return `Current ammo or charges for ${owner}'s selected drafted ability.`;
        if (variable.id.endsWith("Preparing")) return `Whether ${owner} is currently winding up the selected drafted ability.`;
        return `Current wind-up timer for ${owner}'s selected drafted ability, in seconds.`;
    }
    if (variable.id.endsWith("Ready")) return `Whether ${lowerLabel} is currently ready to use.`;
    if (variable.id.endsWith("CooldownMs")) return `Time remaining on ${lowerLabel}, in seconds.`;
    if (variable.id.endsWith("RechargeMs") || variable.id.endsWith("ReloadMs")) {
        return `Time remaining on ${lowerLabel}, in seconds.`;
    }
    if (variable.id.endsWith("Ammo") || variable.id.endsWith("Charges")) return `Current ${lowerLabel}.`;
    if (variable.id.endsWith("shieldUp")) return `Whether ${owner}'s shield is currently raised.`;
    return `Current value of ${lowerLabel}.`;
}

function targetRule(variable) {
    if (!variable.supportsTarget) return null;
    if (variable.botTargetOnly) return "Opponent only";
    if (variable.targetGroup === "objects") return "Object target";
    return "Chosen target";
}

function groupedVariables() {
    return GROUP_ORDER.map((group) => ({
        group,
        variables: STATE_VARIABLES.filter((variable) => variable.group === group),
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
                        Numbers use comparisons such as <span className="font-mono text-blue-200">&lt;</span>, <span className="font-mono text-blue-200">=</span>, or <span className="font-mono text-blue-200">&gt;</span>. Booleans check true or false. Direction values use a degree range.
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
                    <p className="font-mono text-[10px] font-bold tracking-[.22em] text-blue-300">TARGET SELECTION</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        <strong className="text-slate-200">Chosen target</strong> can read the opponent or an entity created by either bot's drafted abilities.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                        Entity targets can be ordered by closest, farthest, oldest, or newest, then selected by position: first, second, and so on. <strong className="text-slate-200">Object target</strong> uses the same rules but excludes the opponent.
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
                                <p className="mt-1 font-mono text-[9px] tracking-wider text-slate-600">BOOLEAN · NO TARGET</p>
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
                                    const target = targetRule(variable);
                                    return (
                                        <article key={variable.id} className="conditional-row grid gap-2 border-b border-slate-800/80 px-1 py-4 sm:grid-cols-[minmax(12rem,.8fr)_minmax(0,1.2fr)] sm:gap-7">
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-semibold text-slate-100">{variable.label}</h3>
                                                <p className="mt-1 flex flex-wrap gap-x-2 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                                                    <span>{variable.valueType}</span>
                                                    <span>·</span>
                                                    <span className={target ? "text-blue-300/80" : ""}>{target ?? "No target"}</span>
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
