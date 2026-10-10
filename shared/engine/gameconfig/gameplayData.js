import abilitiesFile from "../../gameplay/abilities.json" with { type: "json" };
import channelsFile from "../../gameplay/channels.json" with { type: "json" };
import movementFile from "../../gameplay/movement.json" with { type: "json" };
import statusesFile from "../../gameplay/statuses.json" with { type: "json" };
import { validateGameplayData } from "./gameplayValidation.js";

/**
 * The shared gameplay data (shared/gameplay/*.json), validated once and deeply frozen. Everything else in
 * the browser reads it through this module. The server reads the same files in GameplayData.java.
 * Every value is written in the files: nothing here fills a missing one in. A JSON `null` means the field
 * does not apply, and `withoutNulls` turns a record into the shape the rest of the code expects.
 */
export function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

/**
 * A copy of `value` without the keys whose value is null (arrays keep their length).
 */
export function withoutNulls(value) {
    if (Array.isArray(value)) return value.map(withoutNulls);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, entry]) => entry !== null)
            .map(([key, entry]) => [key, withoutNulls(entry)]));
    }
    return value;
}

const data = { abilities: abilitiesFile, statuses: statusesFile, movement: movementFile, channels: channelsFile };
validateGameplayData(data);

export const GAMEPLAY_DATA = deepFreeze(structuredClone(data));
