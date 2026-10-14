import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateMatch } from "../../simulateMatch.js";
import { replayFrame } from "../../replayMapping.js";

/*
 * Golden summaries for the authoritative duel-v1 simulation. Each request under requests/
 * produces one small summary (result, winner, frame count, last elapsed time, final bot
 * state, puzzle outcome) plus a sha256 of the full JSON output, so any change to the replay
 * shows up as a golden diff. Used by goldens.test.js and scripts/update-match-goldens.mjs.
 */

export const GOLDENS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)));
export const REQUESTS_DIR = path.join(GOLDENS_DIR, "requests");

export function requestNames() {
    return readdirSync(REQUESTS_DIR)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(/\.json$/, ""))
        .sort();
}

export function readRequest(name) {
    return JSON.parse(readFileSync(path.join(REQUESTS_DIR, `${name}.json`), "utf8"));
}

function sha256(text) {
    return createHash("sha256").update(text).digest("hex");
}

function pickBot(bot) {
    return {
        slot: bot.slot,
        x: bot.x,
        y: bot.y,
        hp: bot.hp,
        rotation: bot.rotation ?? null,
    };
}

export function summarize(request) {
    const output = simulateMatch(request);
    const { replay, endElapsedMs } = output;
    const frames = replay.frames ?? [];
    // Puzzle runs record no frames, so their final bots come from the same mapping the frames use.
    const finalBots = frames.length
        ? frames.at(-1).bots
        : replayFrame(endElapsedMs, output.bots).bots;
    return {
        result: replay.result,
        winnerUserId: replay.winnerUserId ?? null,
        message: replay.message ?? null,
        frameCount: frames.length,
        lastElapsedMs: endElapsedMs,
        finalFrameBots: finalBots
            .filter((bot) => typeof bot.slot === "number")
            .map(pickBot)
            .sort((a, b) => a.slot - b.slot),
        puzzle: output.puzzle ?? null,
        fullOutputSha256: sha256(JSON.stringify(output)),
    };
}
