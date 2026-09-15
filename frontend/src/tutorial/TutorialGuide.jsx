import { useEffect, useState } from "react";
import { BOT_CODE_ACTIONS, BOT_CODE_SELECTABLES } from "../gameArena/botlogic/code/contracts/BotLogicContracts.js";
import { loadTutorialGuideProgress, saveTutorialGuideProgress } from "../gameArena/persistence/tutorialStorage.js";

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
    return branch?.action ? [{ action: branch.action, selectable: branch.selectable }] : [];
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

function customVariableNamed(configuration, name) {
    return (configuration?.customVariables ?? []).find((variable) => variable?.name === name);
}

function hasVariableActionThatAddsOne(configuration) {
    const variable = customVariableNamed(configuration, "Variable 1");
    if (!variable) return false;
    return hasAction(configuration, (action) => {
        if (action?.action !== BOT_CODE_ACTIONS.VARIABLE || action.variableId !== variable.id) return false;
        if (action.operation === "add" && Number(action.value) === 1) return true;
        return (action.terms ?? []).some((term) => (
            term?.operator === "add"
            && term.operand?.type === "number"
            && Number(term.operand.value) === 1
        ));
    });
}

function numericCondition(condition, left, comparator, value, leftSelectable = undefined) {
    const pairVariable = [
        "selectable.distance",
        "selectable.absoluteBearing",
        "selectable.relativeBearing",
        "selectable.relativeBearingClockwise",
        "selectable.relativeBearingCounterclockwise",
    ].includes(left);
    const selectableMatches = !leftSelectable
        ? true
        : pairVariable
            ? condition?.selectable1 === BOT_CODE_SELECTABLES.MY && condition?.selectable2 === leftSelectable
            : condition?.leftSelectable === leftSelectable;
    return condition?.type === "expression"
        && condition.left === left
        && condition.comparator === comparator
        && Number(condition.right?.value) === value
        && selectableMatches;
}

const always = (condition) => condition?.type === "always";
const movement = (direction, selectable = BOT_CODE_SELECTABLES.OPPONENT) => (action) => (
    action?.action === BOT_CODE_ACTIONS.MOVE_WALK
    && (action.movementMode ?? "target") === "target"
    && Number(action.movementDirection ?? 0) === direction
    && (action.selectable ?? BOT_CODE_SELECTABLES.OPPONENT) === selectable
);

