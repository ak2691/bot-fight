# Tutorial draft (chains and the new building system)

Status: draft for the owner to edit, written 2026-10-10. Lesson text only; no practice scenarios yet. Numbers come
from `docs/ABILITIES.md`, `docs/TIMED_ROUNDS_MATCH_FORMAT.md` and the catalog; double-check them before shipping,
since tuning moves them around. Lines marked **(owner)** are things I wasn't sure about.

---

## Introduction

Welcome to Bot Fight Online. You don't control your bot here. You program it, send it in, and watch it fight. Every
dash, every swing, every questionable decision comes from what you built.

The mechanics are simple. Bots walk around. Bots turn. Bots use abilities, and abilities have cooldowns. Bots also
have stamina, which pays for the fancy movement stuff like dashing and sprinting.

The hard part is that your bot only does what you tell it to. It doesn't know it should dodge unless you told it to
dodge. It doesn't know the edge of the arena is right behind it unless you told it to check. Think of it like
writing the enemy AI for an RPG, except the enemy is yours and it's fighting someone else's.

Don't worry, you won't be typing code. Everything is built out of blocks you snap together.

There are two ways to build:

- **The brain**: a tree of nodes that your bot reads every tick to decide what to do *right now*.
- **Chains**: short step-by-step routines, for when you want the bot to do things *in order*, like a combo.

Let's start with the brain.

---

## Part 1: The brain

### How your bot thinks

The game runs in ticks. One tick is 100 milliseconds, so there are 10 ticks every second. Every single tick, your
bot reads its whole brain from the start and picks what to do.

Every tick, a bot can do at most:

- one **movement** (walk, sprint, dash is its own thing, more on that later),
- one **rotation** (turn to face something),
- one **ability**,
- and any number of **variable changes**.

So your bot can walk, turn and swing all on the same tick. It just can't swing two things at once.

### The three kinds of nodes

**Root.** The start of a tree. It's where the bot begins reading. You can have lots of roots, and they're ordered
left to right: the leftmost root is priority 1 and gets first dibs. Drag a root left or right to change its
priority.

**Conditional.** This is the "if". It holds one or more conditions, like *HP < 100* or *Distance > 300*. Every
condition on the node has to be true for it to pass. That's an AND.

Want an OR? Make a sibling ELSE IF with the same actions. Siblings are checked left to right: IF first, then each
ELSE IF only if everything before it was false, then ELSE if nothing matched. As soon as one passes, the rest of that
row is skipped. If you've written if / else if / else before, it's exactly that.

**Action.** The thing the bot actually does: Walk, Face target, use an ability, change a variable. Actions hang under
a conditional (or straight under a root, more on that below) and run when the path to them is true.

### Who wins when two roots want the same thing?

Higher priority wins. If root 1 says walk toward the opponent and root 3 says walk away, the bot walks toward the
opponent, because root 1 claimed movement first.

But root 3 isn't useless. If root 1 only claimed movement, root 3 can still fill rotation or ability. Lower roots
are great for fallbacks and for filling whatever the higher ones didn't use.

A few more rules worth knowing:

- An action wired straight to a root runs every tick, alongside whatever branch matches. If a matched branch has an
  action in the same category, the branch wins.
- Inside one branch, actions aren't ordered. A matched branch runs all of them, one per category. You can't put two
  movement actions on one branch.
- A deeper match beats a shallower one. If a child conditional matches and has a Walk, that beats its parent's Walk.
- Nodes that aren't connected to a root are **orphans**. They're saved, they count toward your budget, but they never
  run. The game will warn you if you try to submit with orphans.

### Variables you can check

Game variables are everything about the current state of the fight: positions, distance, angles, HP, stamina,
cooldowns, whether someone is winding up an attack, and plenty more. You can read them for any bot, yours or the
opponent's. You can't read the opponent's code though. That part you have to figure out by watching.

Some variables need extra info. HP needs to know *whose* HP. A cooldown needs to know whose ability, and which one.
Distance needs two things to measure between.

You don't have to do any math yourself. No distance formula, no trigonometry. If it would need real math, there's
already a variable for it.

### Lesson: First steps

Wake your bot up. It needs to move.

1. Click **Edit code**.
2. Add a root. Press **R** or click **Add root**.
3. Add a conditional with **+ Node**, then connect them: click the root's output bar (bottom edge), then the
   conditional's input bar (top edge). New conditionals start as **Always**, which is always true.
4. Add a **Walk** action (under Movement) with **+ Node**, and connect the conditional's output bar to it.
5. Hit **Play**.

Your bot walks. Incredible. Truly the pinnacle of robotics.

### Wiring rules

You'll run into these, so here they are up front:

- Each node has one input, so it can only have one parent. Wiring an already-connected node just moves it.
- No loops. A node can't end up under itself.
- A conditional can only have one action of each kind. Try to add a second Walk and the node turns red and tells
  you why.
