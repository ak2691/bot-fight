# Maintaining context files

Context files are a progressive directory-routing system. Their job is to tell
an agent where to search next, not to inventory the repository or replace code
search, source documentation, or tests.

## Default rule

Adding, renaming, or deleting an ordinary source file usually requires no
context change. If the existing owning directory still describes the file, let
targeted search and imports reveal it.

Update a context map only when at least one of these is true:

- a directory gains or loses a distinct responsibility;
- ownership moves between major areas;
- a new subsystem or cross-runtime boundary appears;
- the normal entry point, test command, or contract location changes;
- agents repeatedly search the wrong area because current routing is ambiguous.

## Routing levels

### Root `context.md`

Route prompt categories to high-level area contexts and owning directories.
Avoid leaf source files, symbols, exhaustive path lists, and implementation
details. A root row should remain useful after files inside the area are moved.

### Area `context.md`

Describe directory responsibilities, boundaries, and how concerns flow between
nearby subsystems. Prefer a directory such as `src/beta/pixi/` over listing all
of its files.

An area context may name a small number of stable files when they are genuine
entry points or contract owners—for example an application bootstrap, central
orchestrator, public schema, manifest, or test command. These are landmarks,
not a complete file list.

### Deeper context

Add another context layer only when a directory has several independently owned
subsystems and the parent can no longer route clearly without becoming a file
catalog. The parent should then link to the new context and remove displaced
detail.

Do not create a context file merely because a directory exists.

## Change workflow

1. Identify the closest existing context that owns the changed area.
2. Ask whether directory ownership or routing changed. If not, make no context
   edit.
3. If it changed, update the smallest owning context with a directory-oriented
   description.
4. Update the root map only for a new top-level task category or area boundary.
5. If a context is growing through repeated leaf entries, replace them with a
   directory route or introduce one justified child context.
6. Verify links, keep every context below 200 lines, and remove stale routes.

## Examples

### New file inside an existing subsystem

Adding `frontend/src/gameArena/pixi/particleEffects.js` does not require a context
entry. The existing Pixi directory route already tells agents where to search.

### New directory with an existing responsibility

Splitting Pixi texture helpers into `frontend/src/gameArena/pixi/textures/` may need
one short update to the arena context's Pixi directory description. It does not
need a root route or a list of files in `textures/`.

### New independently owned subsystem

If `frontend/src/gameArena/pixi/` grows into several substantial rendering systems
with different debugging paths, create `frontend/src/gameArena/pixi/context.md`.
Change the arena context to route rendering work there and move Pixi-specific
detail out of the parent.

### Stable contract owner

Naming a central payload schema or application entry point is acceptable when
it materially shortens discovery. Do not append every consumer, helper, or test
that imports it.

## Content to avoid

- one route per source file, component, DTO, entity, or test;
- symbol inventories that can be produced by `rg`;
- volatile implementation details and numeric gameplay tuning;
- duplicated specifications already owned by code or focused docs;
- speculative routes for folders that do not exist yet;
- changelog-style notes that do not help choose an owning directory.

Keep routes semantic, directory-first, and stable under normal refactoring.