const UNORDERED_LESSON_CONTENT = [
    {
        lessonNumber: "1",
        eyebrow: "ARENA BASICS",
        title: "Get comfortable in the arena",
        objective: "Learn the basic arena tools.",
        steps: [
            "Select OPEN BOT CODE in the panel under the arena or on the right to view the code workspace.",
            "Select MEASURE to measure distances or coordinates by selecting anywhere in the arena.",
            "Select the bots to move or rotate them.",
            "You can zoom in on the arena, or pan it while zoomed in.",
            "For the rest of the tutorial, you will not be able to select and move the bots as there will be objectives for you to complete."
        ],
    },
    {
        lessonNumber: "2",
        eyebrow: "BUILD A BRAIN",
        title: "Create your first set of instructions.",
        objective: "Add one Root, ALWAYS, and Walk -> 0° from Opponent.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "workspace", label: "Follow the instructions in the workspace", complete: ({ configuration }) => rootsOf(configuration).length > 0 && hasCondition(configuration, always) && hasAction(configuration, movement(0)) },
        ],
        workspaceCoach: {
            steps: [
                { eyebrow: "BUILD THE RULE", title: "Add a root", copy: "Click + ADD ROOT to create the first place for your instructions.", focus: "add-root", complete: ({ configuration }) => rootsOf(configuration).length > 0 },
                { eyebrow: "ADD A CONDITION", title: "Choose ALWAYS", copy: "Click + CONDITIONAL, select the condition, and choose ALWAYS.", focus: "add-condition", complete: ({ configuration }) => hasCondition(configuration, always) },
                { eyebrow: "ADD MOVEMENT", title: "Walk toward the opponent", copy: "Click + ACTION, choose Walk, target Opponent 1, and set the relative angle to 0°.", focus: "add-action", complete: ({ configuration }) => hasAction(configuration, movement(0)) },
            ],
        },
    },
    {
        lessonNumber: "3",
        eyebrow: "DISTANCE + HP",
        title: "Approach and retreat",
        objective: "Use health and distance to choose how your bot moves.",
        interactive: true,
        solution: true,
        objectives: [
            { id: "workspace", label: "Follow the instructions in the workspace", complete: ({ configuration }) => hasConditionAndAction(configuration, (condition) => numericCondition(condition, "selectable.hp", "lt", 45, BOT_CODE_SELECTABLES.MY), movement(180)) && hasConditionAndAction(configuration, (condition) => numericCondition(condition, "selectable.distance", "gt", 100, BOT_CODE_SELECTABLES.OPPONENT), movement(0)) },
        ],
        workspaceCoach: {
            steps: [
                { eyebrow: "RETREAT AT LOW HP", title: "Add the retreat rule", copy: "Add a conditional where Entity HP for My Bot is below 45. Under it, add Walk at 180° from Opponent 1.", focus: "add-condition", complete: ({ configuration }) => hasConditionAndAction(configuration, (condition) => numericCondition(condition, "selectable.hp", "lt", 45, BOT_CODE_SELECTABLES.MY), movement(180)) },
                { eyebrow: "APPROACH FROM RANGE", title: "Add the approach rule", copy: "Add another conditional where Distance Between My Bot and Opponent 1 is above 100. Under it, add Walk at 0° from Opponent 1.", focus: "add-condition", complete: ({ configuration }) => hasConditionAndAction(configuration, (condition) => numericCondition(condition, "selectable.distance", "gt", 100, BOT_CODE_SELECTABLES.OPPONENT), movement(0)) },
                { eyebrow: "WATCH THE BEHAVIOR", title: "Run your bot", copy: "Close the workspace and press PLAY to see the bot approach while healthy and retreat when its HP drops below 45.", focus: "play" },
            ],
        },
    },
    {
        lessonNumber: "4",
        eyebrow: "USE YOUR BASIC STRIKE",
        title: "Land Basic Strike",
        objective: "Use Basic Strike to land a direct hit.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Basic Strike", focus: "play", hint: "Press PLAY and let Basic Strike connect with the opponent.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "BASIC STRIKE", title: "Add an attack", copy: "Add Basic Strike under an ALWAYS condition. Your bot is already in range and facing the opponent, so run the bot and land the hit.", focus: "add-action" },
    },
    {
        lessonNumber: "5",
        eyebrow: "ROTATE TO FACE",
        title: "Turn before you strike",
        objective: "Land Heavy Slash within 2 seconds.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Heavy Slash within 2 seconds", focus: "play", hint: "Press PLAY and land Heavy Slash before the timer expires.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "BUILD THE ATTACK", title: "Rotate, check, then Heavy Slash", copy: "Add Rotate: Face Target. Use Relative Bearing to ensure you only use Heavy Slash when it will hit. Then run the bot.", focus: "add-action" },
    },
    {
        lessonNumber: "6",
        eyebrow: "LOCK ON + ATTACK",
        title: "Aim, then attack",
        objective: "Land Heavy Slash within 1 second.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Heavy Slash within 1 second", focus: "play", hint: "Press PLAY and land Heavy Slash before the timer expires.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "BUILD THE ATTACK", title: "Lock On, then Heavy Slash", copy: "Add Lock On and Heavy Slash. Then run the bot.", focus: "add-action" },
    },
    {
        lessonNumber: "7",
        eyebrow: "DODGE A PROJECTILE",
        title: "Dodge the grenade",
        objective: "Survive for 3 seconds without getting hit by the grenade.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Survive for 3 seconds", focus: "play", hint: "Press PLAY and stay clear until the grenade detonates.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "DODGE THE GRENADE", title: "Dash clear", copy: "Target Opponent and set Dash to 90° relative to it. Then run the bot.", focus: "add-action" },
    },
    {
        lessonNumber: "8",
        eyebrow: "COMBINE THE FUNDAMENTALS",
        title: "Make the whole plan work",
        objective: "Land Heavy Slash without taking damage within 3 seconds.",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Land Heavy Slash without taking damage within 3 seconds", focus: "play", hint: "Press PLAY and complete the three-second challenge.", complete: runComplete },
        ],
        workspaceCoach: { eyebrow: "COMBINE THE PLAN", title: "Keep the tactics together", copy: "Keep Dash targeted to the grenade, face the target, close the gap, and use Heavy Slash.", focus: "add-action" },
    },
    {
        lessonNumber: "9",
        eyebrow: "ADVANCED TUTORIAL",
        title: "Orbiting a target",
        objective: "There is a limit to rotation speed. Using a combination of dashing, walking, and Lock On, can you find a way to get extra hits in without getting hit yourself?",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Defeat the opponent", focus: "play", hint: "Build your orbiting tactics, then press PLAY and defeat the opponent bot.", complete: runComplete },
        ],
        workspaceCoach: {
            manualNavigation: true,
            steps: [
                {
                    eyebrow: "BUILD LOCK ON",
                    title: "Turn back toward the opponent",
                    copy: "Add a root with Relative Bearing between My Bot and Opponent 1 greater than or equal to 90°. Add Lock On as its action.",
                    focus: "add-condition",
                },
                {
                    eyebrow: "BUILD THE DASH",
                    title: "Dash into the orbit",
                    copy: "Add a root with two conditions: Distance Between My Bot and Opponent 1 less than or equal to 60, and My Bot's Lock On Ready equal to true. Add Dash at 45° from Opponent 1.",
                    focus: "add-action",
                },
                {
                    eyebrow: "BUILD MOVEMENT",
                    title: "Circle near, approach diagonally",
                    copy: "Add a root with two conditionals. At 60 units or closer, Walk at 90° from Opponent 1. Above 60 units, Walk at 45° from Opponent 1.",
                    focus: "add-action",
                },
                {
                    eyebrow: "KEEP YOUR AIM",
                    title: "Face the opponent",
                    copy: "Add a root with an ALWAYS condition and Rotate: Face Target toward Opponent 1.",
                    focus: "add-action",
                },
                {
                    eyebrow: "ADD SLASH",
                    title: "Use Slash whenever it is ready",
                    copy: "Add a root with an ALWAYS condition and Slash targeting Opponent 1.",
                    focus: "add-action",
                },
                {
                    eyebrow: "ADD BASIC STRIKE",
                    title: "Finish the attack cycle",
                    copy: "Add one final root with an ALWAYS condition and Basic Strike targeting Opponent 1. Close the workspace, press PLAY, and defeat the opponent.",
                    focus: "play",
                },
            ],
        },
    },
    {
        lessonNumber: "10",
        eyebrow: "ADVANCED TUTORIAL",
        title: "Attacking when they are vulnerable 1",
        objective: "Bot Ability variables reveal whether an ability is ready, preparing, active, or on cooldown, along with how much preparation, active, or cooldown time remains. Use that information to decide when to approach, dodge, and attack.",
        details: [
            "My Bot starts 300 units away with 40 HP. The opponent uses Rail Shot within 250 units and Heavy Slash within 100 units.",
            "Rail Shot takes 0.9 seconds to prepare. Heavy Slash takes 0.3 seconds to prepare.",
            "Bait those abilities, avoid them while they prepare, and take space or attack while their cooldowns leave the opponent vulnerable.",
        ],
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Defeat the opponent before My Bot is defeated", hint: "Check the workspace for a guide.", complete: runComplete },
        ],
        workspaceCoach: {
            manualNavigation: true,
            steps: [
                {
                    eyebrow: "DODGE PREPARED ATTACKS",
                    title: "Dodge prepared attacks",
                    copy: "Condition 1 checks that Opponent 1's Rail Shot is preparing and has at most 0.2 seconds of Preparation Time Left, then Dashes 90° from Opponent 1. Condition 2 checks whether Heavy Slash is preparing, then Dashes 180° away.",
                },
                {
                    eyebrow: "ALLOW ONE TICK",
                    title: "Why dash with 0.2 seconds left?",
                    copy: "You might be wondering: Why don't we dash when Rail Shot's Preparation Time Left is 0.1 seconds? Bots process a condition such as 0.1 seconds and execute the action one tick later. It takes one tick to process and activate, so the bot would begin dashing as Rail Shot activates, not before it activates.",
                },
                {
                    eyebrow: "CONTROL DISTANCE",
                    title: "Control distance and approach",
                    copy: "Condition 1 Walks 120° away when Dash is on cooldown inside 100 units. Condition 2 Walks at 90° inside 90 units. Condition 3 Walks at 30° when Dash is ready OR when both enemy attacks are on cooldown. The final ALWAYS condition Walks at 90° as the fallback.",
                },
                {
                    eyebrow: "KEEP YOUR AIM",
                    title: "Keep the opponent faced",
                    copy: "The ALWAYS condition continuously Faces Opponent 1 so movement and dodging do not leave My Bot aimed away from its target.",
                },
                {
                    eyebrow: "PUNISH THE COOLDOWN",
                    title: "Attack during recovery",
                    copy: "When Opponent 1's Heavy Slash Cooldown Time Left is greater than 0.5 seconds, use Slash. This preserves enough time for Slash to finish before Dash is needed again.",
                },
            ],
        },
    },
    {
        lessonNumber: "11",
        eyebrow: "ADVANCED TUTORIAL",
        title: "Attacking when they are vulnerable 2",
        objective: "Apply the same Bot Ability and cooldown tactics to a faster threat.",
        details: [
            "Sometimes an ability cannot be dodged by moving left, right, or away. Stun prepares quickly and covers too much space for a normal retreat. What is the fastest way to get behind the opponent?",

        ],
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Defeat the opponent before My Bot is defeated", hint: "Dash at 0° through the opponent when you are within Stun range, retreat from Heavy Slash, and punish both cooldowns.", complete: runComplete },
        ],
        workspaceCoach: {
            manualNavigation: true,
            steps: [
                {
                    eyebrow: "VULNERABILITY",
                    title: "Attacking hints",
                    copy: "Stun is too quick and wide to dodge normally. When you are within 120 units and Stun is ready, Dash at 0° toward the opponent to pass through and get behind it.",
                },
                {
                    eyebrow: "VULNERABILITY",
                    title: "Attacking hints",
                    copy: "If Heavy Slash begins preparing, Dash 180° and Walk 180° away. Putting both actions under the same node keeps the retreat going even when Dash cannot activate.",
                },
                {
                    eyebrow: "READ THE OPENING",
                    title: "Attacking hints",
                    copy: "Approach when you are more than 80 units away and your Dash is ready. That gives you a way in while ensuring you can dodge when needed. What other conditions should you consider checking before you move towards the bot?",
                },
                {
                    eyebrow: "GROUP THE ALTERNATIVE",
                    title: "Attacking hints",
                    copy: "Another set of conditions you should consider is if Stun is on cooldown, Heavy Slash is on cooldown, and distance is greater than 80. You might notice as you're testing, you still get stunned at some point.",
                },
                {
                    eyebrow: "ACCOUNT FOR ACCELERATION",
                    title: "Check when Stun is almost ready",
                    copy: "Check whether the opponent's Stun Cooldown Time Left is 0.8 seconds or less. Acceleration makes it so that when you come to a stop, it doesn't happen exactly at 80 units away. This results in a wobble. Your bot gets stunned because it moves back at the same time the stun is ready, giving the ability more time to hit it. Acceleration is 50% of max speed per tick.",
                },
                {
                    eyebrow: "HOLD THE EDGE",
                    title: "Attacking hints",
                    copy: "Use a separate root to Walk 180° away whenever you are within 120 units. Your higher-priority Dash branches can still take over when their specific openings appear. This is a fallback when you should not approach.",
                },
                {
                    eyebrow: "PUNISH THE COOLDOWN",
                    title: "Attacking hints",
                    copy: "Always face the opponent, but only Slash when Heavy Slash has more than 0.5 seconds of cooldown left. This attacks during the safe part of its recovery.",
                },
                {
                    eyebrow: "KEEP YOUR AIM",
                    title: "Attacking hints",
                    copy: "If the relative bearing from My Bot to Opponent 1 is greater than 90°, use Lock On. This snaps your aim onto the target once you dash through it. Dash and Lock.",
                },
            ],
        },
    },
    {
        lessonNumber: "13",
        eyebrow: "ADVANCED TUTORIAL",
        title: "Combo and Kite",
        objective: "Use a custom variable to execute Stun and Heavy Slash in order, then kite until the combo is ready again.",
        details: [
            "My Bot has only 1 HP and cannot afford a hit. The opponent constantly pursues and uses Slash and Basic Strike, using Lock On whenever you are close but outside the Slash arc.",
            "My Bot has Stun, Heavy Slash, and Wind Burst. Stun the opponent, close into Heavy Slash range, then retreat until Stun is ready again. Use Wind Burst when the opponent traps you near an arena edge.",
        ],
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Defeat the opponent without taking a hit", hint: "Build the two-step combo, preserve your spacing, and use Wind Burst to escape edge pressure.", complete: runComplete },
        ],
        workspaceCoach: {
            manualNavigation: true,
            steps: [
                { eyebrow: "BUILD THE COMBO", title: "Combo and kiting hints", copy: "Create a number variable named Combo Step starting at 0. It will remember whether Stun or Heavy Slash comes next." },
                { eyebrow: "COMBO STEP 0", title: "Combo and kiting hints", copy: "When distance is at most 184, Combo Step is 0, and Stun is ready, use Stun and add 1 to Combo Step." },
                { eyebrow: "COMBO STEP 1", title: "Combo and kiting hints", copy: "When distance is at most 100 and Combo Step is 1, use Heavy Slash and reset Combo Step to 0." },
                { eyebrow: "FINISH THE COMBO", title: "Combo and kiting hints", copy: "While Combo Step is not 0 and the opponent is farther than 80 units, Walk at 0° toward Opponent 1 to enter Heavy Slash range." },
                { eyebrow: "ESCAPE THE EDGE", title: "Combo and kiting hints", copy: "Give the edge check first priority in that movement root. If My Bot is within 150 units of an arena edge, Walk 120° from Opponent 1 instead of continuing backward." },
                { eyebrow: "KITE THE TARGET", title: "Combo and kiting hints", copy: "In another root, move toward the opponent at 0° while farther than 300 units. When closer than 300, Stun is not ready, and Combo Step is 0, Dash and Walk 180° away." },
                { eyebrow: "MAKE SPACE", title: "Combo and kiting hints", copy: "Always face Opponent 1. Use Wind Burst inside 150 units only while Stun is not ready and Combo Step is 0, so it does not interrupt your combo." },
            ],
        },
    },
    {
        lessonNumber: "12",
        eyebrow: "CUSTOM VARIABLES",
        title: "Make a number grow",
        objective: "Increase Variable 1 by 5",
        interactive: true,
        solution: true,
        challenge: true,
        objectives: [
            { id: "challenge", label: "Increase Variable 1 by 5", focus: "play", hint: "Press PLAY and make the Variable 1 value increase by 5.", complete: runComplete },
        ],
        workspaceCoach: {
            steps: [
                {
                    eyebrow: "CUSTOM VARIABLES",
                    title: "Add Variable 1",
                    copy: "Click CUSTOM VARIABLES, then + ADD VARIABLE. Keep the name as Variable 1, the type as NUMBER, and the starting value at 0. Close the panel when you are done.",
                    focus: "custom-variables",
                    complete: ({ configuration }) => Boolean(customVariableNamed(configuration, "Variable 1")),
                },
                {
                    eyebrow: "BUILD THE RULE",
                    title: "Add a root",
                    copy: "Click + ADD ROOT to create the first place for your rule.",
                    focus: "add-root",
                    complete: ({ configuration }) => rootsOf(configuration).length > 0,
                },
                {
                    eyebrow: "BUILD THE RULE",
                    title: "Choose ALWAYS",
                    copy: "Click + CONDITIONAL, then set the condition to ALWAYS.",
                    focus: "add-condition",
                    complete: ({ configuration }) => hasCondition(configuration, always),
                },
                {
                    eyebrow: "MODIFY THE VARIABLE",
                    title: "Add a +1 action",
                    copy: "Click + ACTION and select Variable: Modify Custom Variable. Choose Variable 1, set the operator to +, and enter 1.",
                    focus: "add-action",
                    complete: ({ configuration }) => hasVariableActionThatAddsOne(configuration),
                },
                {
                    eyebrow: "RUN THE LESSON",
                    title: "Increase Variable 1 by 5",
                    copy: "Close the workspace and press PLAY. The challenge checks that Variable 1 increases by 5 from its starting value of 0.",
                    focus: "play",
                    complete: runComplete,
                },
            ],
        },
    },
    {
        lessonNumber: "13",
        eyebrow: "PRIORITY ORDER",
        title: "Let priority choose the next ability",
        objective: "Learn how root priority decides which ready action runs first.",
        interactive: true,
        solution: true,
        workspaceCoach: {
            manualNavigation: true,
            showSolution: false,
            steps: [
                {
                    eyebrow: "PRIORITY ORDER",
                    title: "Watch Dash go first",
                    copy: "The starter code has Dash at priority 1 and Lock On at priority 2. Close the workspace and press PLAY to watch Dash activate first, then Lock On.",
                    focus: "play",
                },
                {
                    eyebrow: "SWAP PRIORITIES",
                    title: "Change the execution order",
                    copy: "Priority decides which ready ability is chosen first. Change Dash to priority 2 or Lock On to priority 1. This changes priority only; it does not move either root or any node.",
                    focus: "search-roots",
                },
                {
                    eyebrow: "PRIORITY ORDER",
                    title: "Watch Lock On go first",
                    copy: "Run the bot again. Lock On is now priority 1, so it activates before Dash. The same two roots remain in the same canvas positions.",
                    focus: "play",
                },
            ],
        },
    },
    {
        lessonNumber: "14",
        eyebrow: "THE MATCH LOOP",
        title: "How the game works",
        objective: "Learn the rules",
        details: [
            "Each round gives you a selection of abilities. You can optionally set one Guaranteed Offer for each round before queueing; that ability is added to its round's offer pool. In Round 1, you get 6 abilities and choose 3. In round 2, you get 4 abilities and choose 2. In round 3, you get 3 abilities and choose 1.",
            "The safe zone shrinks every 15 seconds. Each shrink lasts 5 seconds, and the danger zone deals damage.",
            "You have 5 minutes to build your bot in 1v1s, 6 minutes for 2v2s.",
            "To start playing, click queue match on the home page.",
        ],
    },
    {
        lessonNumber: "15",
        eyebrow: "ROUND ABILITIES",
        title: "Plan your ability draft",
        objective: "Open the Ability Catalogue and see what each round can offer.",
        abilityCatalogue: true,
    },
    {
        lessonNumber: "16",
        eyebrow: "CONDITIONALS",
        title: "Choose when actions run",
        objective: "Open the Conditional Catalogue to review the checks your bot can read.",
        conditionalCatalogue: true,
    },
    {
        lessonNumber: "17",
        eyebrow: "PUZZLES",
        title: "Do puzzles to improve your skills!",
        objective: "Put your bot-building skills to work against puzzle challenges.",
        puzzles: true,
    },
];

