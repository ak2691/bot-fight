import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { advanceArenaPreviewTick } from "../modelPayloads/arenaPreviewSimulation.js";
import { mergeBotShapeUpdates, toSimulationBotShape } from "../modelPayloads/arenaShapes.js";
import { DEFAULT_BOT_LOADOUT, encodeBotLoadout } from "../loadout/BotLoadout.js";
import { PRACTICE_OPPONENT_PUBLIC_START, PRACTICE_PLAYER_PUBLIC_START } from "../modelPayloads/arenaConstants.js";
import { publicPointToInternal } from "../modelPayloads/arenaCoordinates.js";
import {
    buildPracticeArenaShapes,
    puzzleBuilderSimulationLookups,
    synchronizePuzzleBuilderBotShape,
} from "./ArenaSetup.js";

const ARENA_SOURCE = fileURLToPath(new URL("../Arena.jsx", import.meta.url));
const LOADOUT = encodeBotLoadout(DEFAULT_BOT_LOADOUT);
const EMPTY_BRAIN = { version: "bot-logic-tree-v2", roots: [] };

const configuredBots = [
    { role: "PLAYER", teamNumber: 1, slot: 1, startX: -300, startY: 450, rotation: 0, startHp: 150 },
    { role: "PLAYER", teamNumber: 1, slot: 2, startX: 120, startY: -250, rotation: 90, startHp: 125 },
    { role: "OPPONENT", teamNumber: 2, slot: 1, startX: 250, startY: -400, rotation: 180, startHp: 140 },
    { role: "OPPONENT", teamNumber: 2, slot: 2, startX: -500, startY: 300, rotation: 270, startHp: 110 },
].map((bot) => ({ ...bot, brain: EMPTY_BRAIN, loadout: LOADOUT }));

const expectedInternalByKey = new Map([
    ["1:1", { x: 300, y: 150 }],
    ["1:2", { x: 720, y: 850 }],
    ["2:1", { x: 850, y: 1000 }],
    ["2:2", { x: 100, y: 300 }],
]);

function puzzleSetup(bots = configuredBots) {
    return {
        playerTeamSize: 2,
        opponentTeamSize: 2,
        initialElapsedMs: 0,
        bots: bots.map((bot) => ({ ...bot })),
    };
}

function simulationBotsByKey(shapes) {
    return new Map(shapes
        .filter((shape) => shape.puzzleBotKey)
        .map((shape) => [shape.puzzleBotKey, toSimulationBotShape(shape)]));
}

function assertConfiguredInternalPositions(shapes) {
    const botsByKey = simulationBotsByKey(shapes);
    assert.equal(botsByKey.size, expectedInternalByKey.size);
    expectedInternalByKey.forEach((expected, key) => {
        const bot = botsByKey.get(key);
        assert.ok(bot, `expected puzzle bot ${key}`);
        assert.deepEqual({ x: bot.x, y: bot.y }, expected);
        assert.deepEqual({ startX: bot.startX, startY: bot.startY }, {
            startX: expected.x, startY: expected.y,
        });
        assert.deepEqual({ spawnX: bot.spawnX, spawnY: bot.spawnY }, {
            spawnX: expected.x, spawnY: expected.y,
        });
    });
}

test("puzzle builder initialization, sync, play, pause/resume, and reset retain converted roster positions", () => {
    const draft = puzzleSetup();
    const publicDraftPositions = draft.bots.map(({ teamNumber, slot, startX, startY }) => ({
        teamNumber, slot, startX, startY,
    }));
    const freshShapes = buildPracticeArenaShapes(LOADOUT, LOADOUT, draft, true);

    // Initial editor construction is the single public-to-internal conversion boundary.
    assertConfiguredInternalPositions(freshShapes);
    const lookups = puzzleBuilderSimulationLookups(freshShapes);
    assert.deepEqual(lookups.setupByKey["1:1"], {
        x: 300, y: 150, startX: 300, startY: 150, rotation: 0, startHp: 150,
    });
    assert.deepEqual(lookups.setupById.main, lookups.setupByKey["1:1"]);
    assert.deepEqual(lookups.setupById["opponent-model"], lookups.setupByKey["2:1"]);

    // A sync pass must be a no-op on fresh internal shapes, never a second conversion.
    const unchanged = freshShapes.map((shape) => {
        const result = synchronizePuzzleBuilderBotShape(shape, lookups, 0);
        assert.equal(result.changed, false);
        assert.equal(result.shape, shape);
        return result.shape;
    });
    assertConfiguredInternalPositions(unchanged);

    // Model the former bug: public values have leaked into the live simulation shapes.
    const leakedPublicCoordinates = freshShapes.map((shape) => {
        const configured = draft.bots.find((bot) => `${bot.teamNumber}:${bot.slot}` === shape.puzzleBotKey);
        return mergeBotShapeUpdates(shape, {
            x: configured.startX,
            y: configured.startY,
            startX: configured.startX,
            startY: configured.startY,
            spawnX: configured.startX,
            spawnY: configured.startY,
        });
    });
    const synchronized = leakedPublicCoordinates.map((shape) => (
        synchronizePuzzleBuilderBotShape(shape, lookups, 0).shape
    ));
    assertConfiguredInternalPositions(synchronized);

    // The id fallback for the two primary bots is sourced from the same internal lookups.
    for (const [id, key] of [["main", "1:1"], ["opponent-model", "2:1"]]) {
        const shape = leakedPublicCoordinates.find((candidate) => candidate.id === id);
        const fallbackResult = synchronizePuzzleBuilderBotShape(shape, {
            setupByKey: {},
            setupById: lookups.setupById,
        }, 0);
        assert.equal(fallbackResult.changed, true);
        assert.deepEqual(
            { x: toSimulationBotShape(fallbackResult.shape).x, y: toSimulationBotShape(fallbackResult.shape).y },
            expectedInternalByKey.get(key),
        );
    }

    const tickOptions = {
        selectedLoadout: LOADOUT,
        opponentLoadout: LOADOUT,
        testingConfiguration: EMPTY_BRAIN,
        opponentTestingConfiguration: EMPTY_BRAIN,
    };
    const afterFirstPlay = advanceArenaPreviewTick(synchronized, tickOptions);
    assertConfiguredInternalPositions(afterFirstPlay);
    const afterPause = afterFirstPlay;
    const afterResume = advanceArenaPreviewTick(afterPause, tickOptions);
    assertConfiguredInternalPositions(afterResume);

    // Reset Stats rebuilds from the unchanged public draft and returns identical internals.
    const resetShapes = buildPracticeArenaShapes(LOADOUT, LOADOUT, draft);
    assertConfiguredInternalPositions(resetShapes);
    assert.deepEqual(draft.bots.map(({ teamNumber, slot, startX, startY }) => ({
        teamNumber, slot, startX, startY,
    })), publicDraftPositions);
    assert.deepEqual(publicDraftPositions[0], {
        teamNumber: 1, slot: 1, startX: -300, startY: 450,
    });
});

