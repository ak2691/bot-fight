import { compassDirection } from "../botlogic/planner/arenaAngles.js";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";

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

export function thrownFieldEntity(bot, type, abilityId, size, durationMs) {
    const stats = ABILITY_STATS[abilityId] ?? {};
    const direction = compassDirection(bot.rotation);
    return createEntity({
        type,
        owner: { id: bot.id, slot: bot.slot, abilityId },
        transform: { x: bot.x, y: bot.y, rotation: bot.rotation ?? 0 },
        motion: { x: direction.x * Number(stats.speedPerTick ?? 22), y: direction.y * Number(stats.speedPerTick ?? 22), traveled: 0 },
        lifetime: { ageMs: 0, remainingMs: Number(stats.lifetimeMs ?? durationMs) },
        collider: { size },
        state: { fuseMs: type === "gravityField" ? Number(stats.fuseMs ?? 3000) : 0, armed: false },
    });
}

export function hunterDroneEntity(bot) {
    const stats = ABILITY_STATS[17];
    return createEntity({
        type: "hunterDrone",
        owner: { id: bot.id, slot: bot.slot, abilityId: 17 },
        transform: { x: bot.x, y: bot.y, rotation: bot.rotation ?? 0 },
        lifetime: { ageMs: 0, remainingMs: Number(stats.durationMs ?? 6000) },
        collider: { size: Number(stats.size ?? 28), hittable: true },
        health: { hp: Number(stats.hp ?? 50), maxHp: Number(stats.hp ?? 50) },
        state: { shotCooldownMs: 0 },
    });
}

export function proximityMineEntity(bot) {
    const stats = ABILITY_STATS[11];
    return thrownFieldEntity(bot, "proximityMine", 11, Number(stats.size ?? 24), Number(stats.lifetimeMs ?? 20_000));
}

export function silenceWaveEntity(bot) {
    const stats = ABILITY_STATS[15];
    const direction = compassDirection(bot.rotation);
    return createEntity({
        type: "silenceWave",
        owner: { id: bot.id, slot: bot.slot, abilityId: 15 },
        transform: { x: bot.x, y: bot.y, rotation: bot.rotation ?? 0 },
        motion: { x: direction.x * Number(stats.waveSpeedPerTick ?? 150), y: direction.y * Number(stats.waveSpeedPerTick ?? 150) },
        lifetime: { remainingMs: Number(stats.projectileLifetimeMs ?? 1200) },
        collider: { size: Number(stats.projectileSize ?? 225) },
        state: { hitSlots: [] },
    });
}

export function windburstProjectileEntity(bot) {
    const stats = ABILITY_STATS[18];
    const direction = compassDirection(bot.rotation);
    const size = Number(stats.size ?? 24);
    const spawnOffset = Number(bot.size ?? 60) / 2 + size / 2 + 2;
    return createEntity({
        type: "windburstProjectile",
        owner: { id: bot.id, slot: bot.slot, abilityId: 18 },
        transform: {
            x: bot.x + direction.x * spawnOffset,
            y: bot.y + direction.y * spawnOffset,
            rotation: bot.rotation ?? 0,
        },
        motion: { x: direction.x * Number(stats.speedPerTick ?? 44), y: direction.y * Number(stats.speedPerTick ?? 44), traveled: 0 },
        lifetime: { ageMs: 0, remainingMs: Number(stats.lifetimeMs ?? 500) },
        collider: { size, hittable: true },
        state: { damageMultiplier: Number(bot.attackDamageMultiplier ?? 1) },
    });
}

export function temporalRewindZoneEntity(bot) {
    const stats = ABILITY_STATS[21];
    return createEntity({
        type: "temporalRewindZone",
        owner: { id: bot.id, slot: bot.slot, abilityId: 21 },
        transform: { x: bot.x, y: bot.y, rotation: 0 },
        // The entity world advances newly spawned entities later in the same
        // 100 ms arena step. Include that step so the visible zone remains in
        // sync with the bot's three-second rewind timer.
        lifetime: { remainingMs: Number(stats.zoneLifetimeMs ?? stats.delayMs + 100) },
        collider: { size: Number(stats.zoneSize ?? 90) },
    });
}

export function nullZoneEntity(bot, targetX, targetY, clamp) {
    const stats = ABILITY_STATS[24];
    const radius = Number(stats.radius ?? 150);
    return createEntity({
        type: "nullZone",
        owner: { id: bot.id, slot: bot.slot, abilityId: 24 },
        transform: { x: clamp(Number(targetX ?? bot.x), radius, 1000 - radius), y: clamp(Number(targetY ?? bot.y), radius, 800 - radius) },
        motion: { traveled: Number(stats.travelDistance ?? 176) },
        lifetime: { ageMs: 0, remainingMs: Number(stats.durationMs ?? 5000) },
        collider: { size: Number(stats.fieldSize ?? 300) },
        state: { armed: true },
    });
}

export function orbitalMarkerEntity(bot, targetX, targetY, clamp) {
    // The marker is spawned before the entity world advances. Add one arena
    // tick so the 1.5s gameplay delay resolves on the same tick that a
    // 1.5s guard becomes inactive.
    const stats = ABILITY_STATS[22];
    const fuseMs = Number(stats.delayMs ?? 1500) + 100;
    return createEntity({
        type: "orbitalMarker",
        owner: { id: bot.id, slot: bot.slot, abilityId: 22 },
        transform: { x: clamp(Number(targetX ?? 500), 0, 1000), y: clamp(Number(targetY ?? 400), 0, 1000) },
        lifetime: { remainingMs: fuseMs },
        collider: { size: Number(stats.markerSize ?? 260) },
        state: { fuseMs },
    });
}
