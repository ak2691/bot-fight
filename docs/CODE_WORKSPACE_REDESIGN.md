# Code Workspace Redesign

Status: in progress. The brain format (`roots -> branches -> actions`, priorities, IF/ELSE-IF/ELSE, one movement/rotation/ability per tick) is unchanged except that conditions are now AND-only (section 7). This is mostly an editor redesign. Puzzle outcome conditions are untouched.

An earlier "lanes" restructure was prototyped and backed out: it changed the model the tutorial teaches and dropped the tree visual.

## 1. Execution order (done)

Modelled on Unreal Engine's behavior tree editor: nodes can be placed anywhere, and siblings run **left to right**.

- **What is ordered:** roots among roots (who claims a channel first), and conditionals that share a parent (the if / else-if chain). Actions are not ordered; a branch runs all of its actions, one per channel.
- **Dragging** a root or conditional reorders its sibling group by horizontal position when you drop it. Badges show the new order live while dragging. Vertical position does not matter.
- **ELSE stays last** in its group wherever it is dragged, because it always matches.
- **Arrows** (◀ ▶) are large tabs sticking out of the top-left and top-right corners of a selected root or conditional. They swap it with its neighbour, and both subtrees move with their nodes. The order number stays in the node body, and the IF / ELSE IF tab is centred on top of conditionals.
- **Labels**: the first conditional in a group reads IF, later ones ELSE IF, and the fallback ELSE.
- **No typed priority boxes** on nodes. The `priority` fields are still stored and are what the runtime uses; the editor writes them from positions. The root search list can still set a root's priority, and it swaps positions to match.
- **Older brains** whose layout disagrees with their stored order are not changed on load. The badges of those groups get an amber ring. Dragging one of those nodes applies left-to-right order to its group; Tidy fixes the layout instead.

Code: `frontend/src/gameArena/coding/siblingOrder.js` (+ `siblingOrder.test.js`), wired in `LogicBoard.jsx`, badges and labels in `GraphNodes.jsx` (`ExecutionOrderControls`, `conditionalKindLabel`).

## 2. Layout helpers (done)

In the left rail of the canvas:

- **Zoom to fit** frames the whole tree (minimum zoom lowered to 25%).
- **Tidy** sorts every sibling list by execution order and re-runs the default layout. Behavior does not change: an ELSE that is not last becomes an IF with no conditions, which also always matches. It is recorded in undo.

## 3. Mobile zoom fix (done)

Search boxes in the pickers only autofocus with a mouse (`pointer: fine`), and inputs in the workspace use 16px text on touch screens. Mobile browsers zoom the page when a smaller input is focused.

## 4. Direction A visuals (done)

Chosen from three mocked-up directions ("Unreal stack").

