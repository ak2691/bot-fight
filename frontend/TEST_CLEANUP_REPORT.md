# Test cleanup report

Generated during the UI-redesign cleanup. Not committed.

## strategyToolbar.test.js: deleted (52)

- match and building toolbars expose only their supported controls
- the bot's brain card leads with the primary action above Edit code, and Tools has no play control
- the HUD panel opts out of the monospace override and collapses to a phone action bar
- live match code browsing is teammate-first and keeps opponent code sandbox-only
- toolbar buttons share the blueprint surface, show labels, and retain the existing handlers
- practice loadouts save on Enter and use the shared selector and close controls
- arena and puzzle code workspaces share compact controls and pinch zoom
- overlapping graph nodes keep delete controls in the same stacking context
- roots expose editable names and priorities with root-only search
- root priority edits refresh the graph and root search from one configuration
- compact conditions own their comparator and actions summarize inspector targets
- entity selectable controls separate ability, owner, and ordering
- boolean condition inputs use the comparator socket styling
- action target inspectors switch to coordinates and preserve target offsets
- action node picker provides a searchable grouped list without touch autofocus
- inserted nodes use explicit placements without auto-adjusting existing nodes
- lesson guide is a card and pill in the arena and a collapsible checklist dock in the workspace
- add controls and variable addition share the reusable SVG plus design
- variable and action searches share a wheel-contained picker design
- condition graph wiring follows the rendered node bottom
- conditional nodes are fixed-size compact stacks of readable strips
- conditional operand pencils open the variable picker and expose raw input explicitly
- raw number inputs keep their DOM focus when the selected variable changes
- raw number inputs accept digits only and retain the original caret presentation
- variable condition searches render visual category headings
- each condition row has its own remove control
- ALWAYS is offered from the variable operand picker footer
- action and variable pickers use the flat picker surface
- conditional nodes show depth and have no detached-branch UI
- bot ability configuration selects the bot entity before the ability
- search and configuration menus are exclusive and close on Escape
- condition variable chips open detailed configuration in the inspector
- custom variable configuration only defines variables and starting values
- modify custom variables use conditional-style operands and layered inspectors
- code graph has no standalone variable or target connection workflow
- bot editing keeps touch targets usable without changing the rendered model size
- editable bots expose a shared mouse and touch rotation handle
- offline arenas keep camera controls without the bottom interaction banner
- each condition opens its own panel; the conditional node itself has no config menu
- action inspector shares the condition row design and offers Change action
- condition panel puts the comparator between the two sides, then settings
- variable picker groups variables under section headers with chips, recents, and descriptions
- workspace fills the window, the panel is wider, and node labels are capped
- order arrows are big tabs on the selected node's top corners and the root name reads as an input
- zoom keeps the point under the cursor fixed; info hints use the real icon; compare link is connected
- picker cards carry one colour per category with scrolling header bands and shared variables
- workspace toolbar is one calm bar with meters, a floating zoom cluster and an icon close
- toolbar condenses to chips below 900px and to two rows on phones without hiding anything
- custom variables dialog: list with tags and live values, detail pane, phone screens, sans-serif fonts
- search roots is a popover under the toolbar search with summaries, hover trash and phone sheet
- puzzle info is a card, pill and bottom-sheet button that reuse the tutorial guide shell
- solved puzzles modal shows a progress ring, rows that open puzzles and no stale counters

## strategyToolbar.test.js: kept / rewritten (33)

