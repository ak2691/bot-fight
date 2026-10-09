import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { botMovementRotation } from "../pixiVisualState.js";
import { abilityVisual } from "./rendererHelpers.js";

/** Dash: a smoke trail left at the point the dash began. The trail is cosmetic and runs on the presentation clock. */
export default Object.freeze({
    create: () => ({ origin: null, rotation: 0, startedAt: null }),
    sync(ctx) {
        const { state, shape, previousShape, presentation } = ctx;
        if (ctx.suppressTransient) return;
        if (botAbilityActiveMs(shape, presentation) <= 0 || botAbilityActiveMs(previousShape, presentation) > 0) return;
        state.origin = { ...ctx.current };
        // The supplied smoke frames face north before rotation.
        state.rotation = botMovementRotation(shape) + Math.PI / 2;
        state.startedAt = ctx.now;
    },
    update(ctx) {
        if (ctx.pass !== "body" || ctx.dead) return;
        const { kit, view, state, position, radius, now, arenaSprites, presentation, abilityId } = ctx;
        const frames = arenaSprites.abilities.dashSmoke;
        if (!frames?.length || state.startedAt == null) return;
        const elapsedMs = now - state.startedAt;
        if (elapsedMs >= presentation.smokeMs) {
            state.origin = null;
            state.startedAt = null;
            return;
        }
        const origin = state.origin ?? position;
        const visualSize = Number(abilityVisual(abilityId).visualSize ?? radius * 3.8);
        kit.showEffect(view, "dash-smoke", kit.frameAt(frames, elapsedMs, presentation.smokeFrameMs, false), {
            x: origin.x - position.x,
            y: origin.y - position.y,
            rotation: state.rotation,
            alpha: 0.92,
            width: visualSize,
            height: visualSize * 0.5,
            anchorX: 0.5,
            blendMode: "screen",
        });
    },
    destroy() {},
});