test("legacy puzzle inputs and ordinary practice setup retain their existing coordinate conversion", () => {
    const legacyPuzzle = {
        playerBot: { role: "PLAYER", startX: -300, startY: 450, rotation: 0, startHp: 150, brain: EMPTY_BRAIN },
        opponentBot: { role: "OPPONENT", startX: 250, startY: -400, rotation: 180, startHp: 150, brain: EMPTY_BRAIN },
    };
    const legacyShapes = buildPracticeArenaShapes(LOADOUT, LOADOUT, legacyPuzzle);
    const legacyById = new Map(legacyShapes.map((shape) => [shape.id, toSimulationBotShape(shape)]));
    assert.deepEqual({ x: legacyById.get("main").x, y: legacyById.get("main").y }, { x: 300, y: 150 });
    assert.deepEqual({ x: legacyById.get("opponent-model").x, y: legacyById.get("opponent-model").y }, { x: 850, y: 1000 });

    const practiceShapes = buildPracticeArenaShapes(LOADOUT, LOADOUT);
    const practiceById = new Map(practiceShapes.map((shape) => [shape.id, toSimulationBotShape(shape)]));
    assert.deepEqual(
        { x: practiceById.get("main").x, y: practiceById.get("main").y },
        publicPointToInternal(PRACTICE_PLAYER_PUBLIC_START),
    );
    assert.deepEqual(
        { x: practiceById.get("opponent-model").x, y: practiceById.get("opponent-model").y },
        publicPointToInternal(PRACTICE_OPPONENT_PUBLIC_START),
    );
});

test("puzzle synchronization is gated by unchanged starting configuration and preserves public drag writes", () => {
    const arenaSource = readFileSync(ARENA_SOURCE, "utf8");
    const setupKeyStart = arenaSource.indexOf("const puzzleSetupKey = JSON.stringify([");
    const setupKeyEnd = arenaSource.indexOf("const previousPuzzleSetupKeyRef", setupKeyStart);
    const setupKeySource = arenaSource.slice(setupKeyStart, setupKeyEnd);
    const syncStart = arenaSource.indexOf("if (!isPuzzleBuilder || isAutoPlaying) return;");
    const syncEnd = arenaSource.indexOf("}, [initialPuzzle, initialPuzzleElapsedMs", syncStart);
    const syncSource = arenaSource.slice(syncStart, syncEnd);

    assert.ok(setupKeyStart >= 0 && setupKeyEnd > setupKeyStart);
    assert.doesNotMatch(setupKeySource, /brain|loadout|strategyConfiguration/);
    assert.match(syncSource, /if \(previousPuzzleSetupKeyRef\.current === puzzleSetupKey\) return;/);
    assert.match(syncSource, /puzzleBuilderSimulationLookups\(freshBotShapes\)/);
    assert.match(syncSource, /synchronizePuzzleBuilderBotShape\(shape, setupLookups, initialPuzzleElapsedMs\)/);
    assert.doesNotMatch(syncSource, /startX:\s*bot\.startX|startY:\s*bot\.startY/);
    assert.doesNotMatch(syncSource, /onPuzzleDraftChange/);

    assert.match(arenaSource, /const publicPosition = internalPointToPublic\(internalPosition\)/);
    assert.match(arenaSource, /startX: publicPosition\.x, startY: publicPosition\.y/);
    const resetStart = arenaSource.indexOf("const resetArenaStats = () => {");
    const resetEnd = arenaSource.indexOf("const handleAutoPlayToggle =", resetStart);
    assert.match(arenaSource.slice(resetStart, resetEnd), /setShapes\(buildPracticeArenaShapes\([\s\S]*?puzzleArenaSetup/);
});
