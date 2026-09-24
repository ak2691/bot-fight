export const TUTORIAL_INTRODUCTION = Object.freeze([
    "Welcome to Bot Fight Online. This is a game where you code your bot to fight. Every action it takes is based entirely on the program you design.",
    "Conceptually, the mechanics of the game are simple. Bots use abilities. Bots move around the arena. Bots can only use one ability at a time. Abilities go on cooldowns.",
    "What makes this game a little more complicated is that your bot only does what it is programmed to do. It needs to be told exactly when to use an ability, where to look, and when to move.",
    "This game is a test of how well you can design a bot. Think of it as creating your own enemy AI, like the ones you see in RPGs. But don't worry, you don't actually have to type anything.",
    "Well, anyway, you get the gist. Let's start with the building blocks.",
    "The code is built through a prioritized behavior tree. A behavior tree is a path that your bot reads and processes for instructions on what to do. There are three types of nodes in this behavior tree: Root Node, Conditional Node, and Action Node.",
    "A root node is the beginning of a tree; it defines a tree and tells the bot to start here. Each root node has its own priority. Priority 1 is processed first. This matters because bots can only have one ability active at a time. When there is a conflict, the highest-priority root's actions are executed over the lower-priority roots.",
    "The next node is the conditional node. These are the conditions checked before anything branching from the node is executed. A conditional node contains statements that compare game variables to a value. If a statement is true, the bot continues down that path to look for more nodes to process.",
    "Game variables are variables related to the game state itself. They can include positions, distances, angles, ability cooldowns, HP, and more. You have access to every bot's game-state variables, including your own and your opponent's. You do not have access to the opponent's code, however.",
    "Conditional nodes also have priorities. If Conditional 1 is true and Conditional 2 is true, only conditional 1's path is evaluated and the other conditional nodes in the same depth are ignored. This works like if/else-if statements in programming. To explain what a depth is, it is the level of the tree a condition belongs to. Conditions on the same depth are checked by priority, and the highest-priority conditional that is true is the path the bot will continue down. ",
    "The last node is the action node. These are the actions executed when their corresponding conditional node is true. There are three types of bot actions: Rotation, Movement, and Ability. You cannot have more than one of each type executing at the same time, so a bot can execute at most one rotation, one movement, and one ability at a time.",
    "Variables and actions can include extra configuration. A variable such as Bot HP requires a specific bot to inspect. You can select My Bot or Opponent 1, for example. Checking an ability cooldown has two inputs: the bot and the specific ability belonging to that bot. The same idea applies to actions with extra settings, such as choosing who to face when you rotate.",
    "Some actions also have targets. If you want to rotate toward your opponent, select that option in the configuration menu. If you want to aim at a coordinate in the arena, you can select that too.",
    "At its core, you have access to every reasonable variable in the game that does not require rigorous math. You do not need to set up the distance formula yourself, nor do you need trigonometry to find angles.",
    "You can create your own custom variables as well. They can combine existing variables or use basic arithmetic. No multiplication or division, sorry! The game cannot be so complex that it requires every math operator. You can also create boolean variables. A boolean is a simple yes-or-no value, so it can only be true or false.",
    "Alright, enough words. Let's start building!",

]);

export const TUTORIAL_INTRODUCTION_VISUALS = Object.freeze({
    6: "root-priorities",
    7: "conditional-examples",
    10: "action-examples",
    11: "configuration-examples",
    14: "custom-variable-examples",
});

export const TUTORIAL_ENDING = Object.freeze([
    "That was the tutorial! There are still many things to learn, such as what each ability does and what tactics you can come up with. The practice room is a great way to learn about each ability. You can edit the abilities you have with the Edit Loadout button, set up positions, rotations, starting HP, and more. You can also click the ability icons in the stats panel, where the ability timers are shown, to view information about each ability.",
    "Now, how does an actual match play out? A match is best of three rounds. When you start a match, you get 1 minute to select abilities from a randomly chosen pool for that round. After both players have chosen, you get 5 minutes to program your bot in a 1v1 match or 6 minutes in a 2v2 match.",
    "First round: Select 3 abilities from 6 options.\nSecond round: Select 2 abilities from 4 options.\nThird round: Select 1 ability from 3 options.",
    "You can also select a guaranteed offer for each round before a match.",
    "Want to learn more before you fight? The Ability Catalogue explains what every ability and status effect does. The Conditional Catalogue covers the rest of the conditionals and game-state variables you can use to program your bot.",
]);

const instructionSteps = (...items) => Object.freeze({
    type: "steps",
    items: Object.freeze(items),
});

const lesson = (id, title, description, scenarioId = id) => Object.freeze({
    id,
    title,
    description: Object.freeze(description),
    ...(scenarioId ? { scenarioId } : {}),
});

