import {
    FIREBALL_DAMAGE,
    GUN_RANGE,
} from "../combat/Moves.js";
import {
    STUN_DAMAGE,
} from "../combat/Abilities.js";
import {
    PROTOTYPE_ABILITY_STATS,
    PROTOTYPE_ACTION_TO_ABILITY,
} from "../loadout/BotLoadout.js";
import { angleDelta, clamp, normalizeAngle, rayIntersectsCircle, segmentIntersectsCircle } from "../combat/geometry.js";
import { runEntityWorld, withComponentState } from "./EntityWorld.js";
import { abilityContract, EFFECT_TYPES } from "../combat/AbilityContracts.js";
import { resolveShieldInteraction } from "../combat/ShieldSystem.js";
import { ignoresHostileEffects } from "../combat/DefensiveState.js";
import { vectorToCompassDegrees } from "../../logic/arenaAngles.js";

const ENTITY_TYPES = new Set([
    "proximityMine", "mineExplosion", "orbitalMarker", "orbitalExplosion",
    "gravityField", "gravityExplosion", "nullZone", "hunterDrone", "silenceWave", "temporalRewindZone",
]);

export function isAbilityEntity(entity) {
    return ENTITY_TYPES.has(entity?.type);
}

/**
 * Advances persistent ability entities through deterministic ordered systems.
 * Combat math is injected so this system does not own fighter rules.
 */
export function tickAbilityEntityWorld(world, combat) {
    return runEntityWorld({
        ...world,
        fighters: world.fighters.map((fighter) => ({ ...fighter, nullZoneSilenced: false })),
    }, [
        markMinesHitByAttacks(),
        tickMines(combat),
        tickNonMineEntities(combat),
    ]);
}

function markMinesHitByAttacks() {
    return (world) => ({
        entities: world.entities.map((entity) => entity.type === "proximityMine"
            && mineHitByCurrentAttack(entity, world)
            ? withComponentState(entity, { hitTriggered: true })
            : entity),
    });
}

function tickMines(combat) {
    return (world) => {
        let fighters = world.fighters.map((fighter) => ({ ...fighter }));
        const mines = world.entities.filter((entity) => entity.type === "proximityMine").map((mine) => {
            const traveled = Number(mine.traveled ?? 0);
            const moving = traveled < 176;
            return moving
                ? withComponentState(mine, {
                    x: clamp(mine.x + mine.velocityX, 12, world.width - 12),
                    y: clamp(mine.y + mine.velocityY, 12, world.height - 12),
                    traveled: traveled + Math.hypot(mine.velocityX, mine.velocityY),
                    ageMs: Number(mine.ageMs ?? 0) + world.stepMs,
                    armed: false,
                })
                : withComponentState(mine, {
                    velocityX: 0,
                    velocityY: 0,
                    ageMs: Number(mine.ageMs ?? 0) + world.stepMs,
                    armed: true,
                });
        });
        const triggered = new Set(mines.filter((mine) => (
            Number(mine.ageMs) >= 20_000
            || mine.hitTriggered
            || (mine.armed && fighters.some((fighter) => fighter.slot !== mine.ownerSlot
                && Math.hypot(fighter.x - mine.x, fighter.y - mine.y) <= 70 + fighter.size / 2))
        )).map((mine) => mine.id));
        let changed = true;
        while (changed) {
            changed = false;
            for (const source of mines.filter((mine) => triggered.has(mine.id))) {
                for (const target of mines) {
                    if (!triggered.has(target.id) && Math.hypot(target.x - source.x, target.y - source.y) <= 70 + target.size / 2) {
                        triggered.add(target.id);
                        changed = true;
                    }
                }
            }
        }
        const entities = world.entities.filter((entity) => entity.type !== "proximityMine");
        for (const mine of mines) {
            if (!triggered.has(mine.id)) {
                entities.push(mine);
                continue;
            }
            fighters = fighters.map((fighter) => {
                if (Math.hypot(fighter.x - mine.x, fighter.y - mine.y) > 70 + fighter.size / 2) return fighter;
                if (ignoresHostileEffects(fighter)) return fighter;
                const shield = resolveEntityShield(fighter, mine, "proximity_mine");
                return shield.preventedEffects.has(EFFECT_TYPES.DAMAGE) ? shield.fighter : combat.applyDamageToShape(shield.fighter, 18);
            });
            entities.push(withComponentState(mine, { id: `${mine.id}-blast`, type: "mineExplosion", size: 140, visibleMs: 300, spawnedThisTick: true }));
        }
        return { entities, fighters };
    };
}

