# Code Workspace

How the bot code workspace works (main brain only). Superseded designs and finished prompts were removed; git history has them. Design conventions live in the `botfight-ui-design` skill.

This is the editor side of the port from `8d46135`, without chains, shared (linked) actions, unconnected nodes, stamina / sprint / fast turn, or lead aim. Those need brain-format or engine work that main does not have.

## 1. Brain format and execution order

- **Tree:** `roots -> branches (conditionals) -> children / actions`. One movement, rotation, ability and cancel action per tick; variable writes all apply.
- **Order is left to right** (modelled on Unreal's behavior tree editor). Roots are ordered among roots; conditionals that share a parent form an IF / ELSE IF / ELSE chain where the first match wins. ELSE always counts as last. The stored `priority` fields are what the runtime uses; the editor writes them from horizontal positions, and badges update live while dragging. Older brains whose layout disagrees with their stored order keep their order and get an amber ring on the group's badges; dragging applies left-to-right order, Tidy fixes the layout.
- **Actions inside a branch are not ordered:** a matched branch runs all its actions, one per category.
- **Every node has one parent.** A root or conditional takes one wire; an action sits in one conditional. Wiring a connected conditional moves it. An action that already has a parent is not wired from a new output: lift its input bar to move it instead.
- **Conditions are AND-only.** OR is a sibling ELSE IF with the same action.
- **Comparing two pair values** (distance, bearing): each side has its own entities and target (`rightSelectable1`, `rightSelectable2`, `rightTargetMode`, `rightTargetX/Y`, `rightTargetAngle`).
- **Saved brains** keep main's fields. The editor adds nothing to them beyond the layout in `nodePositions`.

## 2. Main brain canvas: nodes, pins and wires

- **Nodes are plain rectangles in a thin frame.** Pins are wide bars flush on the frame edges: input along the top, output along the bottom (about 16 px, hit area at least 24 px, at least 34 px on touch). Root: output only. Conditional: both. Action: input only.
- **Wires** start exactly on the parent frame's bottom edge and end exactly on the child frame's top edge (bar centres), from measured frame geometry at every zoom (`coding/graphEdgeGeometry.js`).
- **Connecting:**
  - Click an output bar to arm it (a preview wire follows the cursor), then click a valid input bar. Nothing connects on hover or pass-over.
  - Or press an output bar and move more than about 4 px: the held wire connects when released over any part of a valid node and drops when released elsewhere.
  - Lift an input bar and move it to a valid output to re-parent the node. Released on empty canvas, it stays where it was.
  - Click empty canvas or press Escape to cancel.
- **Touch:** no wire follows the finger. Tap an output bar to arm it, then tap the target's input bar. A still tap on empty canvas disarms.
- **Rules:** roots and conditionals take one wire; an action sits in one conditional. No cycles. A conditional and an action category cannot repeat under one conditional. A refused target turns red with the reason as its tooltip ("That would create a loop", "This conditional already has a Move action", "Already connected to a node. Lift its input bar to move it."), and clicking it shows the reason as a toast. A conditional wired under a parent is inserted by X position (ELSE last).
- **Selecting vs opening:** pressing a node and moving it more than 4 px is a drag and never selects or opens. An action: one tap selects it and opens its panel. A conditional: the first click selects it; once selected, clicking a condition strip opens that condition. Ctrl/Cmd-click adds to the selection without opening.
- **Order controls:** the side panel header shows "IF, 1 of 3" with the order arrows for keyboard and precise moves.
- **Action node (both editors):** up to three rows: (1) the yellow category label (ABILITY, MOVE, TURN...) with the × on the right, (2) the action name on a darker green, (3) a description of its settings on the darkest green, only for actions that have settings.
- **Ability not equipped:** an action whose ability isn't in the loadout renders as a muted "Ability not equipped" node that can still be wired or deleted.
- **Phones:** a tap only selects. While something is selected the bottom bar becomes contextual: Edit, Up, Down, Delete, Done. Done clears the selection and restores the normal bar.

## 3. Conditional node (main brain)

- Light blue body (`#286583`, border `#43a6d1`) with one darker blue strip per condition (`#0d2f50`, border `rgba(125,211,252,.56)`), inside its pin frame.
- Header row: the yellow (`#facc15`) IF / ELSE IF / ELSE label, "all must be true" (two or more conditions), then the action count and order badge on the right.
- Strips: × on each, a white outline when selected, truncated with a full-text tooltip.
- A small dashed "+ Condition" button under the last strip adds a strip and opens it (hidden on read-only canvases).

## 4. Side panels (both editors)

On phones the panel is a bottom sheet.

- **Flat rows, no indentation:** label left (muted), control right.
- **Controls are only as wide as their content**, right-aligned, truncating at about 200 px with a tooltip. Numbers are a fixed 5-digit box (about 72 px, monospace) with the unit outside. Segmented controls show only the options that exist.
- **Condition:** header (yellow kind label, "Condition 2 of 3", ×); **Value** and its rows (Entity, To, X / Y, Ability, Status...); a hairline, **Compare**, a hairline; **With** (Num | Var); **Value** again and, for a variable, its own rows; footer with Up / Down and a quiet red remove.
- **Action:** header (yellow category label, title, ×); **Action**; **Target** (Entity | Point | Angle, only supported modes) and its rows; then the action's own rows (Direction, Continue, For / Until...); footer as above.
- Help text sits behind an ⓘ; units follow values.

## 5. Toolbar, dialogs and helpers

- **Toolbar** (`CodingPanel.jsx`, `code-tb-*`): bot switcher, budget meters (amber from 85%, red at the limit), Search roots (`S` by default), Variables, Add root (the one filled button, with its shortcut), Clear all (quiet red, one confirmation listing counts, one undo restores everything) and Close.
- **Canvas rail and zoom:** undo, redo, Zoom to fit (minimum zoom 25%) and Tidy (sorts every sibling list by execution order and re-runs the layout; recorded in undo). Zoom (−, %, +, fit) floats at the canvas's bottom-right.
- **Variables dialog** (`CustomVariablesModal.jsx`, `code-cv-*`): header "Variables", a slot meter and ×. The list shows each variable's name, a type tag (Number, True/false) and its live value; "+ New variable" is the one filled button. The detail is compact rows, label left and control right: Name; Type; Starts at; a hairline; Live value; then "Used in N places" with one row per use. Clicking a use closes the dialog and selects that node. Uses are found by `coding/variableUsage.js`, which walks the roots. Deleting a variable (after a confirmation when it is used) and changing its type rewrite the same places.
- **Movement direction guide** (`AngleGuideDialog.jsx`, `angleGuideMath.js`): one dialog with a Relative | Absolute toggle. The Direction ⓘ on a relative move opens it on Relative; the Angle ⓘ opens it on Absolute.
- **Search roots popover** (`SearchRootNodesModal.jsx`, `code-rs-*`): anchored under the toolbar button, own search input, rows with order badge, name and counts, footer hints and a quiet red "Delete all roots" while the query is empty. Phones: a full-width sheet.
- **Mobile input zoom:** picker search boxes only autofocus with a fine pointer, and workspace inputs use 16 px text on touch screens.

## 6. Toolbar overflow and phones

Three stages, decided by the workspace element's width, not the device.

- **Full (above 1100 px):** the whole toolbar.
- **Mid (640-1100 px):** icon-only secondaries and a **⋯ More** menu holding Tidy layout, Zoom to fit and Clear all last in quiet red below a divider.
- **Phone (under 640 px):** the budget chips open a counts sheet, Search is an icon, and a bottom action bar (about 52 px) holds Undo, Redo, **Add** (the only filled primary, opening a sheet with Add root), Vars and More. The More sheet has Tidy layout, Zoom to fit and Clear all.
- **Canvas:** no left rail on phones; a small floating cluster at the canvas's bottom-right keeps Zoom to fit, − and +.

## 7. Not on main (dropped from the 8d design)

- **Unconnected nodes** (`orphans`), the "+ Node" button, double-click on empty canvas to add a node, and disconnecting a wire to leave its node unconnected. Main's brain has no place to save an unconnected node; a node can only be added under a parent.
- **Root actions** (an action wired straight to a root). Use a conditional whose condition is Always instead.
- **Shared actions** (one action under several parents, `linkId`) and the "Used by" list. Main keeps one parent per node.
- **Chains** (Run chain, the chain editor, step meter, NewChainDialog).
- **Stamina, Sprint, Fast turn, lead aim, and the Move Direction "Toward a target" measure** with their readings (Approach Angle, Is Moving, In View, Stamina).

## 8. Backlog

1. Pickers restyled with categories, descriptions and type badges; the action picker hides actions whose category the branch already uses.
2. Category chips on roots and a note on actions a higher root already claims.
3. An outline view of the same tree, the default on phones.
4. Debug: highlight the path each root took on the last tick in practice mode.
