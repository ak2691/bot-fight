import { useState } from "react";

const runComplete = ({ challenge }) => Boolean(challenge?.completed);

function rootsOf(configuration) {
    return Array.isArray(configuration?.roots) ? configuration.roots : [];
}

function branchesOf(configuration) {
    const collect = (branches = []) => branches.flatMap((branch) => [
        branch,
        ...collect(Array.isArray(branch?.children) ? branch.children : []),
    ]);
    return rootsOf(configuration).flatMap((root) => collect(Array.isArray(root?.branches) ? root.branches : []));
}

function actionsOf(branch) {
    if (Array.isArray(branch?.actions)) return branch.actions;
    return branch?.action ? [{ action: branch.action, actionTarget: branch.actionTarget }] : [];
}

function hasAction(configuration, predicate) {
    return branchesOf(configuration).some((branch) => actionsOf(branch).some(predicate));
}

function hasCondition(configuration, predicate) {
    return branchesOf(configuration).some((branch) => (branch.conditions ?? []).some(predicate));
}

function hasConditionAndAction(configuration, conditionPredicate, actionPredicate) {
    return branchesOf(configuration).some((branch) => (
        (branch.conditions ?? []).some(conditionPredicate)
        && actionsOf(branch).some(actionPredicate)
    ));
}

function numericCondition(condition, left, comparator, value, leftTarget = undefined) {
    return condition?.type === "expression"
        && condition.left === left
        && condition.comparator === comparator
        && Number(condition.right?.value) === value
        && (!leftTarget || condition.leftTarget === leftTarget);
}

const always = (condition) => condition?.type === "always";
const movement = (direction, target = "opponent") => (action) => (
    action?.action === "move_walk"
    && (action.movementMode ?? "target") === "target"
    && (action.movementDirection ?? "toward") === direction
    && (action.actionTarget ?? "opponent") === target
);

