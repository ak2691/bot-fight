import { botAbilityActiveMs } from "../botAbilityPresentationDefinitions.js";
import { lockOnTargetPoint, LOCK_ON_PRESENTATION } from "../pixiVisualState.js";
import { BOT_SIZE } from "../../modelPayloads/arenaConstants.js";
import { abilityStats } from "./rendererHelpers.js";

function distanceSquared(left, right) {
    const dx = Number(left?.x ?? 0) - Number(right?.x ?? 0);
    const dy = Number(left?.y ?? 0) - Number(right?.y ?? 0);
    return dx * dx + dy * dy;
}

/** Lock-On: a crosshair over the bot nearest the locked point, kept in a scene layer above the bots. */
export default Object.freeze({
    create: () => ({ marker: null }),
    update(ctx) {
        if (ctx.pass !== "world") return;
        const { kit, view, shape, state, arenaSprites, layers, abilityId, presentation } = ctx;
        if (state.marker) state.marker.container.visible = false;
        const activeMs = botAbilityActiveMs(shape, presentation);
        if (Number(shape.hp ?? 1) <= 0 || activeMs <= 0) return;
        const targetPoint = lockOnTargetPoint(shape);
        if (!targetPoint) return;

        const targetView = ctx.otherBots
            .filter((candidate) => candidate.view !== view && Number(candidate.view.shape.hp ?? 1) > 0)
            .sort((left, right) => distanceSquared(left.position, targetPoint) - distanceSquared(right.position, targetPoint))[0];
        const targetPosition = targetView?.position ?? targetPoint;
        if (!state.marker) state.marker = kit.createMarker(layers.lockOn, arenaSprites.abilities.lockOnCrosshair, LOCK_ON_PRESENTATION.markerSize);
        const { marker } = state;
        marker.container.position.set(targetPosition.x, targetPosition.y);
        const targetDiameter = Math.max(1, Number(targetView?.view.shape.size ?? BOT_SIZE) || BOT_SIZE);
        const activeDurationMs = Number(abilityStats(abilityId).activeMs ?? 300);
        const activeScale = 1 + Math.max(0, Math.min(1, activeMs / activeDurationMs)) * 0.08;
        const containedScale = Math.min(1, (targetDiameter * 0.72) / LOCK_ON_PRESENTATION.markerSize);
        marker.container.scale.set(containedScale * activeScale);
        marker.container.visible = true;
    },
    destroy(view, state, kit) {
        if (state.marker) kit.destroyMarker(state.marker);
        state.marker = null;
    },
});
