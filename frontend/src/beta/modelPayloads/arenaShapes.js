import {
    BLOCK_MAX_CHARGES,
    RANGED_AMMO_MAX,
    FIREBALL_CHARGES_MAX,
} from "../combat/Moves.js";
import { DEFAULT_BOT_LOADOUT, botStatsForLoadout, botStatsForSandboxLoadout, decodeBotLoadout, decodeSandboxLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { withoutFighterStatuses } from "../combat/DefensiveState.js";
import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    DUEL_SLOT_ONE_X,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_X,
    DUEL_SLOT_TWO_Y,
} from "./arenaConstants.js";

export const MAIN_SHAPE = {
    id: "main",
    username: "Player",
    type: "circle",
    slot: 1,
    x: ARENA_WIDTH_UNITS / 2,
    y: ARENA_HEIGHT_UNITS / 2,
    size: 60,
    rotation: 90,
    combatLoadout: encodeBotLoadout(DEFAULT_BOT_LOADOUT),
    loadout: DEFAULT_BOT_LOADOUT,
    abilities: [],
    hp: 100,
    maxHp: 100,
    swingCooldownMs: 0,
    swingActiveMs: 0,
    blockCooldownMs: 0,
    blockActiveMs: 0,
    blockCharges: 0,
    blockRechargeMs: 0,
    gunCooldownMs: 0,
    gunActiveMs: 0,
    gunShotActive: false,
    gunAmmo: 0,
    gunReloadMs: 0,
    grenadeCooldownMs: 0,
    grenadeSerial: 1,
    thrownGrenade: null,
    fireballCooldownMs: 0,
    fireballActiveMs: 0,
    fireballCharges: 0,
    fireballReloadMs: 0,
    fireballSerial: 1,
    thrownFireball: null,
    stunCooldownMs: 0,
    stunActiveMs: 0,
    stunnedMs: 0,
    stunCastActive: false,
    burnRemainingMs: 0,
    burnTickMs: 0,
    dashCooldownMs: 0,
    dashActiveMs: 0,
    dashDirectionX: 0,
    dashDirectionY: 0,
    movementVelocityX: 0,
    movementVelocityY: 0,
    velocityX: 0,
    velocityY: 0,
    slowedMs: 0,
};

export function buildOpponentShape(opponent) {
    const loadout = opponent?.loadout
        ? normalizedBotLoadout(opponent.loadout)
        : decodeBotLoadout(opponent?.selectedLoadout ?? opponent?.selectedLoadout);
    const loadoutId = encodeBotLoadout(loadout);
    const abilities = loadout.abilities;
    const stats = botStatsForLoadout(loadout);
    const slot = Number(opponent?.slot) === 1 ? 1 : 2;
    return {
        id: "opponent-model",
        username: opponent?.username ?? "Opponent",
        type: "opponentModel",
        slot,
        x: DUEL_SLOT_TWO_X,
        y: DUEL_SLOT_TWO_Y,
        size: 64,
        rotation: 0,
        combatLoadout: loadoutId,
        loadout,
        abilities,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        swingCooldownMs: 0,
        swingActiveMs: 0,
        blockCooldownMs: 0,
        blockActiveMs: 0,
        blockCharges: abilities.includes("block") ? BLOCK_MAX_CHARGES : 0,
        blockRechargeMs: 0,
        gunCooldownMs: 0,
        gunActiveMs: 0,
        gunShotActive: false,
        gunAmmo: abilities.includes("fire_gun") ? RANGED_AMMO_MAX : 0,
        gunReloadMs: 0,
        grenadeCooldownMs: 0,
        grenadeSerial: 1,
        thrownGrenade: null,
        fireballCooldownMs: 0,
        fireballActiveMs: 0,
        fireballCharges: abilities.includes("shoot_fireball") ? FIREBALL_CHARGES_MAX : 0,
        fireballReloadMs: 0,
        fireballSerial: 1,
        thrownFireball: null,
        stunCooldownMs: 0,
        stunActiveMs: 0,
        stunnedMs: 0,
        stunCastActive: false,
        abilityCooldowns: Object.fromEntries(abilities.map((ability) => [ability, 0])),
        abilityCharges: Object.fromEntries(abilities.filter((ability) => ["proximity_mine", "hunter_drone", "reactive_armor"].includes(ability)).map((ability) => [ability, ability === "reactive_armor" ? 3 : 1])),
        abilityActiveMs: {},
        preparingAbility: null,
        preparingMs: 0,
        preparingTargetX: null,
        preparingTargetY: null,
        burnRemainingMs: 0,
        burnTickMs: 0,
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        slowedMs: 0,
        opponentUsername: opponent?.username ?? "Opponent",
    };
}

export function buildInitialArenaShapes(matchContext) {
    if (matchContext?.matchId) return buildMatchSpawnShapes(matchContext);
    const shapes = [{ ...MAIN_SHAPE }];
    if (matchContext?.opponent) shapes.push(buildOpponentShape(matchContext.opponent));
    return shapes;
}