- shared graph-edge geometry preserves its cubic path and offsets both endpoints
- local building initialization creates one dummy while match initialization stays isolated
- live match arena does not append the legacy opponent model to the authoritative roster
- preview and surrender controls exist only in live matches
- puzzle play is a local preview and puzzle submission is a separate action
- puzzle play preserves the editable setup until Reset Stats is chosen
- puzzle play restores drafts by puzzle without overriding loaded submissions
- puzzle builder play resumes its preview and keeps builder code out of storage
- puzzle arenas keep bot selection and dragging enabled while paused
- the visible building deadline preserves the manual submission grace window
- submitted match code closes and disables the coding workspace
- live match code browsing keeps opponent code private and sandbox-only
- conditional ability pickers use all equipped abilities and resource-aware ammo choices
- running previews read bot-code edits without restarting playback
- practice autoplay pauses in hidden tabs and submissions do not log brain payloads
- editable code upgrades legacy coordinates before rendering movement controls
- Pixi hit-testing only selects bots and ignores visual effects
- code graph nodes can be dragged from their surfaces without stealing control clicks
- dragging a node never selects it or opens its panel; a tap opens it
- root conditional controls do not change graph selection
- root priority edits swap places with the root at that priority so layout keeps matching execution order
- conditionals are AND-only across the editor
- removing a conditional promotes its child branches
- removing the final condition keeps the conditional and makes it always
- condition and action DOM identities are scoped to their root
- modulo is exposed only as a custom-variable operation
- custom variable names are sanitised and deleting a variable in use asks first
- raw number inputs accept digits only when asked and keep focus while the selected variable changes
- empty-canvas pointer down commits focused inputs and dismisses configuration
- changing an action keeps its panel open
- Escape closes one search or configuration layer before the code workspace
- zoom keeps the point under the cursor fixed
- code workspace controls keep accessible names, roles and focus handling

## Other files: whole tests deleted

components/BotLogo.test.js deleted 11 kept 2
   - bot logo uses the supplied PNG and renders BF when it fails
   - navbar uses a large clickable bot face while authentication keeps the wordmark
   - authentication showcase uses the compressed looping landing video and first-frame poster
   - profile page uses scoped charcoal surfaces without recoloring the shared navbar
   - profile secondary actions stay neutral until hover
   - profile search results use the charcoal profile-card surface
   - navbar reserves its layout slot and follows scroll direction globally
   - loading surfaces share the spinning bot face instead of generic rings or skeletons
   - private match entry lives in the home ranked block instead of public profiles
   - the ranked block shows the selected mode's ELO and coloured W-L-D with placeholders until stats exist
   - profile records show coloured W, L, and D counts with a proportion bar
pages/home/RankedMatchBlock.test.js deleted 7 kept 6
   - queue errors use only the shared red popup instead of an inline queue card
   - party rules and the guest notice moved over from the queue page unchanged
   - the block switches between ranked, searching, and match-in-progress states
   - the home page composes the logo, ranked block, tiles, and footer around the drifting background
   - guarantee slots keep one optional catalogue-backed slot per round with the renamed dialog eyebrow
   - home stats use placeholders until profile data exists and the profile cache feeds the navbar chip
   - the account navbar has a wordmark, labelled links, Find player, account icons, and a phone tab bar
pages/game/GamePage.test.js deleted 5 kept 8
   - match acceptance is an identity-free dialog with the requested copy
   - the countdown ring starts full and is explicitly oriented for counterclockwise depletion
   - custom match replay offers a lobby return after the result is revealed
   - match finished screen shows the outcome banner, ELO card, rounds and actions
   - focus management, timer semantics, and reduced-motion-safe rendering remain present
gameArena/status/abilityStatusPresentation.test.js deleted 3 kept 12
   - ability status panel tags only the current user as YOU on their team colour
   - fighter cards use a portrait, segmented HP bar, and rounded-square ability tiles without slot or glow presentation
   - responsive fighter cards keep the side layout on tablets and become compact strips on phones
pages/auth/authPages.test.js deleted 7 kept 3
   - the auth card has a Log in | Sign up toggle instead of the old switch boxes
   - the wordmark is centred over the card with Chakra Petch, and Credits sits under it
   - navbar wordmark uses Chakra Petch with a 1px stroke and no shadow on every page
   - the right column has the tagline, the unchanged demo video, and three step chips
   - phones lead with the video: logo, tagline, square video, chips, card, no trees
   - the sticky mobile bar scrolls to the card, offers guest play and hides while the card is visible
   - the reset password page uses the shared logo and card instead of a floating modal
