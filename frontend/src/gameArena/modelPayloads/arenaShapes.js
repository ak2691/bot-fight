import {
    BASE_BOT_HP,
} from "./arenaConstants.js";
import { ABILITY_STATS } from "../gameconfig/Abilities.js";
import { DEFAULT_BOT_LOADOUT, STANDARD_ABILITY_IDS, botStatsForLoadout, botStatsForSandboxLoadout, decodeBotLoadout, decodeSandboxLoadout, encodeBotLoadout, normalizedBotLoadout } from "../loadout/BotLoadout.js";
import { withoutBotStatuses } from "../gameconfig/DefensiveState.js";
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
    abilities: [...STANDARD_ABILITY_IDS],
    hp: BASE_BOT_HP,
    maxHp: BASE_BOT_HP,
    abilityActiveMs: {},
    swingCooldownMs: 0,
    blockCooldownMs: 0,
    blockCharges: 0,
    blockRechargeMs: 0,
    gunCooldownMs: 0,
    gunAmmo: 0,
    gunReloadMs: 0,
    grenadeCooldownMs: 0,
    grenadeSerial: 1,
    thrownGrenade: null,
    fireballCooldownMs: 0,
    fireballCharges: 0,
    fireballReloadMs: 0,
    fireballSerial: 1,
    thrownFireball: null,
    stunCooldownMs: 0,
    stunnedMs: 0,
    burnRemainingMs: 0,
    burnTickMs: 0,
    burnSourceSlot: null,
    movementVelocityX: 0,
    movementVelocityY: 0,
    velocityX: 0,
    velocityY: 0,
    slowedMs: 0,
    hitStaggerMs: 0,
};

export function buildOpponentShape(opponent) {
    const loadout = opponent?.loadout
        ? normalizedBotLoadout(opponent.loadout)
        : decodeBotLoadout(opponent?.selectedLoadout ?? opponent?.selectedLoadout);
    const loadoutId = encodeBotLoadout(loadout);
    const abilities = abilitiesForLoadout(loadout);
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
        abilityActiveMs: {},
        swingCooldownMs: 0,
        blockCooldownMs: 0,
        blockCharges: abilities.includes(2) ? ABILITY_STATS[2].maxCharges : 0,
        blockRechargeMs: 0,
        gunCooldownMs: 0,
        gunAmmo: abilities.includes(3) ? ABILITY_STATS[3].ammoMax : 0,
        gunReloadMs: 0,
        grenadeCooldownMs: 0,
        grenadeSerial: 1,
        thrownGrenade: null,
        fireballCooldownMs: 0,
        fireballCharges: abilities.includes(5) ? ABILITY_STATS[5].maxCharges : 0,
        fireballReloadMs: 0,
        fireballSerial: 1,
        thrownFireball: null,
        stunCooldownMs: 0,
        stunnedMs: 0,
        abilityCooldowns: Object.fromEntries(abilities.map((ability) => [ability, 0])),
        abilityCharges: initialAbilityCharges(abilities),
        preparingAbility: null,
        preparingMs: 0,
        preparingTargetX: null,
        preparingTargetY: null,
        burnRemainingMs: 0,
        burnTickMs: 0,
        burnSourceSlot: null,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        slowedMs: 0,
        hitStaggerMs: 0,
        opponentUsername: opponent?.username ?? "Opponent",
    };
}

export function buildInitialArenaShapes(matchContext) {
    if (matchContext?.matchId) return buildMatchSpawnShapes(matchContext);
    const shapes = [{ ...MAIN_SHAPE }];
    shapes.push(buildOpponentShape(matchContext?.opponent ?? {
        selectedLoadout: encodeBotLoadout(DEFAULT_BOT_LOADOUT),
        slot: 2,
    }));
    return shapes;
}

export function buildMatchSpawnShapes(matchContext) {
    const playerSlot = Number(matchContext?.player?.slot) === 2 ? 2 : 1;
    const opponentSlot = playerSlot === 1 ? 2 : 1;
    const bots = [
        resetBotShape({
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
        resetBotShape({
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
    return bots;
}

export function cloneShape(shape) {
    return { ...shape };
}

export function cloneShapes(shapes) {
    return shapes.map(cloneShape);
}

export function resetBotShape(shape) {
    const sandbox = String(shape.combatLoadout).startsWith("sandbox:");
    const loadout = sandbox ? decodeSandboxLoadout(shape.combatLoadout) : normalizedBotLoadout(shape.loadout
        ?? (String(shape.combatLoadout).startsWith("custom:") ? decodeBotLoadout(shape.combatLoadout) : DEFAULT_BOT_LOADOUT));
    const abilities = abilitiesForLoadout(loadout);
    const stats = sandbox ? botStatsForSandboxLoadout(loadout) : botStatsForLoadout(loadout);
    return withoutBotStatuses({
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
        abilityActiveMs: {},
        swingCooldownMs: 0,
        blockCooldownMs: 0,
        blockCharges: abilities.includes(2) ? ABILITY_STATS[2].maxCharges : 0,
        blockRechargeMs: 0,
        gunCooldownMs: 0,
        gunAmmo: abilities.includes(3) ? ABILITY_STATS[3].ammoMax : 0,
        gunReloadMs: 0,
        grenadeCooldownMs: 0,
        grenadeSerial: 1,
        thrownGrenade: null,
        fireballCooldownMs: 0,
        fireballCharges: abilities.includes(5) ? ABILITY_STATS[5].maxCharges : 0,
        fireballReloadMs: 0,
        fireballSerial: 1,
        thrownFireball: null,
        stunCooldownMs: 0,
        stunnedMs: 0,
        abilityCooldowns: Object.fromEntries(abilities.map((ability) => [ability, 0])),
        abilityCharges: initialAbilityCharges(abilities),
        preparingAbility: null,
        preparingMs: 0,
        triggeredAbility: null,
        abilityVisual: null,
        burnRemainingMs: 0,
        burnTickMs: 0,
        burnSourceSlot: null,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        slowedMs: 0,
        hitStaggerMs: 0,
        silencedMs: 0,
    });
}

function abilitiesForLoadout(loadout) {
    return [...STANDARD_ABILITY_IDS, ...loadout.abilities];
}

function initialAbilityCharges(abilities) {
    return Object.fromEntries(abilities
        .filter((ability) => [19, 11, 17, 16].includes(ability))
        .map((ability) => [ability, ability === 16 ? 3 : 1]));
}

export function buildAutoPlayStartShapes(currentShapes, matchContext, isMatchTesting) {
    const fallbackShapes = isMatchTesting ? buildMatchSpawnShapes(matchContext) : [];
    const fallbackMain = fallbackShapes.find((shape) => shape.id === "main");
    const nextShapes = cloneShapes(currentShapes);
    if (!nextShapes.some((shape) => shape.id === "main")) {
        nextShapes.unshift(resetBotShape(fallbackMain ?? { ...MAIN_SHAPE }));
    }
    return nextShapes;
}