- To move a node somewhere else, click its input bar. The wire lifts off and follows your cursor.
- To disconnect a node, select its wire and press **Delete**. The node becomes an orphan (still there, not running).
- You can also press and drag from an output bar and drop it on a node, if you prefer dragging.

### Lesson: Retreat

Your bot gets hit sometimes. That's fine. It's a sturdy bot. One hit, two hits, okay maybe not ten.

1. Add a root and a conditional, and connect them.
2. Click the **Always** strip and change it to **HP**. Set the entity to **My Bot**.
3. Set it to **HP < 100**.
4. Add a **Walk** action and connect it.
5. Click the Walk to see its settings. Relative directions: 0° is toward the target, 90° is to its right, 180° is away,
   270° to its left.
6. Make your bot walk away from Opponent 1 when its HP drops below 100.

Now put this root to the **left** of your first steps root. Why? Because both want movement, and the left one wins.
If it's on the right, your bot keeps walking forward forever, no matter how low its HP gets.

---

## Part 2: Moving around (stamina)

Your bot has a stamina bar, about 100 of it. Stamina pays for the movement tricks:

| Thing | What it does | Cost |
|---|---|---|
| **Dash** | A quick burst: 150 units over two ticks | About 30 stamina per dash |
| **Sprint** | A setting on Walk. About 50% faster, in any direction | Drains while you sprint |
| **Fast turn** | A setting on Face target. Turns twice as fast | Drains only while actually turning |
| **Cancel wind-up** | Cancels your own wind-up (a feint) | About 25 stamina |

Stamina starts refilling half a second after you last spent some. Landing a hit with a weapon or ability also gives
you a little back, so bots that hit things get to keep moving, and bots that miss run dry.

At 0 stamina nothing bad happens, you just can't do any of the fancy stuff until it refills. Which, in a fight, is
plenty bad.

Dash is special. It's its own action, and it never blocks your abilities. You can dash and swing on the same tick,
and you can dash in the middle of a wind-up. Stun, slow and movement lock still stop it.

### Lesson: Dash

Dash is your base ability. Every bot has it. Look through all the settings: you can dash relative to a target
(toward, away, sideways) or in a fixed arena direction.

Play with it. No, seriously, get comfortable with dashing. You'll be dodging with it for the rest of your life.

### Lesson: Sprint and fast turn

Turn on **Sprint** in a Walk action and watch the stamina bar drain. Turn it off and watch it refill.

Now turn on **Fast turn** in a Face target action. Notice it only costs stamina while the bot is actually turning.
Already facing the target? Free.

The question you'll keep asking yourself: is this worth the stamina, or do I need it for a dash in two seconds?

### Lesson: Feints

Some abilities have a wind-up, a short delay before they actually hit. A lot of bots dodge the moment they see a
wind-up start. So... what if you start one and then cancel it?

**Cancel wind-up** does exactly that, for some stamina. Start a swing, cancel it, watch them dash away for nothing,
then swing for real while their stamina is low.

The counter to this is fun too: only dodge if they still have enough stamina to feint.

---

## Part 3: Chains

### Why chains exist

The brain is re-read from the top every tick. That's great for reacting, but it has no memory. It can't remember
"I'm on step 3 of my combo". If your combo depends on "I just landed a hit", that stops being true a tick later and
the rest of your combo never happens.

That's what chains are for. A chain is a list of steps that runs **in order** and remembers where it is between
ticks.

- **Roots** react. Everything is checked every tick.
- **Chains** follow a plan. Step 1, then step 2, then step 3.

### How a chain runs

- You build a chain once, give it a name, and start it from the brain with a **Run chain** action. Like a function.
- **Only one chain runs at a time.** If a chain is already running, Run chain does nothing. The running chain never
  gets replaced halfway through.
- Once it's running, the chain goes **first**. Whatever the current step does beats every root in that category.
  Whatever the chain *doesn't* use this tick, your roots fill in. So your bot can follow a combo while your roots
  keep it facing the opponent.
- **A chain only starts if its first action can actually happen.** If a higher-priority root already claimed that
  category this tick, or the ability isn't ready, the chain just doesn't start, as if the Run chain wasn't there.
- **If a Use ability or Dash step can't happen when the chain reaches it, the whole chain ends.** It doesn't wait
  around. (Want it to wait? Put a Wait step in front of it. More below.)
- A chain also ends when it reaches the bottom, hits an **End** step, or the bot gets stunned, dies, or the round
  ends.

### The steps

| Step | What it does | When the chain moves on |
|---|---|---|
| **Use ability** | Starts the ability | By default when the ability is done (finished, cancelled or silenced). Or set it to **Right away** |
| **Walk / Rotate** | Same settings as in the brain, including sprint | After some seconds, or **until** a condition is true (with a max time) |
| **Wait** | Nothing | After some seconds, or **until** a condition is true (with a max time) |
| **If / Else if** | Checks once, runs the first match | After its body. No match? Just keeps going |
| **Modify custom variable** | Changes a custom variable | Instantly |
| **Cancel wind-up** | Cancels your own wind-up | Next tick |
| **Repeat N times / Repeat while** | Runs its body over and over | After the last pass |
| **Run chain** | Calls another chain | When that chain finishes |
| **Exit loop / End** | Leaves the nearest Repeat / returns from this chain | Immediately |