const LESSON_DEFINITIONS = [0, 1, 2, 3, 13, 4, 5, 6, 7, 8, 9, 10, 12, 11, 14, 15, 16, 17]
    .map((definitionIndex, stepIndex) => ({
        ...UNORDERED_LESSON_CONTENT[definitionIndex],
        lessonNumber: String(stepIndex + 1),
    }));
const LESSONS = LESSON_DEFINITIONS;

// eslint-disable-next-line react-refresh/only-export-components
export function getTutorialProgress(step, configuration, { hasOpenedLogic = false, isAutoPlaying = false, challenge = null } = {}) {
    const lesson = LESSONS[step] ?? LESSONS[0];
    const context = { configuration, hasOpenedLogic, isAutoPlaying, challenge };
    const objectives = lesson.objectives ?? [];
    const completedIds = objectives.filter((objective) => objective.complete(context)).map((objective) => objective.id);
    const active = objectives.find((objective) => !completedIds.includes(objective.id));
    const workspaceSteps = lesson.workspaceCoach?.steps ?? [];
    const activeWorkspaceStep = workspaceSteps.findIndex((coachStep) => !coachStep.complete?.(context));
    return {
        completedIds,
        activeId: active?.id ?? null,
        focus: activeWorkspaceStep >= 0
            ? workspaceSteps[activeWorkspaceStep].focus
            : active?.focus ?? (lesson.interactive ? "play" : null),
        workspaceCoachStep: activeWorkspaceStep >= 0 ? activeWorkspaceStep : Math.max(0, workspaceSteps.length - 1),
        allComplete: objectives.length > 0 && completedIds.length === objectives.length,
    };
}

