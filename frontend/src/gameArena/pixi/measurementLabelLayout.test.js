import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
const PIXI_CANVAS_PATH = fileURLToPath(new URL("./PixiCanvas.jsx", import.meta.url));

test("measure shows small text-only readouts in fixed arena corners", () => {
    const source = readFileSync(PIXI_CANVAS_PATH, "utf8");
    const surfaceStart = source.indexOf('className="pixi-arena-surface');
    const opponentStatusStart = source.indexOf('className={`pixi-opponent-status', surfaceStart);
    const arenaMarkup = source.slice(surfaceStart, opponentStatusStart);

    assert.match(source, /internalPointToPublic\(hoverPoint\)/);
    assert.match(arenaMarkup, /aria-label="Cursor coordinates"/);
    assert.match(arenaMarkup, /absolute bottom-3 left-3[\s\S]*?text-\[10px\]/);
    assert.match(arenaMarkup, /coords: \{measurementCursor \?/);
    assert.match(arenaMarkup, /aria-label="Distance between selected points"/);
    assert.match(arenaMarkup, /absolute bottom-3 right-3[\s\S]*?text-\[10px\]/);
    assert.match(arenaMarkup, /Distance: \$\{measurementDistance\.toFixed\(1\)\} units/);
    assert.doesNotMatch(arenaMarkup, /pixi-measurement-readout/);
    assert.doesNotMatch(arenaMarkup, /border border-cyan-700|border border-yellow-700|bg-slate-950\/95|shadow-lg/);
    assert.doesNotMatch(source, /positionCursorReadout|screenWidth: app\.screen\.width/);
    assert.doesNotMatch(source, /P\$\{index \+ 1\}:|internalPointToPublic\(point\)/);
});

test("arena keeps its regular grids and border without a brighter custom center axis", () => {
    const source = readFileSync(PIXI_CANVAS_PATH, "utf8");
    assert.match(source, /coordinate <= ARENA_WIDTH_UNITS; coordinate \+= ARENA_GRID_MINOR_STEP_UNITS/);
    assert.match(source, /coordinate % ARENA_GRID_MAJOR_STEP_UNITS === 0/);
    assert.match(source, /color: 0x64748b, alpha: 0\.55, width: 2/);
    assert.match(source, /graphics\.rect\(2, 2, Math\.max\(0, ARENA_WIDTH_UNITS - 4\)/);
    assert.doesNotMatch(source, /0x7dd3fc/);
});
