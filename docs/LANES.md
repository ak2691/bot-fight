# Lanes programming model

Decided 2026-10-12, reworked 2026-10-13 into **sections**; this replaces the behavior-tree editor and chains for
players. Goal: **low skill floor, high skill ceiling**. Earlier versions (six per-category lanes, follow-ups
across lanes) are in git history of this file.

## The model in one picture

```
BRAIN
├─ Movement        Move and Face cards: the top Move card and the top Face card both run, every tick
├─ Actions         ability, dash and cancel cards: ONE action at a time; combos live here
├─ Variables       variable cards: every card that applies runs
└─ Custom variables  numbers and true/false values (unchanged)

There are no modes (removed 2026-10-13: the owner found them more confusing than useful). Longer plans use
conditions and variables; short sequences use combos.
```

The rules a player learns, in their words:

1. **My bot always moves and aims.** Movement runs every tick.
2. **My bot does one action at a time.** In Actions, the top card that can act wins.
3. **A combo is a string of actions.** While it runs, nothing else in Actions can interrupt it.

This follows how game AI is usually layered (locomotion underneath, one action on top) instead of the old
"one action per category, all at once", which let a dash three rows down fire in the middle of a combo.

## Cards

- A card is **[action] when [0–6 conditions, all must hold]**. No conditions means always.
- Conditions and actions are today's condition and action objects: every reading, target and setting works.
- "Or" is two cards with the same action. A card can be turned off (`enabled: false`): dimmed, never runs.
- A card **can act** when its conditions hold and its action is executable now with a resolving target (the old
  root-action check). A Fireball on cooldown falls through to the next card.

## Sections

| Section | Holds | Each tick |
|---|---|---|
| Movement | move and rotation actions | the first Move card that can act runs, and the first Face card that can act runs |
| Actions | ability, dash and cancel actions | see below; at most one action starts per tick |
| Variables | variable actions | every card that applies runs, top to bottom (old rule for writes) |

**Actions, each tick:**

1. **An action is running** (an ability winding up or active, or a dash in progress): no new action starts, except
   **Cancel** cards, which may act while an ability winds up (that is their job). Cancelling ends the action.
2. **Otherwise**, if a combo is waiting for its next step (its last step just ended), that step's follow-ups are
   tried top to bottom and the first that can act starts. If none can, the combo ends and step 3 runs this tick.
3. **Otherwise** the Actions cards, top to bottom: the first that can act starts. If it has follow-ups, a combo
   starts.

**Attached movement:** an ability card (top-level or follow-up) may carry an optional Move and/or Face action. While
that ability winds up or is active, they replace the Movement section's choice for that kind; afterwards Movement
decides again. ("Fireball ＋ Back away" kites while casting.) Dash and cancel cards can't carry them.

**No hidden defaults.** A new brain starts from a visible **starter**: Movement "Walk to enemy" and "Face enemy";
Actions one card per equipped ability "when the enemy is within its range". Players see, edit and delete them.

## Combos (follow-ups)

- Any **ability or dash** card in Actions can have follow-ups, shown indented under it. Follow-ups are action
  cards (ability, dash or cancel); a cancel follow-up can't have its own follow-ups. Depth ≤ 3.
- A follow-up never runs on its own. It is tried only on the tick its parent's action ends (for any reason,
  including a cancel), as step 2 above. Siblings: top to bottom, the first that can act wins.
- **One combo at a time** follows from "one action at a time": nothing else in Actions can start while a step runs.
- The combo ends when no follow-up can act, at a segment boundary, or if its cards are deleted or turned off. A
  running action keeps its attached movement until the action ends.
- No "in combo" condition. Moving differently once an opening appears is a plain condition ("within range → walk
  straight in"); moving differently during an attack is attached movement.

Editing rules: deleting a top-level card deletes its follow-ups; deleting a follow-up moves its own follow-ups up
into its place; changing a card's action to one that can't have follow-ups (cancel) deletes them.

## Aim

Ability cards aiming at an entity offer **Current**, **Lead N s** and **Auto** (lead from the remaining wind-up plus
projectile travel). Auto is the default for new cards with projectile abilities. Fixed X/Y aim offsets are not
offered in the editor (old brains keep them).

Projectiles fire along facing, so a shot is led by a **Face** action: Face enemy offers the same Current, Lead and
Auto. Auto names a projectile ability from the loadout (`leadAbilityId`). A Face attached to a projectile ability card
("Fireball ＋ Face enemy") starts on Auto with that ability; the starter's Face stays Current.

## Format (`bot-logic-lanes-v1`, not yet shipped, changed in place)

```
{ version: "bot-logic-lanes-v1",
  movement: [Card], actions: [ActionCard], variables: [Card],
  customVariables, loadout }
Card       = { id, conditions: [Condition], action: Action, enabled?: false }
ActionCard = Card & { followUps?: [ActionCard], move?: Action, face?: Action }
```

- A card's action must belong to its section. `followUps` only on ability/dash cards; `move`/`face` only on ability
  cards (a move action and a rotation action respectively). Empty lists omitted; no nulls.
- Bounds: 100 cards in total (follow-ups included); 300 conditions; 6 per card.
- The tree format (`bot-logic-tree-v2`) keeps running for puzzles' rules, goldens and old saves; not editable.

## Editor

Reference: [`docs/mockups/lanes-editor.html`](mockups/lanes-editor.html). Where code and mockup differ, the mockup
wins. Three sections (Movement, Actions, Variables), each a coloured label with numbered card rows; tiles coloured
by action kind; combos indented in Actions; attached movement as small tiles after the ability with a "＋"; inline
condition and action editors; condition and card menus; an ⓘ details panel for ability stats.

## Alternatives considered

| Idea | Why not |
|---|---|
| Six per-category lanes | Combos had to cross lanes, which needed priority and clash rules nobody could predict |
| One list, every category in parallel | A random dash lower down could fire mid-combo; no commitment |
| Combos as an "After: card" condition | Works, but scatters a combo across the brain; owner prefers the indented combo |
| Parallel combos with interleaved timing | Needs waits and tick planning |
| "In combo" condition for movement | Attached movement says the same thing where the combo is written |
| Chains (sequences with waits and loops) | Too much to learn; makes bots scripted |
| Modes with switches (state machines) | Built, then removed: more confusing than useful; combos and conditions cover it |
| Built-in defaults | Hidden rules; the visible starter does the job |

## Later (not in this build)

- Delete the tree runtime once puzzles and golden scenarios are rewritten as lanes brains.
- Rewrite the tutorial for sections and combos.
- Watch real play: do players commit (combos) or write reactive brains? See `SOLVED_MATCHUPS.md`.
