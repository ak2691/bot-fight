---
name: botfight-ui-design
description: Botfight's UI design conventions (fonts, colours, layout, labels, mobile, interaction) learned from the owner's accepted and rejected designs. Use when designing, mocking up, redesigning, or restyling any Botfight UI — toolbars, modals, panels, graph nodes, forms — or when writing a UI prompt for another agent.
---

# Botfight UI design

Patterns the owner has accepted (and rejected) while redesigning the code
workspace. Follow them by default; propose a departure only with a reason.
Current reference implementations: graph nodes and the conditional side panel
(`frontend/src/gameArena/coding/nodes/GraphNodes.jsx`), the workspace toolbar
(`frontend/src/gameArena/coding/CodingPanel.jsx`), and
`docs/CODE_WORKSPACE_REDESIGN.md`.

## Two surface types

Decide which one you're designing first.

- **Tool surfaces** (code workspace, config panels, modals, editors): calm,
  flat, precise. Everything below applies as written.
- **Game surfaces** (match room, practice room, HUD, lobby, results): should
  feel like a game, not a coding platform. Same clarity rules (one primary
  action, switches for toggles, condense-don't-hide on mobile), plus:
  - Display font Chakra Petch (600–700) for headings, numbers, and buttons;
    IBM Plex Sans stays for small body text. Short uppercase tags are fine
    here (BLUE, ROUND 1/3).
  - Chunky buttons: ~36px (primary ~46px, larger text), 8–10px radius, a
    darker bottom edge (3px) so they look pressable. Primary is saturated
    (green for lock-in/submit, cyan for play).
  - Fighting-game scoreboard: team-coloured blocks with big scores, round and
    timer in the centre.
  - Fighter cards: bot face portrait, bold name, segmented HP bar (green →
    amber → red), ability tiles using the real ability icons
    (`getAbilityCatalogueIcon`) with cooldown fill and a yellow count badge.
  - Game wording where it fits: "Lock in", "Surrender vote", "Your bot's brain".
  - Team colours carry strongly (blue/red backgrounds, borders, tags).
  - Usernames are never truncated on game surfaces (scoreboards, result
    cards, fighter cards). Design for the 20-character maximum, e.g.
    `Guest-B5E4CBCA9F21D0`: give the name its own full-width row, or shrink it
    (not below ~12px), and let it wrap as a last resort. No ellipsis.
  - Don't repeat the outcome. With a single round, a per-round list
    ("R1 Won, forfeit") restates the Victory/Defeat card; show round rows
    only for multi-round series.
  - Disliked: "text · text" dot-joined labels (BLUE · YOU, "Ranked 1v1 ·
    opponent forfeited"). Prefer a separate chip (e.g. a "You" pill) or a
    comma. A full replacement pattern is still to be decided.

## Typography (tool surfaces)

- IBM Plex Sans for all UI text, in sentence case.
- Monospace only for numbers, counts, values, and `<kbd>` shortcut hints.
- No all-caps, letter-spaced labels. No tiny (<11px) text.
- Check that wrapper classes (e.g. `testing-mono`) are not overriding the font.

## Colour and surfaces (tool surfaces)

- Dark palette: surfaces ~`#111519` / `#12161a`, hairline borders ~`#262c33`,
  text ~`#e6edf3`, muted text ~`#8b98a5`, cyan accent ~`#3aa6c9` / `#5fd4f0`.
- Graph nodes are square-cornered (~2px radius). Roots are dark grey with a
  ROOT label, name field, order badge and "+ Conditional"; conditionals have a
  small IF / ELSE IF / ELSE tab above the node and blue condition strips with no
  per-row IF/AND labels; every action node is green with a small yellow channel
  label (MOVE / ABILITY / ROTATE / VARIABLE). Diagrams of nodes anywhere
  (tutorial, docs) reuse these exact designs.
- Type tags are colour-coded (e.g. Number cyan, True/false purple).
- Flat: no glow, gradients, or heavy shadows.

## Buttons and controls

- One filled primary button per view (e.g. "Add root"); everything else is a
  quiet secondary or borderless ghost button.
- ~30px desktop controls, ~5px radius; ≥34px touch targets on phones.
- Search is styled as an input with a `<kbd>` hint, not a boxed button.
- Two-option choices use a segmented toggle, not a dropdown.
- Player avatars are always a rounded square (radius ≈ 23% of size: 56→13px,
  36→9px, 30→8px, 24→6px) with the initial in Chakra Petch. Never circles.
  (The bot face logo stays round; it's the brand, not an avatar.)
- Decorative background trees (home, auth) use the real node designs at
  ~35–40% opacity, kept to outer margins/corners outside content safe zones,
  with a slow signal pulse that lights the action it reaches (static under
  prefers-reduced-motion; hidden on phones). Nothing decorative behind text.
- BOT/FIGHT wordmark: Chakra Petch 700, BOT #57b8ff over FIGHT #ff7166, dark
  2px text stroke and drop shadow, tight leading. Same treatment everywhere
  (home, auth, navbar, tutorial). On pages, the large wordmark is centered over
  the page's main interactive block (home: Ranked match card; auth: the card),
  never left-aligned with a side tagline.
- One hover style for nav links, chips and ghost buttons: rgba(255,255,255,.06)
  fill + white text, same radius as the element. No legacy glow/underline hovers.
- Config-panel controls share one height (~32px). A value that can be a
  number or a variable uses a "Num | Var" mini toggle (booleans "T/F | Var"),
  never a pencil icon or a "Compare to a variable" link.
- Picker lists: each category is its own card with a border and a solid
  header band in that category's colour (distinct hue per category, never all
  grey), small uppercase label, count on the right. Headers are NOT sticky
  (rejected: looks odd while scrolling). Every picker has a × close.
- Arbitrary numbers stay number inputs (never a long dropdown of options).
- Destructive actions are a quiet red text button at the bottom of the pane,
  with confirmation when the thing is in use. Never a loud box at the top.

## Labels and copy

- Say each thing once. Remove duplicate titles, repeated mode labels, and
  headings that restate the obvious (e.g. "Settings for X").

- When inputs have no visible label, give each an `aria-label` and a matching
  `title` tooltip. If an option reads awkwardly in the sentence, reword the
  option rather than adding a label.
- Short names; groups and context supply the rest ("HP", "Distance",
  "Angle To", not "Entity HP" / "Distance Between Entities"). Change labels,
  never ids.
- Abbreviate entities where space is tight: Me, Opp 1, Ally 2.
- Help text goes behind an ⓘ, not in permanent paragraphs.
- Show units after values. Replace cryptic codes ("1/100 A") with labelled
  counts, ideally with small progress meters that turn amber/red near limits.

## Layout

- Canvas nodes: uniform fixed width, one line per row, content truncates with
  an ellipsis and a full-text tooltip. Grid rows so comparators line up.
- Side panels: never truncate. Keep comparisons on one line
  (`[left] [op] [right]`); size grid columns by content; long names wrap
  inside their own box, both sides stretch to equal height.
- Rejected: stacking the two sides of a comparison vertically in the panel.
- Collapse items not being edited into one-line summaries.
- Toolbars: identity (who/what you're editing) left, budget next, tools right.
  Secondary controls like zoom live in a canvas corner cluster.
- Lists with detail: list left with name, type tag, and live value per row;
  detail right, top-to-bottom in the order a user decides things.

## Interaction

- Tap/click selects; opening config is deliberate (second tap, double-click,
  or an Edit button). Dragging never opens anything.
- Bottom sheets on phones appear only on explicit action.

## Mobile

- Condense, don't hide. Information present on desktop stays reachable.
- Wide bars become two rows; counts become chips that open a detail sheet;
  secondary buttons go icon-only with aria-labels.
- List + detail becomes two screens with a back arrow.

## Logic-editor rules that affect UI

- Conditionals are AND-only; OR is a sibling ELSE IF with the same actions.
- Comparator sits between the two operands; comparators may show as words.

## Workflow

1. Diagnose what is wrong with the current screen in a few bullets.
2. Mock up 2–3 directions (inline widget), recommend one, include a phone view.
3. After approval, write a concise implementation prompt for Sonnet 5.5:
   file paths, bullet requirements, "update affected tests", "Don't commit".
   Do not pad prompts with instructions to read the whole repo.
4. When the owner accepts or rejects a pattern, update this file.
