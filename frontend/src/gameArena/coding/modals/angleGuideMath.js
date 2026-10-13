// Geometry and wording for the movement angle guide. Pure so the preview rules can be tested.
// The preview arena is 300 x 300 with y growing downward; 0° points up (north) and angles turn clockwise.

export const ARENA_SIZE = 300;
export const WALL_MARGIN = 14;
export const CONTACT_DISTANCE = 28;
export const PREVIEW_SPEED = 55;
export const PREVIEW_LIMIT_MS = 6000;
export const MAX_FRAME_SECONDS = 0.05;
export const HOME_POSITIONS = Object.freeze({ bot: Object.freeze({ x: 80, y: 190 }), target: Object.freeze({ x: 215, y: 120 }) });

export const ANGLE_PRESETS = Object.freeze({
    relative: Object.freeze([0, 45, 90, 135, 180, -90]),
    absolute: Object.freeze([0, 90, 180, 270, -45]),
});

export const ANGLE_FOOTNOTES = Object.freeze({
    relative: "0° points at the target or point. Positive turns right, negative turns left: -90° is the same as 270°.",
    absolute: "0° is up (north). Angles turn clockwise. Used by Move to angle, Rotate to angle and angle conditions. -90° is the same as 270°.",
});

const COMPASS_NAMES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

const toRadians = (degrees) => degrees * Math.PI / 180;

/** The angle as -180..180 degrees. */
export function normalizeAngle(degrees) {
    const wrapped = ((degrees % 360) + 360) % 360;
    return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Whole degrees clamped to the -360..360 range the actions accept. */
export function clampAngle(value) {
    const numeric = Number(value);
    return Math.max(-360, Math.min(360, Math.round(Number.isFinite(numeric) ? numeric : 0)));
}

/** Compass heading from `from` to `to` in degrees (0 = up, clockwise). */
export function bearingBetween(from, to) {
    return Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI;
}

/** The offset of `length` units along a compass heading. */
export function headingVector(heading, length) {
    return { x: Math.sin(toRadians(heading)) * length, y: -Math.cos(toRadians(heading)) * length };
}

/** The heading the bot steers on: relative to the target's bearing, or fixed in the arena. */
export function steeringHeading(mode, direction, bot, target) {
    return mode === "relative" ? bearingBetween(bot, target) + direction : direction;
}

export function angleCaption(mode, direction) {
    const normalized = normalizeAngle(direction);
    const size = Math.abs(normalized);
    if (mode === "absolute") {
        const name = COMPASS_NAMES[Math.round((((direction % 360) + 360) % 360) / 45) % 8];
        return { title: `Always ${name}`, detail: "Same arena direction wherever the target is." };
    }
    if (size < 1) return { title: "Straight at the target", detail: "Chases it wherever it goes." };
    if (size < 89) return { title: "Angles in toward the target", detail: "Curves in, ending on top of it." };
    if (size <= 91) return { title: "Circles the target", detail: `Keeps the same distance, strafing to the ${normalized > 0 ? "right" : "left"}.` };
    if (size < 179) return { title: "Angles away from the target", detail: "Spirals out, keeping it in view." };
    return { title: "Straight away from the target", detail: "Retreats along the line to it." };
}

/** One preview frame: the bot steers by its direction. `done` is set at a wall, on contact or after the time limit. */
export function advancePreview({ bot, target, mode, direction, seconds, elapsedMs }) {
    const step = headingVector(steeringHeading(mode, direction, bot, target), PREVIEW_SPEED * Math.min(MAX_FRAME_SECONDS, seconds));
    const next = { x: bot.x + step.x, y: bot.y + step.y };
    const atWall = next.x < WALL_MARGIN || next.x > ARENA_SIZE - WALL_MARGIN || next.y < WALL_MARGIN || next.y > ARENA_SIZE - WALL_MARGIN;
    const touching = mode === "relative" && Math.hypot(next.x - target.x, next.y - target.y) < CONTACT_DISTANCE;
    return { bot: next, done: atWall || touching || elapsedMs > PREVIEW_LIMIT_MS };
}

/** The whole preview path at once, for people who prefer reduced motion. */
export function previewPath({ bot, target, mode, direction }) {
    const path = [{ ...bot }];
    let position = bot;
    const frame = 1 / 20;
    for (let elapsedMs = 0; elapsedMs <= PREVIEW_LIMIT_MS + 50; elapsedMs += frame * 1000) {
        const result = advancePreview({ bot: position, target, mode, direction, seconds: frame, elapsedMs });
        position = result.bot;
        path.push({ ...position });
        if (result.done) break;
    }
    return path;
}

/** Keeps a dragged marker inside the arena walls. */
export function clampToArena(point) {
    return {
        x: Math.max(WALL_MARGIN, Math.min(ARENA_SIZE - WALL_MARGIN, point.x)),
        y: Math.max(WALL_MARGIN, Math.min(ARENA_SIZE - WALL_MARGIN, point.y)),
    };
}
