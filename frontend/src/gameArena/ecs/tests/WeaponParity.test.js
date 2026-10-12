import assert from "node:assert/strict";
import test from "node:test";
import { abilityHitsTarget } from "../../../../../shared/engine/ecs/abilities/AbilityHitDetectionSystem.js";
import { ABILITY_STATS, abilityDefinition, decodeBotLoadout, encodeBotLoadout } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { EFFECT_TYPES, TARGET_KINDS, activationView } from "../../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { compassDirection } from "../../../../../shared/engine/botlogic/planner/arenaAngles.js";
import { applyBotAction, resolveTriggeredAbilityCombat as resolveAbilityCombat } from "../../testing/pureTicks.js";
import { preparingAbilityId, activeRemainingMs, pendingCooldownMs } from "../../../../../shared/engine/gameconfig/AbilityState.js";

// Mirrors server WeaponParityTest; keep both tables identical.
const TARGET_RADIUS = 30;
const WEAPONS = Object.freeze([
    { id: 1, name: "Slash", shape: "arc", range: 92, arc: 120, damage: 8, windupMs: 0, activeMs: 300, cooldownMs: 500 },
    { id: 35, name: "Thrust", shape: "rectangle", length: 190, width: 30, damage: 10, windupMs: 100, activeMs: 300, cooldownMs: 700 },
    { id: 36, name: "Cleave", shape: "arc", range: 112, arc: 160, damage: 15, windupMs: 500, activeMs: 300, cooldownMs: 700 },
    { id: 37, name: "Smash", shape: "rectangle", length: 125, width: 100, damage: 11, knockback: 120, windupMs: 300, activeMs: 300, cooldownMs: 700 },
]);

const attackerFor = (weapon, extra = {}) => ({
    id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
    abilities: [weapon.id], abilityState: {}, ...extra,
});
const triggered = (weapon, extra) => ({ ...attackerFor(weapon, extra), triggeredAbility: weapon.id });
const defenderAt = (x, y, size = 60) => ({ id: "target", slot: 2, x, y, size, rotation: 270, hp: 150, maxHp: 150 });
const reach = (weapon) => (weapon.shape === "arc" ? weapon.range : weapon.length) + TARGET_RADIUS;
const bearingTarget = (attacker, distance, bearing, size) => {
    const direction = compassDirection(bearing);
    return defenderAt(attacker.x + direction.x * distance, attacker.y + direction.y * distance, size);
};
const hits = (weapon, target) => abilityHitsTarget(triggered(weapon), target);

