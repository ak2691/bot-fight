import { entityContractForAbility } from "./EntityContracts.js";

const snapshot = (fields) => Object.freeze(fields);

/**
 * Declarative contracts for effects that capture state now and resolve later.
 * The runner owns timing and cleanup; completion types stay allowlisted here.
 */
export const DEFERRED_STATE_CONTRACTS = Object.freeze([
    Object.freeze({
        id: "temporalRewind",
        remainingField: "temporalRewindMs",
        completionVisual: Object.freeze({
            timerField: "temporalRewindPulseMs",
            durationMs: Number(entityContractForAbility(21)?.phases?.[0]?.visual?.visibleMs ?? 400),
        }),
        completion: Object.freeze({
            type: "restoreSnapshot",
            coordinates: Object.freeze({
                x: "temporalRewindX",
                y: "temporalRewindY",
            }),
            health: Object.freeze({
                selectableField: "hp",
                snapshotField: "temporalRewindHp",
                maximumField: "maxHp",
                fallbackField: "hp",
            }),
        }),
        snapshotFields: snapshot(["temporalRewindX", "temporalRewindY", "temporalRewindHp"]),
        completionVisualFields: snapshot(["temporalRewindVisualX", "temporalRewindVisualY"]),
    }),
]);
