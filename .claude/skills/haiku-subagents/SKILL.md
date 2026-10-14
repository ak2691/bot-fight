---
name: haiku-subagents
description: How to run Haiku implementation subagents in Botfight - when to design first, how to hand over UI mockups, how to run, review and correct their work. Use whenever the owner asks to implement something "with Haiku subagents", or to delegate a multi-step build.
---

# Running Haiku subagents

The owner wants Haiku to do the implementing and me (the stronger model) to make decisions, design, and review.
Prompt wording and length follow the `haiku-prompts` skill; this skill covers everything around the prompt.

## Spawning

- `Agent` with `model: "haiku"`, `effort: "medium"`, `subagent_type` omitted (general-purpose).
- One prompt per commit-sized step. Steps that touch the same files run **one after another** in the foreground
  (`run_in_background: false`); only truly independent steps run in parallel.
- If a run stops early or leaves a "not done" list, **resume the same agent** with `SendMessage` (it keeps its
  context) and answer its open questions in that message. Don't start a fresh agent for leftovers.

## Design before delegating

My job is the decisions, not the code. Before the first prompt:

1. Write the decisions down in the design doc (`docs/...`): data shapes, rules, limits, edge cases, alternatives
   rejected. Prompts then point at the doc instead of restating it.
2. **UI work: design it myself first** whenever the owner asks for UI or the step has a visible surface.
   - Mock it up in chat (inline widget), iterate with the owner until they approve. Use the `botfight-ui-design`
     skill, unless the owner asks for something different.
   - **Save the approved mockup as a standalone HTML file** (`docs/mockups/<feature>.html`) with short notes per
     section stating the rules (sizes, states, what opens what). Haiku can't see chat widgets; it reads this file.
   - The prompt says: "Match docs/mockups/<feature>.html. Where the code and the mockup differ, the mockup wins."
   - Never describe a UI to Haiku only in words. That produced a working but clunky editor that reused old panels
     (lanes editor, 2026-10-12).

## Prompt content that Haiku gets wrong without being told

- Which old components NOT to reuse (old side panels and pickers drag the old look in).
- "No new dependencies" when that's the rule (the frontend has no icon or React testing library).
- Interaction flows that must work end to end (add, edit, remove), with a unit test on the pure state logic.
- Chat-widget artifacts are not design: host-styled inputs in a widget looked like a design flaw once. Say what the
  real element should look like (e.g. "search input has no background or border of its own").

## Reviewing each run

- Read the report, then spot-check the core file(s) and the risky parts myself (runtime selection, anything
  touching determinism, persistence, validation). Don't re-read everything.
- **Unrequested engine or gameplay changes**: review the diff and report them to the owner plainly, even when
  they look right (a puzzle variable fix landed this way on 2026-10-12).
- **Look at UI changes myself** before the next step. The practice room needs the backend; if it isn't running,
  mount the component on a temporary page (`frontend/<name>-preview.html` + `frontend/src/__preview/`), check
  desktop and 375 px, then delete it. Don't let app code import it.
- Fix only major mistakes, usually by resuming the agent with a short list. Don't loop chasing perfection.
- At the end: full checks (frontend test, lint, build; sim-worker test; server test when Java or schemas changed),
  delete temporary files, save a memory of what was built and what's open, and summarise for the owner with the
  decisions they should review.

## Mistakes I made before (don't repeat)

- Wrote UI requirements as prose instead of mockups. Fix: mockups first, saved as HTML.
- Accepted "controls reuse existing panels" without looking. Fix: visual check before moving on.
- Let a step finish without confirming a basic interaction (editing an existing condition was broken). Fix: name
  the flows in the prompt and click through them myself.
- Asked Haiku to "port" UI from another branch; it re-derived the code and drifted 300-400 lines per file (old
  designs back, invented auto-attach and auto-placement, broken dropdowns), and I patched symptoms for several
  rounds. Fix: for ports, say "copy files verbatim with `git show <commit>:<path>`, then only these listed edits",
  and require `git diff <commit> -- <file>` counts plus a list of the remaining differences in the report.
- Accepted synthetic-event clicks as proof. Fix: test in the real page with real clicks where possible, and compare
  node positions by top-left, not centre (heights change with labels).