for (const weapon of WEAPONS) {
    test(`${weapon.name} contract matches the weapon table`, () => {
        const view = activationView(weapon.id);
        const hitbox = view.hitbox;
        assert.equal(hitbox.shape, weapon.shape);
        assert.equal(hitbox.includeTargetRadius, true);
        if (weapon.shape === "arc") {
            assert.equal(hitbox.range, weapon.range);
            assert.equal(hitbox.arc, weapon.arc);
        } else {
            assert.equal(hitbox.length, weapon.length);
            assert.equal(hitbox.width, weapon.width);
        }
        const damage = view.effects.find((effect) => effect.type === EFFECT_TYPES.DAMAGE);
        assert.equal(damage.amount, weapon.damage);
        const knockback = view.effects.find((effect) => effect.type === EFFECT_TYPES.DISPLACE && effect.direction === "away");
        assert.equal(knockback?.distance, weapon.knockback);
        if (knockback) assert.deepEqual([...knockback.targetKinds], [TARGET_KINDS.BOT, TARGET_KINDS.SUMMON]);
        assert.equal(ABILITY_STATS[weapon.id].windupMs ?? 0, weapon.windupMs);
        assert.equal(ABILITY_STATS[weapon.id].activeMs, weapon.activeMs);
        assert.equal(ABILITY_STATS[weapon.id].cooldownMs, weapon.cooldownMs);
        assert.equal(ABILITY_STATS[weapon.id].maxCharges, undefined, "weapons have no ammo");
    });

    test(`${weapon.name} hits just inside and misses just outside effective reach`, () => {
        const attacker = attackerFor(weapon);
        const edge = reach(weapon);
        assert.equal(hits(weapon, defenderAt(attacker.x + edge, attacker.y)), true);
        assert.equal(hits(weapon, defenderAt(attacker.x + edge - 1, attacker.y)), true);
        assert.equal(hits(weapon, defenderAt(attacker.x + edge + 1, attacker.y)), false);
    });

    test(`${weapon.name} side edges follow its ${weapon.shape} geometry`, () => {
        const attacker = attackerFor(weapon);
        if (weapon.shape === "rectangle") {
            const side = weapon.width / 2 + TARGET_RADIUS;
            const forward = attacker.x + weapon.length / 2;
            for (const sign of [-1, 1]) {
                assert.equal(hits(weapon, defenderAt(forward, attacker.y + sign * (side - 1))), true, `inside ${sign}`);
                assert.equal(hits(weapon, defenderAt(forward, attacker.y + sign * (side + 1))), false, `outside ${sign}`);
            }
        } else {
            const half = weapon.arc / 2;
            // A 20-unit target keeps the circle overlap margin under 8 degrees at this distance.
            for (const sign of [-1, 1]) {
                assert.equal(hits(weapon, bearingTarget(attacker, 80, attacker.rotation + sign * half, 20)), true, `at edge ${sign}`);
                assert.equal(hits(weapon, bearingTarget(attacker, 80, attacker.rotation + sign * (half + 12), 20)), false, `outside ${sign}`);
            }
        }
        // Targets behind the bot are never inside any weapon's forward hitbox.
        assert.equal(hits(weapon, defenderAt(attacker.x - reach(weapon), attacker.y)), false);
    });

    test(`${weapon.name} deals its damage and scales with the attack damage multiplier`, () => {
        const target = defenderAt(attackerFor(weapon).x + 60, 100);
        assert.equal(resolveAbilityCombat(triggered(weapon), target)[1].hp, 150 - weapon.damage);
        const boosted = resolveAbilityCombat(triggered(weapon, { attackDamageMultiplier: 2 }), target)[1];
        assert.equal(boosted.hp, 150 - weapon.damage * 2);
        const missed = resolveAbilityCombat(triggered(weapon), defenderAt(100 + reach(weapon) + 1, 100))[1];
        assert.equal(missed.hp, 150);
    });

    test(`${weapon.name} reaches the real executor with its windup, active and cooldown timing`, () => {
        const stepMs = 50;
        let bot = attackerFor(weapon);
        const action = { abilityAction: { action: weapon.id } };
        for (let elapsed = stepMs; elapsed < weapon.windupMs; elapsed += stepMs) {
            bot = applyBotAction(bot, action, stepMs);
            assert.equal(bot.triggeredAbility ?? null, null, `still winding up at ${elapsed} ms`);
            assert.equal(preparingAbilityId(bot), weapon.id);
        }
        bot = applyBotAction(bot, action, stepMs);
        assert.equal(bot.triggeredAbility, weapon.id);
        assert.equal(preparingAbilityId(bot) ?? null, null);
        assert.equal(activeRemainingMs(bot, weapon.id), weapon.activeMs);
        assert.equal(pendingCooldownMs(bot, weapon.id), weapon.cooldownMs);
    });

    test(`${weapon.name} cooldown follows the attack speed multiplier`, () => {
        const bot = applyBotAction(attackerFor(weapon, { attackSpeedMultiplier: 2 }),
            { abilityAction: { action: weapon.id } }, weapon.windupMs || 50);
        assert.equal(bot.triggeredAbility, weapon.id);
        assert.equal(pendingCooldownMs(bot, weapon.id), Math.round(weapon.cooldownMs / 2));
    });
}

test("Smash knocks a bot back 120 units away from the attacker after dealing damage", () => {
    const attacker = triggered(WEAPONS[3]);
    const [, hit] = resolveAbilityCombat(attacker, defenderAt(200, 100));
    assert.equal(hit.hp, 150 - 11);
    assert.equal(hit.x, 320);
    assert.equal(hit.y, 100);
    const [, diagonal] = resolveAbilityCombat(attacker, defenderAt(170, 100 + 40));
    assert.ok(diagonal.x > 170 && diagonal.y > 140, "pushed along the line from the attacker");
});

test("only Smash applies knockback", () => {
    for (const weapon of WEAPONS.filter(({ id }) => id !== 37)) {
        const [, hit] = resolveAbilityCombat(triggered(weapon), defenderAt(160, 100));
        assert.equal(hit.x, 160, weapon.name);
    }
});

test("weapons are category weapon with Weapon: labels and compact codes", () => {
    for (const weapon of WEAPONS) {
        const definition = abilityDefinition(weapon.id);
        assert.equal(definition.category, "weapon");
        assert.equal(definition.actionLabel, `Weapon: ${weapon.name}`);
        assert.equal(definition.catalogueLabel, `Weapon: ${weapon.name}`);
        assert.ok(definition.description.length > 0);
        assert.deepEqual(decodeBotLoadout(encodeBotLoadout({ abilities: [weapon.id] })), { abilities: [weapon.id] });
    }
    assert.equal(encodeBotLoadout({ abilities: [35, 36, 37] }), "custom:xyz");
    assert.equal(abilityDefinition(3).category, "ability");
    assert.equal(abilityDefinition(3).actionLabel, "Ability: Sniper");
});

test("weapons stay out of every ability draft pool: they are the round 1 weapon pick", () => {
    for (const id of [1, 35, 36, 37]) assert.equal(abilityDefinition(id).round, 0);
    for (const id of [1, 35, 36, 37]) assert.equal(abilityDefinition(id).category, "weapon");
});
