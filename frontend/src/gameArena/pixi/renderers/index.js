import { BOT_ABILITY_PRESENTATIONS } from "../botAbilityPresentationDefinitions.js";
import cleave from "./cleave.js";
import counterHit from "./counterHit.js";
import dash from "./dash.js";
import disruptorDart from "./disruptorDart.js";
import execute from "./execute.js";
import frostRing from "./frostRing.js";
import gun from "./gun.js";
import lunge from "./lunge.js";
import meleeSlash from "./meleeSlash.js";
import overcharge from "./overcharge.js";
import overdrive from "./overdrive.js";
import parry from "./parry.js";
import phaseStrike from "./phaseStrike.js";
import repulsorBurst from "./repulsorBurst.js";
import shotgunBlast from "./shotgunBlast.js";
import smash from "./smash.js";
import sprintTrail from "./sprintTrail.js";
import stun from "./stun.js";
import temporalRewindZone from "./temporalRewindZone.js";
import tetherChain from "./tetherChain.js";
import thrust from "./thrust.js";
import vampiricBeam from "./vampiricBeam.js";

/**
 * Bot ability renderers, keyed by the verb's visual `type` in shared/gameplay/abilities.json.
 * A renderer is `{ create, update, destroy }` plus an optional `sync`:
 *   create(init)            -> per-bot state, built lazily on first use (`init`: view, shape, now, presentation, abilityId)
 *   sync(ctx)               -> on each snapshot, for transitions that need the previous shape (dash start, burst)
 *   update(ctx)             -> every frame; `ctx.pass` is "body" (under the status icons) or "world" (over them)
 *   destroy(view, state, kit) -> when the bot view is removed
 * Renderers draw from state and contract numbers only. Adding a visual is one file here,
 * one entry in botAbilityPresentationDefinitions.js, and the type name in the JSON.
 */
export const BOT_ABILITY_RENDERERS = Object.freeze({
    cleave,
    counterHit,
    dash,
    disruptorDart,
    execute,
    frostRing,
    gun,
    lunge,
    meleeSlash,
    overcharge,
    overdrive,
    parry,
    phaseStrike,
    repulsorBurst,
    shotgunBlast,
    smash,
    sprintTrail,
    stun,
    tetherChain,
    temporalRewindZone,
    thrust,
    vampiricBeam,
});

const ENTRIES = Object.freeze(BOT_ABILITY_PRESENTATIONS
    .filter((presentation) => BOT_ABILITY_RENDERERS[presentation.type])
    .map((presentation) => Object.freeze({ presentation, renderer: BOT_ABILITY_RENDERERS[presentation.type] })));

function rendererState(view, { presentation, renderer }, shape, now) {
    if (!view.abilityRenderers) view.abilityRenderers = new Map();
    let state = view.abilityRenderers.get(presentation.type);
    if (!state) {
        state = renderer.create({ view, shape, now, presentation, abilityId: presentation.abilityId }) ?? {};
        view.abilityRenderers.set(presentation.type, state);
    }
    return state;
}

function run(view, ctx, method, shape, now) {
    for (const entry of ENTRIES) {
        if (typeof entry.renderer[method] !== "function") continue;
        ctx.presentation = entry.presentation;
        ctx.abilityId = entry.presentation.abilityId;
        ctx.state = rendererState(view, entry, shape, now);
        ctx.active = entry.presentation.abilityId != null && ctx.activeAbilityId === entry.presentation.abilityId;
        entry.renderer[method](ctx);
    }
}

/** Per-frame draw of every bot ability renderer for one bot view. `ctx` is reused; see BOT_ABILITY_RENDERERS. */
export function updateBotAbilityRenderers(view, ctx) {
    ctx.view = view;
    run(view, ctx, "update", ctx.shape, ctx.now);
}

/** Per-snapshot hook, called once per bot view as its shape changes. */
export function syncBotAbilityRenderers(view, ctx) {
    ctx.view = view;
    run(view, ctx, "sync", ctx.shape, ctx.now);
}

export function destroyBotAbilityRenderers(view, kit) {
    if (!view.abilityRenderers) return;
    for (const entry of ENTRIES) {
        const state = view.abilityRenderers.get(entry.presentation.type);
        if (state) entry.renderer.destroy?.(view, state, kit);
    }
    view.abilityRenderers.clear();
}