Everything is in whole ticks. "Wait 0.3 s" is exactly three ticks.

### Building a chain

Chains look different from the brain. No wires: the steps stack like blocks, top to bottom.

1. Click **+ Chain** in the toolbar and give it a name. The canvas switches to your chain, and the toolbar shows
   **← Brain › your chain**. Click **← Brain** to go back.
2. Your chain starts with a **CHAIN** header block. Press **F** or click **Add step** to add a step. It goes under
   whatever you have selected, or at the bottom if nothing is selected.
3. **If** and **Repeat** are C-shaped blocks with a mouth. Select the header and add a step to put it inside the
   mouth. Select the foot ("end if") and add a step to put it *after* the whole block.
4. Drag blocks around to reorder them. A cyan line shows where it'll land. A red line means you can't put it there,
   and it tells you why (like an Else if that isn't under an If).
5. Drop a block away from the stack and it becomes a **loose block**. It's saved, it's dimmed, it never runs.
6. Back in the brain, add a **Run chain** action anywhere you'd put a normal action, and pick your chain.

### Lesson: Your first combo

Here's the idea: if Slash connects, follow it up with something heavy before they can get away.

1. Make a chain called **Punish**.
2. Add **Use ability: Slash**.
3. Add **Use ability: [your heavy hitter]**.
4. In the brain, add a root with a conditional for **Distance < [Slash reach]**, and give it a **Run chain: Punish**.

Try it. Then try this: what happens if your heavy hitter is on cooldown when the chain gets there? (The chain ends.
Check the rule above.)

Fix it with **Wait until [ability] Ready, max 1 s** in front of it. If it's already ready, the Wait does nothing and
the ability goes out the same tick. If it isn't ready in time, the Wait gives up and the chain ends anyway.

### Lesson: Only continue if it hit

**Time Since Hit** is a value on every ability: how many seconds since that ability last hit an enemy. It works in
both the brain and chains.

Change Punish so it only follows up if Slash actually connected:

1. After the Slash step, add an **If** with **Time Since Hit (Slash) < 0.3**.
2. Move the heavy hitter inside the If.

Now your bot only commits when it's worth committing.

### Lesson: A feint, as a chain

Remember feints? They're way easier as a chain:

1. **Use ability: [something with a wind-up]**, set to **Right away**.
2. **Wait 0.3 s**.
3. **Cancel wind-up**.
4. **Use ability: [same thing]**.

Watch what the opponent does at step 3. If it dashes away every time, you just found a weakness.

### Chain rules and limits

- A chain can call another chain (**Run chain** inside a chain), up to 3 levels deep. No calling yourself in a loop.
- **End** returns from the current chain to whoever called it. **Exit loop** only leaves the nearest Repeat.
- Repeat can loop 1 to 20 times. Waits and "while" loops max out at 10 seconds. You can nest loops 2 deep.
- Going back to the top of a loop always waits for the next tick, so a Repeat can't freeze the game.
- Limits: 16 chains per brain and 32 steps per chain (nested steps count).
- Chains use your custom variables. There are no chain-only variables yet.

---

## Part 4: Custom variables

Custom variables are your bot's memory. Open **Variables** in the toolbar and press **+ New variable**. There are two
kinds:

- **Number**: you can add to it, subtract from it, set it.
- **True/false**: yes or no.

The Variables window shows each variable's live value while the fight runs, and **Used in** lists every place it's
used. Click one to jump straight there.

Some ways to use them:

- **Shortcuts.** Got a long list of conditions you keep repeating? Check them once in a root and set a true/false
  variable. Then check the variable everywhere else.
- **Memory.** Count how many times the opponent dashed. Remember which way you dodged last time.
- **Talking to chains.** Set a variable in the brain, read it in a chain, or the other way around.

### Lesson: Your first variable

1. Open **Variables** and press **+ New variable**. Leave it as Variable 1, a number.
2. Make a root with an **Always** conditional and a **Modify custom variable** action (under Variables) that does **+1**.
3. Make another root: if **Variable 1 ≥ 10**, **Dash**.

You just made a timer, kind of. It counts ticks, so 10 means one second.

---

## Ending

That's the tutorial. There's a lot more to figure out: what every ability does, which ones work well together, and
how to read what your opponent built.

The **practice room** is the best place to experiment. Change your loadout, set up positions, HP and stamina, and run
it as many times as you want. Click an ability icon in the stats panel to read what it does.

**(owner)** Match walkthrough goes here once the format is final: picking a kit, the build clock, watching segments,
KO or HP decision.
