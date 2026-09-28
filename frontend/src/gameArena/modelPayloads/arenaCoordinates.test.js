import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    internalOffsetToPublic,
    internalPointToPublic,
    isPublicBotCenterCoordinate,
    isPublicCoordinate,
    publicOffsetToInternal,
    publicPointToInternal,
} from "./arenaCoordinates.js";

const pixiCanvasSource = readFileSync(fileURLToPath(new URL("../pixi/PixiCanvas.jsx", import.meta.url)), "utf8");

test("public and internal points round-trip at the center and arena corners", () => {
    for (const point of [{ x: 0, y: 0 }, { x: -600, y: -600 }, { x: -600, y: 600 }, { x: 600, y: -600 }, { x: 600, y: 600 }]) {
        assert.deepEqual(internalPointToPublic(publicPointToInternal(point)), point);
    }
    assert.deepEqual(publicPointToInternal({ x: 0, y: 0 }), { x: 600, y: 600 });
    assert.deepEqual(publicPointToInternal({ x: 0, y: 450 }), { x: 600, y: 150 });
    assert.deepEqual(publicPointToInternal({ x: 0, y: -450 }), { x: 600, y: 1050 });
    assert.deepEqual(internalPointToPublic({ x: 0, y: 0 }), { x: -600, y: 600 });
});

test("offset conversion flips Y and preserves distance", () => {
    const publicOffset = { x: 20, y: 30 };
    const internalOffset = publicOffsetToInternal(publicOffset);
    assert.deepEqual(internalOffset, { x: 20, y: -30 });
    assert.deepEqual(internalOffsetToPublic(internalOffset), publicOffset);
    assert.equal(Math.hypot(publicOffset.x, publicOffset.y), Math.hypot(internalOffset.x, internalOffset.y));
});

test("public coordinate helpers bound arena and bot-center inputs", () => {
    assert.equal(isPublicCoordinate(-600), true);
    assert.equal(isPublicCoordinate(600), true);
    assert.equal(isPublicCoordinate(Number.NaN), false);
    assert.equal(isPublicCoordinate(Number.POSITIVE_INFINITY), false);
    assert.equal(isPublicCoordinate(600.1), false);
    assert.equal(isPublicBotCenterCoordinate(-570), true);
    assert.equal(isPublicBotCenterCoordinate(570), true);
    assert.equal(isPublicBotCenterCoordinate(-570.1), false);
});

test("Measure converts cursor coordinates and retains internal straight-line distance", () => {
    assert.match(pixiCanvasSource, /const publicHoverPoint = internalPointToPublic\(hoverPoint\)/);
    assert.match(pixiCanvasSource, /Math\.hypot\(measurementPoints\[1\]\.x - measurementPoints\[0\]\.x, measurementPoints\[1\]\.y - measurementPoints\[0\]\.y\)/);
    assert.doesNotMatch(pixiCanvasSource, /P\$\{index \+ 1\}:|internalPointToPublic\(point\)/);
    assert.match(pixiCanvasSource, /graphics\.moveTo\(ARENA_WIDTH_UNITS \/ 2, 0\)[\s\S]*?alpha: 0\.55, width: 2/);
});