gameArena/pixi/presentationAssets.test.js deleted 8 kept 9
   - entity visuals use a renderer-clock animation instance without the fallback particle burst
   - Orbital Strike keeps its marker beneath pulse animations without a countdown caption
   - Lock On uses the supplied white crosshair and hides the marker when its active timer ends
   - Overclock uses the emerald clock status icon above the bot name
   - small responsive arenas keep a high-enough backing resolution
   - Pixi modules stay out of login until the signed-in asset gate starts
   - asset preload completion keeps the owner state instead of storing the texture catalogue
   - asset decoding, Pixi initialization, and route preloading start concurrently
pages/customLobby/CustomLobbyPage.test.js deleted 1 kept 3
   - custom lobby page exposes invite-only teams and owner start controls
pages/catalogue/abilityCatalogueIcons.test.js deleted 4 kept 4
   - catalogue cards keep text accessible and artwork decorative
   - catalogue uses compact text effect cards with detail modals and round navigation
   - new catalogue artwork uses shape-aware layouts
   - ability info modal is built from highlights, steps, effects, and a collapsed stat list
pages/home/HomePage.test.js deleted 7 kept 5
   - the footer points new players at the tutorial and credits
   - floating trees reuse the workspace node classes for roots, conditionals, and actions
   - the four trees are small real programs
   - a signal pulse runs root to conditional to action with CSS only and respects reduced motion
   - trees stay in the outer margins, faint and non-interactive, and hide where they would overlap content
   - home and authentication share the workspace node background
   - tree floating avoids transformed outline resampling
tutorial/TutorialPresets.test.js deleted 1 kept 20
   - tutorial lesson navigation shows the current title in a separate box below Tools
notifications/notificationPanel.test.js deleted 2 kept 6
   - notification panel caps its height and scrolls through invite cards
   - notification panel shares the party popover surface and shows header, empty state and unread dot
pages/puzzles/PuzzleBuilderPage.test.js deleted 1 kept 3
   - the puzzle list is a compact row table with filters, a progress ring and the charcoal palette
components/errorSurfaces.test.js deleted 3 kept 1
   - loading screen keeps the spinning bot, a determinate-or-indeterminate bar, the countdown and a delayed tip
   - error screens share one panel with an icon tile, Try again, a secondary link and an error ref
   - toasts use alert for errors and warnings, status otherwise, and only auto-dismiss success and info
gameArena/coding/variableOperatorGlyph.test.js deleted 5 kept 2
   - the custom-variable inspector and action node share font symbols for every operation
   - operator dropdown escapes clipped rows and node sizing reserves visible glyph space
   - coding workspace numbers and default zoom retain their previous presentation
   - compact entity action graph measurement and variable-expression layout remain intact
   - compact selectable order badges do not space their letter and ordinal apart
pages/puzzles/puzzleBuilderPanel.test.js deleted 3 kept 1
   - builder panel is one flow: name, description, steps and a single save
   - rules and limits uses steppers and switches and drops the duplicated team counts
   - the rules workspace uses the code workspace toolbar with win and lose rule buttons
pages/profile/profileMatchFormat.test.js deleted 2 kept 6
   - the profile page is split into header, ranked, recent matches, and settings rows
   - profile styles cover phones with a compact header and full-screen dialogs
pages/credits/credits.test.js deleted 2 kept 2
   - credits page shows each creator as a card with an itch.io tag and no invented links
   - credits navbar: full navbar when signed in, wordmark plus Log in when signed out, and a Back link
gameArena/pixi/measurementLabelLayout.test.js deleted 2 kept 0
   - measure shows small text-only readouts in fixed arena corners
   - arena keeps its regular grids and border without a brighter custom center axis
gameArena/components/arenaSetup.test.js deleted 2 kept 2
   - arena setup has team steppers, a start time, a draggable map, bot fields and Apply
   - the stepper is a typeable - value + control that clamps
components/ProfileLink.test.js deleted 1 kept 2
   - party and custom-lobby usernames use the shared profile link
components/PlayerAvatar.test.js deleted 2 kept 1
   - every player avatar surface uses the shared tile
   - navbar uses one hover style, a secondary Sign in button and truncated names
pages/puzzles/puzzleCoordinateContract.test.js deleted 1 kept 1
   - puzzle information popup omits redundant submission instructions
replay/replayPresentation.test.js deleted 1 kept 35
   - the result card stacks full-width team rows with untruncated names and skips a single-round list