- **Conditional nodes** are read-only: one blue strip per condition (the sentence; once the node is selected, click a strip to open that condition's panel, with a x to remove it), and an IF / ELSE IF tab centred on top. Removing the last condition leaves the conditional as "Always". A body row has the title, action/branch count, the order number and a x to remove the node. While the node is selected, a green **+** tab at the far right of its bottom edge opens a menu with Add conditional and Add action, and a small **+** tab hanging from the bottom edge of the lowest condition (right of centre) adds a condition immediately.
- **Action nodes** are green, fixed-width text cards: a MOVE / TURN / ABILITY / VARIABLE label, the action name and boxed chips for its target (for example `90° from Opponent 1`), with no icons. There is no Edit button: tap to select, tap again (or double-click) to open the panel. The action panel uses the same row design as a condition: a Change action button, then the settings fields. Movement, zone and target actions pick their target with the same **To: Entity | Point | Angle** toggle used by conditions.
- **Roots** are a compact pill with the name, order badge, + Conditional and x.
- **Side panel** (a bottom sheet on phones): see section 8. The action panel has CHANGE ACTION.
- Text uses IBM Plex Sans; small labels and numbers stay Cousine.
- Code: `CompactConditionNode`, `GraphRootNode`, `GraphActionNode` and the `conditional` kind of `LogicNodeInspector` in `GraphNodes.jsx`; sentences from `nodes/conditionSummary.js`. The puzzle outcome editor's standalone condition node keeps the old inline editing.

## 5. Selecting versus opening (done)

Pressing a node and moving it more than 4px is a drag: it never selects the node or opens a panel (`LogicBoard.jsx` sets `dragClickSuppressedRef` when the drag ends and the click handlers swallow the click that follows).

- **Action node**: one tap selects it and opens its panel. There is no Edit button.
- **Conditional node**: it has no panel of its own. The first click anywhere on the node only selects it (so you can change priorities or use the + buttons without a menu in the way); once it is selected, clicking a condition strip opens that condition's panel.
- **Panels** hold only input boxes (no surrounding container) and have no remove buttons; remove things with the x on the strip or node.
- Choosing "Change action" from an action panel keeps that panel open. Tapping a different node selects it and closes any open panel. Ctrl/Cmd-click still adds to the selection and never opens a panel.

## 6. Next steps

1. **Pickers** (variable/action lists) restyled with categories, descriptions and type badges; the action picker should hide actions whose channel the branch already uses.
2. **Channel chips on roots** (move / turn / ability / variable) and a note on actions that a higher root already claims.
3. **Outline view** of the same tree, the default on phones.
4. **Debug**: highlight the path each root took on the last tick in practice mode.
5. Optional: named conditions (reusable condition groups) if the tree still repeats checks.

## 7. AND-only conditions (done)

A conditional's conditions are all ANDed: every condition must be true. `join: "or"` no longer exists in bot conditions.

- **Express OR** as a sibling ELSE IF (or another IF) with the same actions.
- **UI**: the AND / OR toggle and the "Add condition (OR)" menu item are gone; the panel shows a static AND between conditions, the add button reads "+ And another condition", and a note says "All conditions must be true."
- **Frontend contract and evaluator**: `CONDITION_JOINS` and the OR grouping in `runtime/conditionEvaluator.js` are removed, as is the enumerated-angle-variant path in `BotCode.js` (only the all-AND angle grouping remains). `normalizeConditions` drops any `join` field, so old saved brains with OR load as AND. Convert those by hand into sibling branches.
- **Server**: `BotSubmissionValidationService` rejects any `join` other than `"and"` (`... .join is not supported; all conditions must be true (AND)`). `BotLogicContracts.JOIN_OR`, `ConditionEvaluationService.evaluateJoined`, the `Condition.join` component and the angle-variant enumeration in `ConditionResolutionService` are removed, so the simulator can only AND.
- **Presets**: `TutorialPresets.js` lessons 10 and 11 used OR and now use two sibling branches with the same action.
- **Not changed**: puzzle outcome (win / lose) conditions are a separate system (`puzzles/puzzleConditions.js`, `PuzzleService`) and still support OR. `PuzzleLogicWorkspace.jsx` keeps their `join` when normalizing.

## 8. Conditional panel redesign (done)

The conditional panel (`LogicNodeInspector`, `ConditionalInspectorRow` in `GraphNodes.jsx`) reads top to bottom as a sentence.

- **Header title** is the rule's sentence (for example "Distance (My Bot -> Opponent 1) < 50 and ..."), from `nodes/conditionSummary.js`.
- **Rows** that are not being edited collapse to a one-line summary; one row is expanded at a time (the first when the panel opens, and a newly added one).
- **Expanded order**: variable, then comparison (comparator and value), then smaller settings fields (entity, target, ability, status effect).
- **Comparators are words** ("is less than", "is at most", "equals", "is at least", ...; "is" / "is not" for true/false) and units follow the value.
- **Variable buttons** show "Change v" so they look clickable.
- **To: Entity / Point** is a two-option toggle instead of the Target mode dropdown (Angle appears only for variables that support an absolute angle).
- **Help text** sits behind an info button; numbered badges are gone; labels use sentence case.
- The comparison row wraps so the panel still works as a phone bottom sheet.

## 9. Layout at scale

Canvas stays 10,000 × 6,000. Large sibling groups are the author's to arrange (as in Unreal), helped by Zoom to fit, Tidy and later collapse. Auto-stacking wide groups vertically was considered and deferred.

## 10. Separate targets when comparing two pair variables (done)

Distance and bearing variables carry an entity plus a target (entity, point, or angle). When one is compared to another, each side now has its own configuration, so choosing Point for one no longer changes the other.

- **Fields**: the compared-to side stores `rightSelectable1`, `rightSelectable2`, `rightTargetMode`, `rightTargetX`, `rightTargetY` and `rightTargetAngle` next to the left side's `selectable1`, `selectable2`, `targetMode`, ... Only present when the right variable is a pair variable.
- **Older brains** without those fields fall back to the left configuration, so their behavior is unchanged; the editor writes the right fields the next time the condition is normalized.
- **Frontend**: `rightOperandView` in `runtime/conditionEvaluator.js` gives the resolver the right side's configuration; `BotCode.js` normalizes it; the condition panel edits it through `rightPairUpdates`.
- **Server**: `ConditionResolutionService` builds a `rightView` condition and resolves the right variable from it; `BotSubmissionValidationService` validates the right* fields (same rules as the left side, and rejects them when the right side is not a pair variable).

## 11. Toolbar: one calm bar (done)

The workspace toolbar in `CodingPanel.jsx` (`code-tb-*` styles) is one row: bot switcher (arrows, team dot, name, "Blue team · Sandbox · 1 of 2"), a divider, Roots / Actions / Conditions meters (3px bars, amber from 85%, red at the limit), a spacer, a Search roots button with a `/` hint, Variables, the only filled button (Add root, with its shortcut key), and a plain close icon. The old title block and mode box are gone (a visually hidden heading keeps `aria-labelledby`).

- **Zoom** (−, %, +, fit) is a floating cluster at the bottom-right of the canvas; fit calls the board's own `zoomToFit` through `zoomToFitRef`.
- **Match testing:** a teammate gets a Sandbox | Real toggle next to the name; otherwise the mode is meta text (Sandbox, Real code, Read-only snapshot, Opponent code is private). The snapshot and error banners sit under the bar.
- **Responsive:** under 900px the meters collapse to one `2/300 C` summary with a tooltip and Variables is icon-only; on phones Search and Add root are icon-only.
- The puzzle workspace keeps its own older toolbar.

## 12. Custom variables dialog (done)

`CustomVariablesModal.jsx` (`code-cv-*` styles) was redesigned; data handling (`rewriteVariableActions`, limits, name validation) is unchanged.

- **Header:** braces icon, "Custom variables", muted `n / max` count and a close icon. The header Add button is gone.
- **List (230px):** search, rows with the name, a Number (cyan) or True/false (purple) tag and the live value in mono, a left accent bar on the selected row, and a "New variable" row at the bottom (empty state: "No variables yet" plus one line of explanation).
- **Detail:** a larger Name input, a Number | True / false toggle, "Starts at" (number input or a False | True toggle), a live-value line with "Used in N nodes", and a quiet red "Delete variable" that confirms first when the variable is used.
- **Phones (under 640px):** the list and the detail are separate screens; tapping a row opens the detail with a back arrow, and New variable is a full-width primary button.
- **Fonts:** `.testing-mono` forces Cousine on everything in the workspace, so the toolbar, zoom cluster and this dialog opt back into IBM Plex Sans with more specific selectors (monospace only for numbers and `kbd`).

## 13. Search roots popover (done)

`SearchRootNodesModal.jsx` (`code-rs-*` styles in `SearchRootNodes.css`) is a popover anchored under the toolbar search button (at least 330px wide) instead of a boxed panel. It has its own search input with a `/` hint, and no header or close button; Escape and clicking outside close it (the toolbar search button just reopens it). Quick search uses the same layout.

- **Rows:** an order badge (the existing `RootNodePriorityInput`, styled as a badge until focused), the root name, and a muted "3 conditionals · 2 actions" (or "Empty") line. The hovered or keyboard-active row gets a left accent bar and a trash icon.
- **Footer:** ↑↓ move and ↵ jump hints, "3 of 12", and a quiet red "Delete all roots" only while the query is empty (same confirmation as before). The root count lives in the toolbar meter.
- **Phones (under 640px):** a full-width sheet from the top with a Cancel button, 44px rows, and a ⋯ menu per row with Delete.