// eslint-disable-next-line react-refresh/only-export-components
export function getTutorialCoach(step, progress = null) {
    const lesson = LESSONS[step] ?? LESSONS[0];
    if (lesson.workspaceCoach?.steps?.length) {
        const coachStep = Math.min(progress?.workspaceCoachStep ?? 0, lesson.workspaceCoach.steps.length - 1);
        return {
            ...lesson.workspaceCoach.steps[coachStep],
            stepIndex: coachStep,
            stepCount: lesson.workspaceCoach.steps.length,
        };
    }
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

export function TutorialCodeCoach({ step, progress, onShowSolution }) {
    const [minimized, setMinimized] = useState(false);
    const [manualProgress, setManualProgress] = useState(() => ({ step, index: loadTutorialGuideProgress(step) }));
    const lesson = LESSONS[step] ?? LESSONS[0];
    const manualNavigation = Boolean(lesson.workspaceCoach?.manualNavigation && lesson.workspaceCoach?.steps?.length);
    const coachLabel = manualNavigation ? "GUIDE" : "FOLLOW ALONG";
    const manualStep = manualProgress.step === step ? manualProgress.index : loadTutorialGuideProgress(step);
    const coach = getTutorialCoach(step, manualNavigation ? { ...progress, workspaceCoachStep: manualStep } : progress);
    useEffect(() => {
        if (!manualNavigation) return;
        const boundedIndex = Math.min(manualStep, Math.max(0, lesson.workspaceCoach.steps.length - 1));
        saveTutorialGuideProgress(step, boundedIndex);
    }, [lesson, manualNavigation, manualStep, step]);
    if (!coach) return null;

    if (minimized) {
        return (
            <button type="button" onClick={() => setMinimized(false)} className="code-workspace-coach-minimized" aria-label="Expand tutorial workspace hint">
                <span className="font-mono text-[8px] font-bold tracking-[.16em] text-cyan-200">{coachLabel}{coach.stepCount > 1 ? ` ${coach.stepIndex + 1}/${coach.stepCount}` : ""}</span>
                <span aria-hidden="true" className="font-mono text-sm text-cyan-200">+</span>
            </button>
        );
    }

    return (
        <aside className="tutorial-coach code-workspace-coach z-30" aria-label="Current tutorial hint">
            {coach.stepCount > 1 && (
                <div className="tutorial-coach-header">
                    <p className="font-mono text-[8px] font-bold tracking-[.18em] text-slate-500">{coachLabel} {coach.stepIndex + 1}/{coach.stepCount}</p>
                    {manualNavigation && (
                        <div className="tutorial-coach-chevron-group" aria-label="Guide navigation">
                            <button type="button" disabled={coach.stepIndex === 0} onClick={() => setManualProgress({ step, index: coach.stepIndex - 1 })} className="tutorial-coach-chevron" aria-label="Previous guide"><span aria-hidden="true">‹</span></button>
                            <button type="button" disabled={coach.stepIndex === coach.stepCount - 1} onClick={() => setManualProgress({ step, index: coach.stepIndex + 1 })} className="tutorial-coach-chevron" aria-label="Next guide"><span aria-hidden="true">›</span></button>
                        </div>
                    )}
                </div>
            )}
            <p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">{coach.eyebrow}</p>
            <h2 className="mt-2 text-sm font-bold leading-tight text-white">{coach.title}</h2>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-300">{coach.copy}</p>
            <button type="button" onClick={() => setMinimized(true)} className="puzzle-info-minimize" aria-label="Minimize tutorial workspace hint" title="Minimize tutorial hint"><span aria-hidden="true">−</span></button>
            {onShowSolution && (!manualNavigation || coach.stepIndex === coach.stepCount - 1) && lesson.workspaceCoach?.showSolution !== false && <button type="button" onClick={onShowSolution} className="arena-toolbar-button tutorial-action-button tutorial-action-button--inline mt-3">Solution</button>}
        </aside>
    );
}

export default function TutorialGuide({ step, onStepChange, challenge, onAbilityCatalogue, onConditionalCatalogue, onPuzzles }) {
    const [minimized, setMinimized] = useState(() => (
        typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches
    ));
    const current = LESSONS[step] ?? LESSONS[0];
    const canAdvance = step < LESSONS.length - 1;

    if (minimized) {
        return (
            <button type="button" onClick={() => setMinimized(false)} className="tutorial-guide-button info-popup-minimized gray-button-surface flex items-center gap-2 rounded-lg border border-cyan-400/40 px-3 py-2 text-left shadow-2xl" aria-label={`Open tutorial step ${step + 1} of ${LESSONS.length}`} aria-expanded="false" aria-controls="tutorial-guide-panel">
                <span className="tutorial-guide-button__label font-mono text-[9px] font-bold tracking-[.16em] text-slate-300">{current.eyebrow} - </span>
                <span className="font-mono text-[10px] font-bold text-cyan-200">{step + 1}/{LESSONS.length}</span>
                <img src="/assets/arena-toolbar/info-circle-icon.png" alt="" aria-hidden="true" className="tutorial-guide-button__icon info-circle-icon h-5 w-5" />
            </button>
        );
    }

    return (
        <section id="tutorial-guide-panel" className="tutorial-guide-panel info-popup-panel w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-400/30 bg-[#07111b] shadow-[0_18px_50px_rgba(0,0,0,.48)]" aria-label="Tutorial mission tracker">
            <div className="tutorial-guide-content p-3.5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="break-words font-mono text-lg font-bold leading-tight text-white">{current.lessonNumber}. {current.title}</p>
                        <p className="mt-1 font-mono text-[9px] font-bold tracking-[.16em] text-cyan-300">{current.eyebrow} · {step + 1}/{LESSONS.length}</p>
                    </div>
                    <button type="button" onClick={() => setMinimized(true)} className="puzzle-info-minimize" aria-label="Minimize tutorial information" title="Minimize tutorial information"><span aria-hidden="true">-</span></button>
                </div>
                <p className="mt-3 text-[11px] leading-4 text-slate-300">{current.objective}</p>
                {current.details?.map((detail) => <p key={detail} className="mt-3 text-[11px] leading-4 text-slate-300">{detail}</p>)}
                {current.steps?.length > 0 && (
                    <ol className="mt-4 space-y-2 text-[11px] leading-4 text-slate-300" aria-label="Tutorial steps">
                        {current.steps.map((instruction, index) => (
                            <li key={instruction} className="flex items-start gap-2">
                                <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full border border-cyan-400/50 bg-cyan-950/40 font-mono text-[9px] text-cyan-200" aria-hidden="true">{index + 1}</span>
                                <span>{instruction}</span>
                            </li>
                        ))}
                    </ol>
                )}

                {current.objectives?.length > 0 && (
                    <p className="mt-4 text-[10px] leading-4 text-slate-300"><span className="mr-1.5 font-mono text-[8px] font-bold tracking-[.16em] text-cyan-300">OBJECTIVE</span>{current.objectives[0].label}</p>
                )}

                {current.challenge && <ChallengeStatus challenge={challenge} />}
                {current.abilityCatalogue && onAbilityCatalogue && <button type="button" onClick={onAbilityCatalogue} className="arena-toolbar-button arena-toolbar-button--blue tutorial-action-button mt-4">OPEN ABILITY CATALOGUE</button>}
                {current.conditionalCatalogue && onConditionalCatalogue && <button type="button" onClick={onConditionalCatalogue} className="arena-toolbar-button arena-toolbar-button--blue tutorial-action-button mt-4">OPEN CONDITIONAL CATALOGUE</button>}
                {current.puzzles && onPuzzles && <button type="button" onClick={onPuzzles} className="arena-toolbar-button arena-toolbar-button--blue tutorial-action-button mt-4">GO TO PUZZLES</button>}

            </div>
            <div className="tutorial-guide-navigation flex flex-none items-center border-t border-white/10 px-3.5 pb-3.5 pt-3">
                {step > 0 && <button type="button" onClick={() => onStepChange(step - 1)} className="arena-toolbar-button tutorial-action-button">BACK</button>}
                {canAdvance && <button type="button" onClick={() => onStepChange(step + 1)} className="arena-toolbar-button arena-toolbar-button--blue tutorial-action-button ml-auto">NEXT LESSON</button>}
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
    basic_strike_passed: "Basic Strike landed. You passed.",
    basic_strike_took_damage: "Your bot took damage before the strike landed. Restart and check the action.",
    basic_strike_timed_out: "Basic Strike did not land before time expired.",
    combo_passed: "Clean dodge and confirmed hit. You passed.",
    combo_took_damage: "The grenade connected. Adjust the dodge rule, then restart.",
    combo_timed_out: "Time expired before Heavy Slash landed. Restart the run.",
    survive_passed: "Ten seconds complete. Your bot stayed alive.",
    survive_defeated: "Your bot was defeated. Add an HP retreat and try again.",
    custom_variable_passed: "Variable 1 increased by 5. You passed.",
    custom_variable_timed_out: "Variable 1 did not increase by 5 before time expired.",
    priority_initial_passed: "Dash activated first, then Lock On. Now swap their priorities.",
    priority_final_passed: "Lock On activated first, then Dash. You saw priority change the ready-ability order.",
    priority_failed: "The required priority order was not shown. Check the two priorities and run again.",
    defeat_opponent_passed: "Opponent defeated. You passed.",
    defeat_opponent_defeated: "Your bot was defeated. Adjust your orbit and try again.",
    defeat_opponent_timed_out: "Time expired before the opponent was defeated.",
    defeat_opponent_survive_passed: "Opponent defeated. You passed.",
    defeat_opponent_survive_defeated: "Your bot was defeated. Bait the attack, retreat during preparation, and try again.",
    defeat_opponent_survive_timed_out: "Time expired before the opponent was defeated.",
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
