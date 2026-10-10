import { isAbilityEntity } from "./ecs/abilities/AbilityEntitySystem.js";
import { isBotState } from "./modelPayloads/botState.js";
import { preparingAbilityId, preparingRemainingMs } from "./gameconfig/AbilityState.js";

/** Three decimals, null/undefined/NaN as 0, never "-0.000". Same rule as GoldenScenarioRunner.fixed. */
function fixed(value) {
    const number = Number(value ?? 0);
    const text = (Math.round((Number.isFinite(number) ? number : 0) * 1000) / 1000).toFixed(3);
    return text === "-0.000" ? "0.000" : text;
}

/** FNV-1a over the string's UTF-16 code units (the state strings are ASCII). */
export function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/** Runtime-neutral entity id: the browser builds "<type>-<botId>-<n>", the server "ability-<botUuid>-<n>". */
function canonicalEntityId(entity) {
    const id = String(entity.id ?? "");
    const serial = /-([0-9]+)$/.exec(id)?.[1] ?? id;
    return `${entity.type}-s${entity.ownerSlot}-${serial}`;
}

/**
 * The text that gets hashed, one line per bot (by slot) then per ability entity (by id):
 *   b<slot>|x|y|rotation|hp|stamina|preparingAbilityId-or--|preparingMs|<type>:<roundedRemainingMs>,... (sorted)
 *   e|<type>-s<ownerSlot>-<serial>|<type>|x|y|hp
 * Numbers use three decimals; status remainingMs is rounded to whole ms. GoldenScenarioRunner.stateLines
 * on the server must produce the same text.
 */
export function stateLines(shapes) {
    const bots = shapes.filter(isBotState)
        .sort((first, second) => first.slot - second.slot)
        .map((bot) => [
            `b${bot.slot}`, fixed(bot.x), fixed(bot.y), fixed(bot.rotation), fixed(bot.hp), fixed(bot.stamina),
            preparingAbilityId(bot) ?? "-", fixed(preparingRemainingMs(bot)),
            (bot.statusEffects ?? []).map((status) => `${status.type}:${Math.round(Number(status.remainingMs ?? 0))}`).sort().join(","),
        ].join("|"));
    const entities = shapes.filter(isAbilityEntity)
        .map((entity) => ({ entity, id: canonicalEntityId(entity) }))
        .sort((first, second) => (first.id < second.id ? -1 : first.id > second.id ? 1 : 0))
        .map(({ entity, id }) => ["e", id, entity.type, fixed(entity.x), fixed(entity.y), fixed(entity.hp)].join("|"));
    return [...bots, ...entities];
}

export function stateHash(shapes) {
    return fnv1a(stateLines(shapes).join("\n"));
}