function tickNonMineEntities(combat) {
    return (world) => {
        let fighters = world.fighters;
        const entities = [];
        for (const entity of world.entities) {
            if (entity.spawnedThisTick) {
                const readyNextTick = { ...entity };
                delete readyNextTick.spawnedThisTick;
                entities.push(readyNextTick);
                continue;
            }
            if (entity.type === "proximityMine") {
                entities.push(entity);
                continue;
            }
            const result = tickEntity(entity, { ...world, fighters }, combat);
            fighters = result.fighters;
            if (result.entity) entities.push(result.entity);
        }
        return { entities, fighters };
    };
}

function tickEntity(entity, world, combat) {
    if (entity.type === "silenceWave") return tickSilenceWave(entity, world);
    if (entity.type === "gravityField" || entity.type === "nullZone") return tickField(entity, world, combat);
    if (entity.type === "hunterDrone") return tickHunterDrone(entity, world, combat);
    if (entity.type === "orbitalMarker") return tickOrbitalMarker(entity, world, combat);
    if (entity.type === "temporalRewindZone") {
        const remainingMs = Number(entity.remainingMs ?? 3000) - world.stepMs;
        return { fighters: world.fighters, entity: remainingMs > 0 ? withComponentState(entity, { remainingMs }) : null };
    }
    if (["mineExplosion", "orbitalExplosion", "gravityExplosion"].includes(entity.type)) {
        const visibleMs = Number(entity.visibleMs ?? 0) - world.stepMs;
        return { fighters: world.fighters, entity: visibleMs > 0 ? withComponentState(entity, { visibleMs }) : null };
    }
    return { fighters: world.fighters, entity };
}

function tickSilenceWave(entity, world) {
    const start = { x: entity.x, y: entity.y };
    const end = {
        x: clamp(entity.x + entity.velocityX, 0, world.width),
        y: clamp(entity.y + entity.velocityY, 0, world.height),
    };
    const remainingMs = Number(entity.remainingMs ?? 1000) - world.stepMs;
    const hitSlots = [...(entity.hitSlots ?? [])];
    let blocked = false;
    const fighters = world.fighters.map((fighter) => {
        if (fighter.slot === entity.ownerSlot || hitSlots.includes(fighter.slot)
            || !segmentIntersectsCircle(start, end, { ...fighter, size: fighter.size + entity.size })) return fighter;
        if (ignoresHostileEffects(fighter)) return fighter;
        hitSlots.push(fighter.slot);
        const shield = resolveEntityShield(fighter, entity, "silence_pulse");
        if (shield.preventedEffects.has(EFFECT_TYPES.DEBUFF)) {
            blocked = true;
            return shield.fighter;
        }
        return { ...fighter, silencedMs: 2000, stunnedMs: Math.max(Number(fighter.stunnedMs ?? 0), 100), preparingAbility: null, preparingMs: 0 };
    });
    const hitEdge = end.x === 0 || end.x === world.width || end.y === 0 || end.y === world.height;
    return {
        fighters,
        entity: remainingMs > 0 && !hitEdge && !blocked ? withComponentState(entity, { ...end, remainingMs, hitSlots }) : null,
    };
}

function tickField(entity, world, combat) {
    const traveled = Number(entity.traveled ?? 0);
    const moving = traveled < 176;
    const ageMs = Number(entity.ageMs ?? 0) + world.stepMs;
    const fuseMs = entity.type === "gravityField" && !moving
        ? Math.max(0, Number(entity.fuseMs ?? 3000) - world.stepMs)
        : Number(entity.fuseMs ?? 0);
    const active = !moving && (entity.type !== "gravityField" || fuseMs <= 0);
    const remainingMs = Number(entity.remainingMs ?? (entity.type === "gravityField" ? 2000 : 5000)) - (active ? world.stepMs : 0);
    const field = moving
        ? withComponentState(entity, {
            x: clamp(entity.x + entity.velocityX, entity.size / 2, world.width - entity.size / 2),
            y: clamp(entity.y + entity.velocityY, entity.size / 2, world.height - entity.size / 2),
            traveled: traveled + Math.hypot(entity.velocityX, entity.velocityY), ageMs, armed: false,
        })
        : withComponentState(entity, { velocityX: 0, velocityY: 0, ageMs, fuseMs, remainingMs, armed: active });
    if (remainingMs <= 0) return { fighters: world.fighters, entity: null };
    let fighters = world.fighters;
    if (!moving && entity.type === "gravityField" && fuseMs > 0) {
        fighters = fighters.map((fighter) => {
            const dx = field.x - fighter.x;
            const dy = field.y - fighter.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= 0.001 || distance > field.size / 2 + fighter.size / 2) return fighter;
            if (ignoresHostileEffects(fighter)) return fighter;
            return {
                ...fighter,
                x: clamp(fighter.x + dx / distance * 6, fighter.size / 2, world.width - fighter.size / 2),
                y: clamp(fighter.y + dy / distance * 6, fighter.size / 2, world.height - fighter.size / 2),
            };
        });
        return { fighters, entity: field };
    }
    if (active) {
        fighters = fighters.map((fighter) => {
            const dx = field.x - fighter.x;
            const dy = field.y - fighter.y;
            const distance = Math.hypot(dx, dy);
            if (distance > field.size / 2 + fighter.size / 2) return fighter;
            if (ignoresHostileEffects(fighter)) return fighter;
            if (entity.type === "nullZone") return { ...fighter, nullZoneSilenced: true };
            const stats = PROTOTYPE_ABILITY_STATS.gravity_grenade;
            const band = Math.min(3, Math.floor(distance / Math.max(1, Number(stats.radius) / 4)));
            const damage = Number(stats.maxDamage) - band * Number(stats.damageStep);
            if (field.damageApplied) return fighter;
            const shield = resolveEntityShield(fighter, field, "gravity_grenade");
            return shield.preventedEffects.has(EFFECT_TYPES.DAMAGE) ? shield.fighter : combat.applyDamageToShape(shield.fighter, damage);
        });
    }
    return {
        fighters,
        entity: entity.type === "gravityField" && active
            ? withComponentState(field, { id: `${field.id}-blast`, type: "gravityExplosion", visibleMs: 300, armed: true })
            : field,
    };
}