export const TUTORIAL_CATEGORIES = Object.freeze([
    Object.freeze({
        id: "basics",
        title: "Basics",
        description: Object.freeze([]),
        lessons: Object.freeze([
            lesson("first-steps", "First Steps", [
                "Wake your bot up! It needs to move. Start by clicking Open Bot Code. You can open the lesson up inside the workspace.",

                instructionSteps(
                    "Add a root node.",
                    "Add a conditional node by clicking + Conditional. Click the pencil icon to change the variable and select ALWAYS. ALWAYS will always be true.",
                    "Add an action node below the conditional node and select Movement: Walk.",
                    "Click Play to see your code work",
                ),
            ]),
            lesson("retreat", "Retreat", [
                "Sometimes, the bot gets hit. But that is okay! It is a sturdy bot with 150 HP. One hit is perfectly fine. Even two, or three, or four, okay, maybe not that many.",
                instructionSteps(
                    "Add a root, then add a conditional node by clicking + Conditional.",
                    "Click the pencil icon and change the variable to Entity HP. Now it should be in the conditional node. Then click Entity HP to open its configuration menu. Change Opponent 1 to My Bot so this variable is now referencing My Bot.",
                    "Set the statement to Entity HP < 100.",
                    "Add an action node under this condition and select Movement: Walk.",
                    "Click the action node to see its settings. Read through them, and click the i (info icon) to understand how relative direction works.",
                    "Set your bot to walk away from Opponent 1 when its HP falls below 100.",
                ),
            ]),
            lesson("basic-strike", "Basic Strike", [
                "Basic Strike is one of the three base abilities you have. It deals some damage, hits quickly, and has a short range. It can be used between other attacks to deal extra damage. ",
                "Set up the code on your own. Always use Basic Strike.",
            ]),
            lesson("dash-basics", "Dash", [
                "Dash is another one of the three base abilities you have. Your base movement speed is 12 units per tick, and each tick is 100 milliseconds. Dash covers 200 units in two ticks. Pretty good!",
                "Try it out and experiment. Look through all the configuration settings and think about what you can do with dashing. No, seriously, get comfortable with this.",
            ]),
            lesson("aiming-basics", "Aiming", [
                "Use Rotate: Face Target to aim your bot. A bot can track any target you give it, whether that target is another bot, a coordinate in the arena, or an offset from that target.",
                "Experiment with the targeting configurations. The opponent bot will move left and right, and you have the Fireball ability to test your aim.",
            ]),
            lesson("lock-on-basics", "Lock On", [
                "Lock On is the last of the three base abilities. It rotates your bot immediately onto a target. Try it out! It is basically a single-tick aimbot.",
            ]),
        ]),
    }),
    Object.freeze({
        id: "timing",
        title: "Timing",
        description: Object.freeze([
            "If you want to win, you need to maximize the hits you land and minimize the hits your opponent lands.",
            "In a game with cooldowns and abilities, there are a few things to consider before attacking. Will my ability hit if I use it right now? If it will not, what are the reasons why?",
            "Take Fireball as an example. It has two important components: aim and spacing. If you are not within range, Fireball will never hit. If you are within range but are not looking anywhere near the target, Fireball will never hit.",
        ]),
        lessons: Object.freeze([
            lesson("fireballs-in-range", "Shoot Fireballs When You Are Within Range", [
                "Right now, shooting Fireballs will not hit the opponent. Fireball has four charges and takes time to reload. Time is everything. While you are reloading, the opponent can take advantage of the opening and attack you freely. Do not waste those shots!",
                "Create a root and add a conditional node by clicking + Conditional. Set up this statement: If Distance Between Entities is greater than 432, then walk toward Opponent 1. Else if Distance Between Entities is less than or equal to 432, then use Fireball.",
            ]),
            lesson("dont-miss", "Don't Miss", [
                "Fireball is a projectile, so aim matters. Your bot starts about 300 units away from Opponent 1. Keep your bot pointed close to the target before you shoot.",
                "Create a root and add a conditional node by clicking + Conditional. Set up this statement: If Relative Bearing Of Target From Entity (Shortest) is less than or equal to 10 degrees, then use Fireball. At this distance, that keeps the Fireball path within the opponent's hitbox.",
                "Add a new root, add a conditional node by clicking + Conditional, set it to ALWAYS, and add the Rotation: Face Target action to start aiming.",
            ]),
            lesson("dodging", "Dodging", [
                "I hope you are comfortable with dashing. Figure out how to dodge some attacks.",
                "You can dash relative to a target, and that target can be any entity. An entity is something that exists in the arena for some duration. It can be selected in the target options when a bot has an ability that can produce it. If the entity has not spawned yet, the bot will not execute that action.",
                "There are three other settings you need to look at to configure this target correctly. The first is who this ability belongs to. Next is the attribute. Then the order is the ranking of the entity based on the attribute. So closest 1 means the closest entity. Closest 2 means the 2nd closest entity. Oldest and newest depend on how long the entity has existed for in the arena.",
                "Right now, you are close to the opponent and, by unfortunate circumstances, you are also at 1 HP. The opponent has its hand on the pin of a grenade, ready to throw it at you, and it also wants to shoot Fireballs at you. Try to dodge both attacks using only Dash, with no walking. The opponent bot is nice; it will only attack when your Dash is ready.",
                "Notice how you can set up a program such that the bot always dodges and the bot will be fine. However, in some scenarios, a projectile coming your way can be dodged by walking out of the way. Only dash when needed."
            ]),
            lesson("bot-ability-variables", "Bot Ability Variables", [
                "Bot Ability variables tell you valuable information about an ability's usage.",
                "Ability Ready means the ability is not on cooldown, preparing, or active. If no other ability is being used in any way, that means the ability can be used at any time.",
                "Preparation Time Left and Preparing tell you how much time remains in an ability's preparation and whether it is currently being prepared. Preparation is the charge-up or wind-up of an ability. It cannot be canceled unless it is interrupted, and it is a visible commitment to using the ability. No other abilities can be used while an ability is preparing or active.",
                "Cooldown Time and On Cooldown tell you how much time remains before the cooldown is over and whether the ability is currently on cooldown.",
                "One important timing detail: actions execute one tick after conditions are processed. For example, if the condition Cooldown Time is 0.1 seconds is true, the associated action executes one tick later, when the cooldown timer reaches 0 seconds.",
                "Now experiment with this information. You have Slash, a decent melee attack. Your opponent has Heavy Slash and uses it constantly, without a care in the world. Your bot has 1 HP, so use your timing conditions to attack when Heavy Slash is not ready and dash away whenever you need to.",
            ]),
        ]),
    }),
    Object.freeze({
        id: "arena-edges",
        title: "Edges of the Arena",
        description: Object.freeze([
            "You might have thought about the arena bounds. What is your bot supposed to do if it tries to run away but gets close to the edge? Do not worry. We have a variable for that. Entity Distance From Edge measures the distance from the center of your bot to the closest arena edge.",
            "You might also have noticed a purple zone that appears after some time. This is the danger zone that closes in on the arena every 20 seconds. The zone starts shrinking for 5 seconds at 15 seconds, then repeats three times before the entire arena is purple.",
            "T: 15s, shrinks for 5s, now 20s.\nT: 35s, shrinks for 5s, now 40s.\nT: 55s, shrinks for 5s, now 60s.",
            "The danger zone deals 3 damage every half a second, or 2% of maximum HP every half a second.",
            "There is also a variable called Entity Distance To Danger Zone Edge. This number can be positive or negative. If it is positive, you are in the safe zone. If it is negative, you are in the danger zone. Either way, the number tells you the distance.",
        ]),
        lessons: Object.freeze([
            lesson("keep-running", "Keep Running", [
                "Here is an opponent bot that only chases you. Experiment with the edge variables and see how you can keep running without stopping at the edges.",
            ]),
        ]),
    }),
    Object.freeze({
        id: "custom-variables",
        title: "Custom Variables",
        description: Object.freeze([
            "What is the purpose of making your own custom variable? It can be used for anything, really. Maybe you want to keep track of something. Maybe you want to execute actions in a certain order every time.",
        ]),
        lessons: Object.freeze([
            lesson("custom-variable-basics", "Make Your First Custom Variable", [
                instructionSteps(
                    "Go to Custom Variables.",
                    "Click + ADD VARIABLE and leave everything as-is. It is a number called Variable 1.",
                    "Create a root, make an IF ALWAYS statement, then add the action Variable: Modify Custom Variable and set its statement to +1.",
                    "Create another root, check if Variable 1 is greater than or equal to 10, then use Dash. You just made your own variable, added 1 to it every tick, and used it in a conditional statement.",
                ),
            ]),
            lesson("some-theories", "Use cases", [
                "You can store long statements in one variable, making it easier to reuse the same statements in multiple conditions.",
                "To do this, you create a root with a conditional node containing the conditions you want to save. Then set the variable to true when those conditions hold and false otherwise.",
                "Custom variables are also a form of memory: they can remember your past actions. The puzzle \"It's Rewind Time\" can be solved by keeping track of a custom variable. Check it out to see how it can be used.",
            ], null),
        ]),
    }),
]);

export const TUTORIAL_LESSONS = Object.freeze(TUTORIAL_CATEGORIES.flatMap((category) => (
    category.lessons.map((currentLesson) => Object.freeze({ ...currentLesson, categoryId: category.id, categoryTitle: category.title }))
)));

export function getTutorialLesson(lessonId) {
    if (!lessonId) return null;
    return TUTORIAL_LESSONS.find((currentLesson) => currentLesson.id === lessonId) ?? null;
}

export function practiceLessonsForTutorial() {
    return TUTORIAL_LESSONS.filter((currentLesson) => currentLesson.scenarioId);
}