const LESSONS = [
    {
        lessonNumber: "01",
        eyebrow: "BUILD A BRAIN",
        title: "Create your first behavior",
        objective: "Add one Root, ALWAYS, and Walk -> Toward Opponent.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "open-code", label: "Open Bot Code", focus: "open-code", hint: "Open the Bot Code workspace to start.", complete: ({ hasOpenedLogic }) => hasOpenedLogic },
            { id: "root", label: "Add a Root", focus: "add-root", hint: "Click + ADD ROOT above.", complete: ({ configuration }) => rootsOf(configuration).length > 0 },
            { id: "always", label: "Add ALWAYS", focus: "add-condition", hint: "Click + CONDITIONAL, Click the + symbol next to the condition, then choose ALWAYS.", complete: ({ configuration }) => hasCondition(configuration, always) },
            { id: "walk", label: "Add Walk", focus: "add-action", hint: "Click + ACTION, choose Walk.", complete: ({ configuration }) => hasAction(configuration, movement("toward")) },
        ],
    },
    {
        lessonNumber: "02",
        eyebrow: "DISTANCE + HP",
        title: "Approach and retreat",
        objective: "Use health and distance to choose how your bot moves.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "retreat", label: "Add low-HP retreat", focus: "add-condition", hint: "When My HP is below 45, walk Away. Click the green node to configure target.", complete: ({ configuration }) => hasConditionAndAction(configuration, (condition) => numericCondition(condition, "my.hp", "lt", 45), movement("away")) },
            { id: "approach", label: "Add approach rule", focus: "add-condition", hint: "When Target Distance is above 100, walk Toward.", complete: ({ configuration }) => hasConditionAndAction(configuration, (condition) => numericCondition(condition, "target.distance", "gt", 100, "opponent"), movement("toward")) },
            { id: "run", label: "Run your bot", focus: "play", hint: "Close the workspace and press PLAY.", complete: runComplete },
        ],
    },
    {
        lessonNumber: "03",
        eyebrow: "ROTATE TO FACE",
        title: "Turn before you strike",
        objective: "Land Heavy Slash within 2 seconds.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Heavy Slash within 2 seconds", focus: "play", hint: "Press PLAY and land Heavy Slash before the timer expires.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "BUILD THE ATTACK", title: "Rotate, close, then Heavy Slash", copy: "Add Rotate: Face Target, a close-in movement rule, and Heavy Slash. Then run the bot.", focus: "add-action" },
    },
    {
        lessonNumber: "04",
        eyebrow: "LOCK ON + ATTACK",
        title: "Aim, then attack",
        objective: "Land Heavy Slash within 1 second.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Heavy Slash within 1 second", focus: "play", hint: "Press PLAY and land Heavy Slash before the timer expires.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "BUILD THE ATTACK", title: "Lock On, close, then Heavy Slash", copy: "Add Lock On, a close-in movement rule, and Heavy Slash. Then run the bot.", focus: "add-action" },
    },
    {
        lessonNumber: "05",
        eyebrow: "DODGE A PROJECTILE",
        title: "Dodge the grenade",
        objective: "Survive for 3 seconds without getting hit by the grenade.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Survive for 3 seconds", focus: "play", hint: "Press PLAY and stay clear until the grenade detonates.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "DODGE THE GRENADE", title: "Dash clear", copy: "Target the grenade and add Dash in any direction. Then run the bot.", focus: "add-action" },
    },
    {
        lessonNumber: "06",
        eyebrow: "COMBINE THE FUNDAMENTALS",
        title: "Make the whole plan work",
        objective: "Land Heavy Slash without taking damage within 3 seconds.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Heavy Slash without taking damage within 3 seconds", focus: "play", hint: "Press PLAY and complete the three-second challenge.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "COMBINE THE PLAN", title: "Keep the tactics together", copy: "Keep the dodge, face the target, close the gap, and use Heavy Slash.", focus: "add-action" },
    },
    {
        lessonNumber: "07",
        eyebrow: "SURVIVE TEN SECONDS",
        title: "Stay alive while attacking",
        objective: "Survive for 10 seconds while attacking.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Survive for 10 seconds", focus: "play", hint: "Press PLAY and stay alive for the full run.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "SURVIVE THE FIGHT", title: "Retreat before low HP", copy: "Add a low-HP retreat and keep attacking while you are healthy.", focus: "add-condition" },
    },
    {
        lessonNumber: "08",
        eyebrow: "BOOLEAN VARIABLES",
        title: "Name your attack window",
        objective: "Use a boolean custom variable to decide when Heavy Slash is ready.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "challenge", label: "Replace Heavy Slash conditions", focus: "play", hint: "Press PLAY when Heavy Slash uses your boolean variable.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "BOOLEAN VARIABLES", title: "Make Heavy Slash Ready", copy: "This code starts from Rotate, approach, and Heavy Slash. Create Heavy Slash Ready from target distance and relative bearing, then use it instead of Heavy Slash's two conditions.", focus: "custom-variables" },
    },
    {
        lessonNumber: "09",
        eyebrow: "INTEGER VARIABLES",
        title: "Count your hits",
        objective: "Use an integer custom variable to count hits, then Dash Away after three.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "challenge", label: "Count hits and Dash Away", focus: "play", hint: "Press PLAY when Hits Landed adds one per hit and triggers Dash Away at three.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "INTEGER VARIABLES", title: "Count hits", copy: "Create Hits Landed as an integer. Use ALWAYS for Pistol Shot, Concussive Shot, and Rail Shot, add one for each confirmed hit, then Dash Away after three.", focus: "custom-variables" },
    },
    {
        lessonNumber: "10",
        eyebrow: "SEARCH ROOTS",
        title: "Reorder a large code plan",
        objective: "Delete roots B, O, and T, then configure root Q with Search Roots.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "challenge", label: "Validate the named-root setup", focus: "play", hint: "Press PLAY when the 17 named roots are ready.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "SEARCH ROOTS", title: "Find and configure root Q", copy: "Delete roots B, O, and T, find root Q, then add ALWAYS -> Walk -> Toward Opponent.", focus: "search-roots" },
    },
    {
        lessonNumber: "11",
        eyebrow: "ROUND ABILITIES",
        title: "Plan your ability draft",
        objective: "Open the Ability Catalogue and see what each round can offer.",
        abilityCatalogue: true,
    },
    {
        lessonNumber: "12",
        eyebrow: "CONDITIONALS",
        title: "Choose when actions run",
        objective: "Open the Conditional Catalogue to review the checks your bot can read.",
        conditionalCatalogue: true,
    },
];