export function buildMatchSpawnShapes(matchContext) {
    const playerSlot = Number(matchContext?.player?.slot) === 2 ? 2 : 1;
    const opponentSlot = playerSlot === 1 ? 2 : 1;
    const fighters = [
        resetFighterShape({
            ...MAIN_SHAPE,
            combatLoadout: encodeBotLoadout(matchContext?.loadout ?? DEFAULT_BOT_LOADOUT),
            loadout: matchContext?.loadout ?? DEFAULT_BOT_LOADOUT,
            x: playerSlot === 1 ? DUEL_SLOT_ONE_X : DUEL_SLOT_TWO_X,
            y: playerSlot === 1 ? DUEL_SLOT_ONE_Y : DUEL_SLOT_TWO_Y,
            rotation: playerSlot === 1 ? 180 : 0,
            slot: playerSlot,
            userId: matchContext?.player?.userId ?? null,
            username: matchContext?.player?.username ?? "Player",
        }),
        resetFighterShape({
            ...buildOpponentShape(matchContext?.opponent),
            combatLoadout: encodeBotLoadout(matchContext?.opponentLoadout ?? DEFAULT_BOT_LOADOUT),
            loadout: matchContext?.opponentLoadout ?? DEFAULT_BOT_LOADOUT,
            x: opponentSlot === 1 ? DUEL_SLOT_ONE_X : DUEL_SLOT_TWO_X,
            y: opponentSlot === 1 ? DUEL_SLOT_ONE_Y : DUEL_SLOT_TWO_Y,
            rotation: opponentSlot === 1 ? 180 : 0,
            slot: opponentSlot,
            userId: matchContext?.opponent?.userId ?? null,
            username: matchContext?.opponent?.username ?? "Opponent",
        }),
    ];
    return fighters;
}

export function buildCoreShapes() {
    return [];
}

export function cloneShape(shape) {
    return { ...shape };
}

export function cloneShapes(shapes) {
    return shapes.map(cloneShape);
}

export function resetFighterShape(shape) {
    const sandbox = String(shape.combatLoadout).startsWith("sandbox:");
    const loadout = sandbox ? decodeSandboxLoadout(shape.combatLoadout) : normalizedBotLoadout(shape.loadout
        ?? (String(shape.combatLoadout).startsWith("custom:") ? decodeBotLoadout(shape.combatLoadout) : DEFAULT_BOT_LOADOUT));
    const abilities = loadout.abilities;
    const stats = sandbox ? botStatsForSandboxLoadout(loadout) : botStatsForLoadout(loadout);
    return withoutFighterStatuses({
        ...shape,
        combatLoadout: sandbox ? shape.combatLoadout : encodeBotLoadout(loadout),
        loadout,
        abilities,
        spawnX: shape.spawnX ?? shape.x,
        spawnY: shape.spawnY ?? shape.y,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        moveSpeed: stats.moveSpeed,
        attackDamageMultiplier: stats.attackDamagePercent / 100,
        attackSpeedMultiplier: stats.attackSpeedPercent / 100,
        matchElapsedMs: 0,
        customVariables: {},
        swingCooldownMs: 0,
        swingActiveMs: 0,
        blockCooldownMs: 0,
        blockActiveMs: 0,
        blockCharges: abilities.includes("block") ? BLOCK_MAX_CHARGES : 0,
        blockRechargeMs: 0,
        gunCooldownMs: 0,
        gunActiveMs: 0,
        gunShotActive: false,
        gunAmmo: abilities.includes("fire_gun") ? RANGED_AMMO_MAX : 0,
        gunReloadMs: 0,
        grenadeCooldownMs: 0,
        grenadeSerial: 1,
        thrownGrenade: null,
        fireballCooldownMs: 0,
        fireballActiveMs: 0,
        fireballCharges: abilities.includes("shoot_fireball") ? FIREBALL_CHARGES_MAX : 0,
        fireballReloadMs: 0,
        fireballSerial: 1,
        thrownFireball: null,
        stunCooldownMs: 0,
        stunActiveMs: 0,
        stunnedMs: 0,
        stunCastActive: false,
        abilityCooldowns: Object.fromEntries(abilities.map((ability) => [ability, 0])),
        abilityCharges: Object.fromEntries(abilities
            .filter((ability) => ["proximity_mine", "hunter_drone", "reactive_armor"].includes(ability))
            .map((ability) => [ability, ability === "reactive_armor" ? 3 : 1])),
        abilityActiveMs: {},
        preparingAbility: null,
        preparingMs: 0,
        prototypeTriggered: null,
        prototypeVisual: null,
        burnRemainingMs: 0,
        burnTickMs: 0,
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        slowedMs: 0,
        silencedMs: 0,
    });
}

export function buildAutoPlayStartShapes(currentShapes, matchContext, isMatchTesting) {
    const fallbackShapes = isMatchTesting ? buildMatchSpawnShapes(matchContext) : [];
    const fallbackMain = fallbackShapes.find((shape) => shape.id === "main");
    const nextShapes = cloneShapes(currentShapes).filter((shape) => shape.id === "main" || shape.id === "opponent-model");
    if (!nextShapes.some((shape) => shape.id === "main")) {
        nextShapes.unshift(resetFighterShape(fallbackMain ?? { ...MAIN_SHAPE }));
    }
    return nextShapes;
}

export function resetArenaStartShapes(shapes, selectedLoadout, opponentLoadout) {
    return shapes.map((shape) => {
        if (shape.id === "main") return resetFighterShape({ ...shape, x: shape.spawnX ?? shape.x, y: shape.spawnY ?? shape.y, combatLoadout: selectedLoadout });
        if (shape.id === "opponent-model") {
            return resetFighterShape({ ...shape, x: shape.spawnX ?? shape.x, y: shape.spawnY ?? shape.y, combatLoadout: opponentLoadout, locked: false });
        }
        return cloneShape(shape);
    });
}