function tickHunterDrone(entity, world, combat) {
    const remainingMs = Number(entity.remainingMs ?? 6000) - world.stepMs;
    if (remainingMs <= 0) return { fighters: world.fighters, entity: null };
    const hp = Number(entity.hp ?? 50) - damageToDroneThisTick(entity, world, combat);
    if (hp <= 0) return { fighters: world.fighters, entity: null };
    let fighters = world.fighters;
        const target = fighters.filter((fighter) => fighter.slot !== entity.ownerSlot && Number(fighter.hp ?? 0) > 0)
        .sort((a, b) => Math.hypot(a.x - entity.x, a.y - entity.y) - Math.hypot(b.x - entity.x, b.y - entity.y))[0];
    let drone = withComponentState(entity, {
        hp, remainingMs, ageMs: Number(entity.ageMs ?? 0) + world.stepMs,
        shotCooldownMs: Math.max(0, Number(entity.shotCooldownMs ?? 0) - world.stepMs),
    });
    if (target) {
        const dx = target.x - drone.x;
        const dy = target.y - drone.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const desiredRotation = vectorToCompassDegrees(dx, dy);
        const rotation = normalizeAngle(Number(drone.rotation ?? 0) + clamp(angleDelta(Number(drone.rotation ?? 0), desiredRotation), -8, 8));
        drone = withComponentState(drone, {
            x: clamp(drone.x + dx / distance * Math.min(4.5, distance), 14, world.width - 14),
            y: clamp(drone.y + dy / distance * Math.min(4.5, distance), 14, world.height - 14),
            rotation,
        });
        const shotRange = Number(PROTOTYPE_ABILITY_STATS.hunter_drone.range ?? 200);
        if (drone.shotCooldownMs <= 0 && rayIntersectsCircle(drone, rotation, shotRange, target)) {
            const ownerIndex = fighters.findIndex((fighter) => fighter.slot === entity.ownerSlot);
            const targetIndex = fighters.findIndex((fighter) => fighter.id === target.id);
            fighters = [...fighters];
            const shield = targetIndex >= 0 && !ignoresHostileEffects(fighters[targetIndex]) ? resolveEntityShield(fighters[targetIndex], drone, "hunter_drone") : { preventedEffects: new Set([EFFECT_TYPES.DAMAGE]) };
            if (shield.preventedEffects.has(EFFECT_TYPES.DAMAGE)) fighters[targetIndex] = shield.fighter;
            else if (targetIndex >= 0 && ownerIndex >= 0) [fighters[ownerIndex], fighters[targetIndex]] = combat.applyDamageFromShapes(fighters[ownerIndex], fighters[targetIndex], 3);
            else if (targetIndex >= 0) fighters[targetIndex] = combat.applyDamageToShape(fighters[targetIndex], 3);
            drone = withComponentState(drone, {
                shotCooldownMs: Number(PROTOTYPE_ABILITY_STATS.hunter_drone.shotCooldownMs ?? 1000),
                shotVisualMs: 300,
            });
        }
    }
    drone = withComponentState(drone, { shotVisualMs: Math.max(0, Number(drone.shotVisualMs ?? 0) - world.stepMs) });
    return { fighters, entity: drone };
}