// eslint-disable-next-line react-refresh/only-export-components
export function getTutorialProgress(step, configuration, { hasOpenedLogic = false, isAutoPlaying = false, challenge = null } = {}) {
    const lesson = LESSONS[step] ?? LESSONS[0];
    const context = { configuration, hasOpenedLogic, isAutoPlaying, challenge };
    const objectives = lesson.objectives ?? [];
    const completedIds = objectives.filter((objective) => objective.complete(context)).map((objective) => objective.id);
    const active = objectives.find((objective) => !completedIds.includes(objective.id));
    return {
        completedIds,
        activeId: active?.id ?? null,
        focus: active?.focus ?? (lesson.interactive ? "play" : null),
        allComplete: objectives.length > 0 && completedIds.length === objectives.length,
    };
}

// eslint-disable-next-line react-refresh/only-export-components
export function getTutorialCoach(step, progress = null) {
    const lesson = LESSONS[step] ?? LESSONS[0];
    if (lesson.workspaceCoach) return lesson.workspaceCoach;
    const active = lesson.objectives?.find((objective) => objective.id === progress?.activeId);
    if (active) {
        return { eyebrow: active.label.toUpperCase(), title: active.label, copy: active.hint, focus: active.focus };
    }
    if (lesson.interactive) {
        return { eyebrow: "LESSON READY", title: "Run your bot", copy: "Close Bot Code, then press PLAY.", focus: "play" };
    }
    return null;
}

export function TutorialCodeCoach({ step, progress, onShowSolution, solutionShown }) {
    const coach = getTutorialCoach(step, progress);
    if (!coach) return null;

    return (
        <aside className="tutorial-coach absolute right-5 top-24 z-30 w-64 rounded-xl border border-cyan-400/40 bg-[#07111cf2] p-3.5 shadow-2xl" aria-label="Current tutorial hint">
            <p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">{coach.eyebrow}</p>
            <h2 className="mt-2 text-sm font-bold leading-tight text-white">{coach.title}</h2>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-300">{coach.copy}</p>
            {onShowSolution && <button type="button" onClick={onShowSolution} className="mt-3 text-[9px] font-semibold text-slate-400 underline decoration-slate-600 underline-offset-2 hover:text-cyan-200">Stuck? {solutionShown ? "Reset" : "Show me"}</button>}
        </aside>
    );
}

