// Plain geometry for placing new nodes on the canvas. Rectangles are absolute canvas positions: { x, y, width, height }.

export const ROOT_GAP = 120;

// Two rectangles overlap when they share area; touching edges do not count.
export function rectsOverlap(first, second) {
    return first.x < second.x + second.width && second.x < first.x + first.width
        && first.y < second.y + second.height && second.y < first.y + first.height;
}

// The first x, starting at rect.x and moving right by `step`, where `rect` overlaps none of `others`.
export function freeSlotX(rect, others, step) {
    let x = rect.x;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const candidate = { ...rect, x };
        if (!others.some((other) => rectsOverlap(candidate, other))) return x;
        x += step;
    }
    return x;
}

// A new root goes to the right of the rightmost existing root, on the first root's top; the canvas origin when none.
export function newRootSlot(rootRects) {
    if (!rootRects.length) return { x: 0, y: 0 };
    const right = Math.max(...rootRects.map((rect) => rect.x + rect.width));
    return { x: right + ROOT_GAP, y: rootRects[0].y };
}