function tickOrbitalMarker(entity, world, combat) {
    const fuseMs = Number(entity.fuseMs ?? 1500) - world.stepMs;
    if (fuseMs > 0) return { fighters: world.fighters, entity: withComponentState(entity, { fuseMs }) };
    const fighters = world.fighters.map((fighter) => {
        const distance = Math.hypot(fighter.x - entity.x, fighter.y - entity.y);
        if (distance > 130 + fighter.size / 2) return fighter;
        if (ignoresHostileEffects(fighter)) return fighter;
        const shield = resolveEntityShield(fighter, entity, "orbital_strike");
        return combat.applyDamageToShape(shield.fighter, 50 * Math.max(0.25, 1 - distance / 130));
    });
    return {
        fighters,
        entity: withComponentState(entity, { id: `${entity.id}-blast`, type: "orbitalExplosion", size: 260, visibleMs: 400 }),
    };
}

function resolveEntityShield(fighter, source, abilityId) {
    return resolveShieldInteraction(fighter, source, abilityContract(abilityId)?.shieldInteraction);
}

function mineHitByCurrentAttack(mine, world) {
    const { fighters, grenades = [], fireballs = [], entities } = world;
    if (fighters.some((fighter) => (fighter.entityHitIds ?? []).includes(mine.id))) return true;
    if ([...grenades, ...fireballs].some((entity) => Math.hypot(entity.x - mine.x, entity.y - mine.y) <= (Number(entity.size ?? 12) + mine.size) / 2)) return true;
    if (entities.some((entity) => entity.id !== mine.id && entity.type === "silenceWave"
        && Math.hypot(entity.x - mine.x, entity.y - mine.y) <= (Number(entity.size ?? 0) + mine.size) / 2)) return true;
    return fighters.some((fighter) => {
        if (fighter.gunShotActive && rayIntersectsCircle(fighter, Number(fighter.rotation ?? 0), GUN_RANGE, mine)) return true;
        const ability = PROTOTYPE_ACTION_TO_ABILITY[fighter.prototypeTriggered];
        const stats = PROTOTYPE_ABILITY_STATS[ability] ?? {};
        if (["pistol_shot", "concussive_shot", "rail_shot"].includes(ability)) return rayIntersectsCircle(fighter, Number(fighter.rotation ?? 0), Number(stats.range ?? 0), mine);
        if (["heavy_slash", "quick_jab", "thrust", "repulsor_burst"].includes(ability)) return Math.hypot(fighter.x - mine.x, fighter.y - mine.y) <= Number(stats.range ?? stats.radius ?? 0) + mine.size / 2;
        return false;
    });
}

function damageToDroneThisTick(drone, world, combat) {
    let damage = 0;
    for (const fighter of world.fighters) {
        if ((fighter.swingActiveMs ?? 0) > 0 && combat.isSwingHitting(fighter, drone)) damage += combat.incomingMeleeDamage(fighter, drone);
        if (fighter.gunShotActive && rayIntersectsCircle(fighter, Number(fighter.rotation ?? 0), Number(GUN_RANGE), drone)) damage += combat.incomingGunDamage(fighter, drone);
        if (fighter.stunCastActive && combat.stunHits(fighter, drone)) damage += STUN_DAMAGE * combat.attackerDamageMultiplier(fighter);
        const ability = PROTOTYPE_ACTION_TO_ABILITY[fighter.prototypeTriggered];
        const stats = PROTOTYPE_ABILITY_STATS[ability] ?? {};
        const distance = Math.hypot(fighter.x - drone.x, fighter.y - drone.y);
        const rayHit = ["pistol_shot", "concussive_shot", "rail_shot"].includes(ability)
            && rayIntersectsCircle(fighter, Number(fighter.rotation ?? 0), Number(stats.range ?? 0), drone);
        const areaHit = ["heavy_slash", "quick_jab", "thrust", "repulsor_burst", "phase_strike"].includes(ability)
            && distance <= Number(stats.range ?? stats.radius ?? 0) + drone.size / 2;
        if (rayHit || areaHit) damage += Number(stats.damage ?? 0) * combat.attackerDamageMultiplier(fighter);
    }
    for (const fireball of world.fireballs ?? []) if (fireball.type === "fireball" && combat.overlapsShape(fireball, drone)) damage += FIREBALL_DAMAGE * Number(fireball.damageMultiplier ?? 1);
    for (const grenade of world.grenades ?? []) if (grenade.type === "grenadeExplosion") damage += combat.grenadeDamageToFighter(grenade, drone);
    for (const effect of world.entities.filter((candidate) => !candidate.spawnedThisTick)) {
        const distance = Math.hypot(effect.x - drone.x, effect.y - drone.y);
        if (effect.type === "mineExplosion" && distance <= effect.size / 2 + drone.size / 2) damage += 18;
        if (effect.type === "gravityExplosion" && distance <= effect.size / 2 + drone.size / 2) damage += 35;
        if (effect.type === "orbitalExplosion" && distance <= effect.size / 2 + drone.size / 2) damage += 50 * Math.max(0.25, 1 - distance / 130);
    }
    return damage;
}
