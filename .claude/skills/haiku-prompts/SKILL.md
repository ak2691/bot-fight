---
name: haiku-prompts
description: How to write implementation prompts for Haiku (or other cheaper agents) in Botfight. Short prompts that carry decisions, not directions. Use whenever the owner asks for a prompt for Haiku, or for any engine/backend implementation handoff.
---

# Prompting Haiku

The owner runs implementation prompts on Haiku to save tokens, so writing the prompt must
be cheap too. Most of the cost of a detailed prompt is the research behind it, not the
writing. **Spend tokens only on things Haiku can't work out by itself.**

## What goes in

1. **Goal, in one or two lines,** including whether gameplay may change.
2. **A pointer to the design doc** (for example "rows S2, S3 and S7 of
   docs/ROSTER_DESIGN.md"). The doc holds the detail once; don't restate it.
3. **The decisions:** the design calls Haiku must not improvise. Examples: new field names
   and shapes, stacking rules, which edge cases must survive, intended behavior changes.
   This is the valuable part.
4. **Traps:** non-obvious hazards found while designing (an import cycle, a value that
   isn't a whole tick, a field the renderer reads). One line each.
5. **Expected golden and test outcome:**
   - which golden changes are intended;
   - anything else means "stop and report, don't regenerate".
6. **Checks to run:**
   - `cd frontend; npm test; npm run lint`;
   - `cd sim-worker; npm test`;
   - `cd server; .\mvnw.cmd test` when Java or schemas change.
7. **Docs to update,** then `Don't commit.`

## What stays out

- **Call sites, file inventories and "grep for X"-style lists.** Haiku finds where things
  are used. Name the main file and function only when it's ambiguous.
- **Current values** Haiku can read from the data.
- **Code bodies.** Give a signature or a data shape only when the shape is the decision.
- **Re-explaining the architecture,** and boilerplate like "read AGENTS.md" or "read the
  whole repo".
- **Pre-verifying facts** at write time. Check something only if a wrong guess would be
  expensive (behavior changes, cycles, determinism).

## Shape

- Parts A, B, C in order, with tests between them. Allow "stop after B and report" when
  a part is risky.
- Bullets, not prose. Target **15–40 lines** per prompt. If it grows past about 60
  lines, split it into two prompts.
- One prompt per commit-sized step. Prompts that touch the same files run one after
  another, never in parallel.

## After a prompt runs

The owner may bring the result back for review. Review the diff and the golden changes
against the prompt's stated expectations, and fix small slips directly. That review is
where a stronger model's tokens pay off.

## Example (the lean version of an audit step)

```text
Task: every status becomes a preset; code checks what a status does, not its name. Only intended gameplay change: slow also blocks sprint.
Spec: rows S1, S2, S3, S7, S10 of the engine audit doc.
Decisions:
- New status effect `block { actions: [ability|dash|move|sprint|fastTurn] }`. silence = block[ability]; slow = movement modifier + block[dash, sprint]; movement-lock = block[move, sprint]; stun stays its own effect.
- channels.json drops blockedByStatuses; adds notReadyWhileBlocked (dash true, ability false).
- Interrupt becomes the stun preset flag `interrupts: true` (interrupts immediately on apply, as today). Round interrupt durations UP to whole ticks (150→200, 250→300); this must not change goldens.
- Self statuses (reactive-armor, absolute-guard, overclock) are presets applied by the normal `status` effect; owner applyEffects passes target = owner.
- Helpers in StatusContracts: hasActiveEffect(shape, type), isBlocked(shape, action), blockedActions(shape).
Traps: catalogue labels (BotLoadout positiveEffectDetailsForEffects) must render identically; leave HitStagger.js for the next prompt.
Goldens: only slow+sprint scenarios may change; explain them before golden:update. Anything else: stop and report.
Checks: frontend test + lint, sim-worker test, server test. Update ABILITIES.md sections 4–6. Don't commit.
```
