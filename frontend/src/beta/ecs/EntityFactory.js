import { compassDirection } from "../../logic/arenaAngles.js";

let nextEntityId = 1;

/** Creates the canonical component envelope used by browser arena systems. */
export function createEntity({ type, owner, transform, motion = {}, lifetime = {}, collider = {}, health = null, state = {} }) {
    const id = `${type}-${owner.id}-${Date.now()}-${nextEntityId++}`;
    return {
        id,
        type,
        abilityId: owner.abilityId,
        ownerId: owner.id,
        ownerSlot: owner.slot,
        x: transform.x,
        y: transform.y,
        rotation: transform.rotation ?? 0,
        size: collider.size ?? 0,
        velocityX: motion.x ?? 0,
        velocityY: motion.y ?? 0,
        traveled: motion.traveled ?? 0,
        ageMs: lifetime.ageMs ?? 0,
        remainingMs: lifetime.remainingMs ?? null,
        hp: health?.hp,
        maxHp: health?.maxHp,
        locked: true,
        components: {
            transform: { ...transform },
            motion: { ...motion },
            lifetime: { ...lifetime },
            collider: { ...collider },
            ownership: { ownerId: owner.id, ownerSlot: owner.slot },
            ...(health ? { health: { ...health } } : {}),
        },
        ...state,
    };
}

export function thrownFieldEntity(fighter, type, abilityId, size, durationMs) {
    const direction = compassDirection(fighter.rotation);
    return createEntity({
        type,
        owner: { id: fighter.id, slot: fighter.slot, abilityId },
        transform: { x: fighter.x, y: fighter.y, rotation: fighter.rotation ?? 0 },
        motion: { x: direction.x * 22, y: direction.y * 22, traveled: 0 },
        lifetime: { ageMs: 0, remainingMs: durationMs },
        collider: { size },
        state: { fuseMs: type === "gravityField" ? 3000 : 0, armed: false },
    });
}

export function hunterDroneEntity(fighter) {
    return createEntity({
        type: "hunterDrone",
        owner: { id: fighter.id, slot: fighter.slot, abilityId: "hunter_drone" },
        transform: { x: fighter.x, y: fighter.y, rotation: fighter.rotation ?? 0 },
        lifetime: { ageMs: 0, remainingMs: 6000 },
        collider: { size: 28, hittable: true },
        health: { hp: 50, maxHp: 50 },
        state: { shotCooldownMs: 0 },
    });
}

export function proximityMineEntity(fighter) {
    return thrownFieldEntity(fighter, "proximityMine", "proximity_mine", 24, 20_000);
}

export function silenceWaveEntity(fighter) {
    const direction = compassDirection(fighter.rotation);
    return createEntity({
        type: "silenceWave",
        owner: { id: fighter.id, slot: fighter.slot, abilityId: "silence_pulse" },
        transform: { x: fighter.x, y: fighter.y, rotation: fighter.rotation ?? 0 },
        motion: { x: direction.x * 150, y: direction.y * 150 },
        lifetime: { remainingMs: 1200 },
        collider: { size: 225 },
        state: { hitSlots: [] },
    });
}

export function temporalRewindZoneEntity(fighter) {
    return createEntity({
        type: "temporalRewindZone",
        owner: { id: fighter.id, slot: fighter.slot, abilityId: "temporal_rewind" },
        transform: { x: fighter.x, y: fighter.y, rotation: 0 },
        // The entity world advances newly spawned entities later in the same
        // 100 ms arena step. Include that step so the visible zone remains in
        // sync with the fighter's three-second rewind timer.
        lifetime: { remainingMs: 3100 },
        collider: { size: 90 },
    });
}

export function nullZoneEntity(fighter, targetX, targetY, clamp) {
    return createEntity({
        type: "nullZone",
        owner: { id: fighter.id, slot: fighter.slot, abilityId: "null_zone" },
        transform: { x: clamp(Number(targetX ?? fighter.x), 150, 850), y: clamp(Number(targetY ?? fighter.y), 150, 850) },
        motion: { traveled: 176 },
        lifetime: { ageMs: 0, remainingMs: 5000 },
        collider: { size: 300 },
        state: { armed: true },
    });
}

export function orbitalMarkerEntity(fighter, targetX, targetY, clamp) {
    return createEntity({
        type: "orbitalMarker",
        owner: { id: fighter.id, slot: fighter.slot, abilityId: "orbital_strike" },
        transform: { x: clamp(Number(targetX ?? 500), 0, 1000), y: clamp(Number(targetY ?? 400), 0, 1000) },
        lifetime: { remainingMs: 1500 },
        collider: { size: 260 },
        state: { fuseMs: 1500 },
    });
}
