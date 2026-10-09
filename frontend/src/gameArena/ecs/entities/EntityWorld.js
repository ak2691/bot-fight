/** Advances the standalone lifetime age of an entity in place, without changing any other timer. */
export function advanceEntityAge(entity, stepMs) {
    entity.ageMs = Math.max(0, entity.ageMs) + Math.max(0, Number(stepMs ?? 0));
    return entity;
}