export default function TutorialGuide({ step, onStepChange, challenge, onAbilityCatalogue, onConditionalCatalogue, progress }) {
    const [minimized, setMinimized] = useState(false);
    const current = LESSONS[step] ?? LESSONS[0];
    const completedIds = new Set(progress?.completedIds ?? []);
    const canAdvance = !current.objectives?.length || progress?.allComplete;

    if (minimized) {
        return (
            <button type="button" onClick={() => setMinimized(false)} className="fixed left-4 top-20 z-30 flex items-center gap-2 rounded-lg border border-cyan-400/40 bg-[#07111cf2] px-3 py-2 text-left shadow-2xl" aria-label="Expand tutorial">
                <span className="font-mono text-[9px] font-bold tracking-[.16em] text-cyan-300">{current.lessonNumber} {current.eyebrow} - {step + 1}/{LESSONS.length}</span>
                <span aria-hidden="true" className="text-sm text-slate-300">+</span>
            </button>
        );
    }

    const activeObjective = current.objectives?.find((objective) => !completedIds.has(objective.id));

    return (
        <section className="fixed left-4 top-20 z-30 w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-400/30 bg-[#07111cf2] shadow-[0_18px_50px_rgba(0,0,0,.48)]" aria-label="Tutorial mission tracker">
            <div className="h-1 rounded-t-xl bg-gradient-to-r from-cyan-400 via-indigo-500 to-transparent" />
            <div className="p-3.5">
                <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[9px] font-bold tracking-[.18em] text-cyan-300">{current.lessonNumber} - {current.eyebrow}</p>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-slate-500">{step + 1}/{LESSONS.length}</span>
                        <button type="button" onClick={() => setMinimized(true)} className="rounded border border-white/10 px-2 py-0.5 text-sm leading-4 text-slate-300 hover:bg-white/10" aria-label="Minimize tutorial" title="Minimize tutorial">-</button>
                    </div>
                </div>
                <h2 className="mt-3 text-base font-bold leading-tight text-white">{current.title}</h2>
                <p className="mt-1.5 text-[11px] leading-4 text-slate-300">{current.objective}</p>

                {current.objectives?.length > 0 && (
                    <ol className="mt-4 space-y-2" aria-label="Lesson objectives">
                        {current.objectives.map((objective) => {
                            const complete = completedIds.has(objective.id);
                            const active = activeObjective?.id === objective.id;
                            return (
                                <li key={objective.id} className={`flex items-center gap-2 text-[10px] ${complete ? "text-emerald-300" : active ? "text-white" : "text-slate-500"}`}>
                                    <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border font-mono text-[9px] ${complete ? "border-emerald-400/70 bg-emerald-950/60" : active ? "border-cyan-300 bg-cyan-950/60 text-cyan-200" : "border-slate-600"}`} aria-hidden="true">{complete ? "✓" : active ? "•" : "○"}</span>
                                    <span>{objective.label}</span>
                                </li>
                            );
                        })}
                    </ol>
                )}

                {activeObjective && <p className="mt-4 border-l-2 border-indigo-400 pl-2.5 text-[10px] leading-4 text-indigo-100">{activeObjective.hint}</p>}
                {current.challenge && <ChallengeStatus challenge={challenge} />}
                {current.abilityCatalogue && onAbilityCatalogue && <button type="button" onClick={onAbilityCatalogue} className="mt-4 w-full rounded border border-cyan-400/50 bg-cyan-950/30 px-3 py-2 text-[9px] font-bold text-cyan-100">OPEN ABILITY CATALOGUE</button>}
                {current.conditionalCatalogue && onConditionalCatalogue && <button type="button" onClick={onConditionalCatalogue} className="mt-4 w-full rounded border border-cyan-400/50 bg-cyan-950/30 px-3 py-2 text-[9px] font-bold text-cyan-100">OPEN CONDITIONAL CATALOGUE</button>}

                <div className="mt-4 flex items-center border-t border-white/10 pt-3">
                    {step > 0 && <button type="button" onClick={() => onStepChange(step - 1)} className="testing-mono font-mono text-[9px] font-bold tracking-[.045em] text-slate-500 hover:text-slate-200">BACK</button>}
                    {canAdvance && step < LESSONS.length - 1 && <button type="button" onClick={() => onStepChange(step + 1)} className="testing-mono ml-auto font-mono text-[9px] font-bold tracking-[.045em] text-cyan-200 hover:text-white">NEXT LESSON</button>}
                </div>
            </div>
        </section>
    );
}

const CHALLENGE_MESSAGES = {
    ready: "Build the lesson code, then press Play.",
    ready_again: "Press Play to run this lesson again.",
    stopped: "Run stopped. Press Play when you are ready to restart.",
    demonstration_running: "Demonstration running.",
    reading_code: "Reading your code...",
    heavy_slash_passed: "Heavy Slash landed. You passed.",
    heavy_slash_timed_out: "Heavy Slash did not land before time expired.",
    dodge_passed: "The grenade detonated safely. You passed.",
    dodge_took_damage: "The grenade connected. Adjust the dash direction or timing, then restart.",
    dodge_timed_out: "The grenade did not detonate before time expired.",
    combo_passed: "Clean dodge and confirmed hit. You passed.",
    combo_took_damage: "The grenade connected. Adjust the dodge rule, then restart.",
    combo_timed_out: "Time expired before Heavy Slash landed. Restart the run.",
    survive_passed: "Ten seconds complete. Your bot stayed alive.",
    survive_defeated: "Your bot was defeated. Add an HP retreat and try again.",
    search_passed: "All 17 named roots are correct.",
    search_failed: "Check the B, O, and T deletions and the root Q setup.",
    boolean_passed: "Heavy Slash is using the boolean variable.",
    boolean_failed: "Replace Heavy Slash's range conditions with Heavy Slash Ready.",
    variables_passed: "The hit counter, ALWAYS attacks, and Dash Away are wired correctly.",
    variables_failed: "Check Hits Landed, the ALWAYS ability branches, and Dash Away after three.",
};

function ChallengeStatus({ challenge }) {
    const status = challenge ?? { status: "idle", remainingMs: 0, code: "ready" };
    const message = CHALLENGE_MESSAGES[status.code];
    return (
        <div className={`mt-4 rounded-lg border p-2 ${status.status === "passed" ? "border-emerald-400/50 bg-emerald-950/40" : status.status === "failed" ? "border-rose-400/50 bg-rose-950/40" : "border-cyan-400/30 bg-cyan-950/25"}`}>
            <div className="flex items-center justify-between font-mono text-[9px] font-bold"><span>{status.status.toUpperCase()}</span><span className="text-cyan-200">{(status.remainingMs / 1000).toFixed(1)}s</span></div>
            {message && <p className="mt-1 text-[8px] leading-3 text-slate-300">{message}</p>}
        </div>
    );
}
