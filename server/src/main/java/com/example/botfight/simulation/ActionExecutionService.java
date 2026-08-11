package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.compassRadians;
import static com.example.botfight.simulation.geometry.AngleCalculator.normalizeDegrees;
import static com.example.botfight.simulation.geometry.AngleCalculator.shortestDelta;
import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;
import static com.example.botfight.simulation.geometry.DistanceCalculator.between;
import static com.example.botfight.simulation.geometry.DistanceCalculator.rayIntersectsCircle;

import com.example.botfight.simulation.DuelSimulationService.Action;
import com.example.botfight.simulation.DuelSimulationService.Arena;
import com.example.botfight.simulation.DuelSimulationService.Condition;
import com.example.botfight.simulation.DuelSimulationService.Entity;
import com.example.botfight.simulation.DuelSimulationService.Bot;
import com.example.botfight.simulation.DuelSimulationService.Operand;
import com.example.botfight.simulation.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.DuelSimulationService.Vector;
import com.example.botfight.simulation.ecs.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.ArenaEntity;
import com.example.botfight.simulation.ecs.AbilityEntitySystem;
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts.DeliveryType;
import com.example.botfight.simulation.gameconfig.AbilityContracts.EffectType;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Applies selected movement, ability activation, and immediate ability effects. */
@Service
public class ActionExecutionService {
    private static final int STEP_MS = 100;
    private static final double TURN_SPEED_DEGREES = 12.0;
    private static final int CUSTOM_INTEGER_LIMIT = 99_999;
    private static final Set<Integer> DIRECTIONAL_MELEE_ABILITIES = Set.of(7, 25);

    private final BotStateService botStateService;
    private final ProjectileSimulationService projectileSimulationService;

    public ActionExecutionService(
            BotStateService botStateService,
            ProjectileSimulationService projectileSimulationService) {
        this.botStateService = botStateService;
        this.projectileSimulationService = projectileSimulationService;
    }

    boolean selectedAbilityReady(Bot bot, int ability) {
        if (bot == null) return false;
        if (!hasAbility(bot, ability)) return false;
        var definition = Abilities.definition(ability);
        boolean continuingChannel = definition.activationModel() == Abilities.ActivationModel.CHANNELLED
                && bot.abilityActiveMs.getOrDefault(ability, 0) > 0;
        return (continuingChannel || bot.abilityCooldowns.getOrDefault(ability, 0) <= 0)
                && (continuingChannel || bot.abilityActiveMs.getOrDefault(ability, 0) <= 0)
                && (definition.charges() <= 0 || botStateService.abilityCharges(bot, ability) > 0)
                && !(definition.resourceModel() == Abilities.ResourceModel.RELOAD_WHEN_EMPTY
                        && botStateService.abilityRechargeMs(bot, ability) > 0);
    }

    int selectedAbilityCooldownMs(Bot bot, int ability) {
        if (bot == null) return 0;
        return Math.max(bot.abilityCooldowns.getOrDefault(ability, 0),
                botStateService.abilityRechargeMs(bot, ability));
    }

    int selectedAbilityAmmo(Bot bot, int ability) {
        if (bot == null) return 0;
        return Abilities.definition(ability).charges() > 0
                ? botStateService.abilityCharges(bot, ability) : 0;
    }

    Integer abilityForAction(Object action) {
        return AbilityContracts.abilityForAction(action);
    }

    Integer configuredAbilityAction(StrategyBlock block) {
        return block != null ? abilityForAction(block.action()) : null;
    }

    Action commandLockedAction(Bot bot, Action predicted) {
        if (bot.commandLockedMs <= 0 || bot.commandLockAction == null) return predicted;
        Action locked = bot.commandLockAction;
        return new Action(locked.dx(), locked.dy(), locked.dRot(),
                locked.abilityAction() != null ? locked.abilityAction() : predicted.abilityAction(),
                locked.abilityAction() != null ? locked.abilityTargetX() : predicted.abilityTargetX(),
                locked.abilityAction() != null ? locked.abilityTargetY() : predicted.abilityTargetY(),
                locked.abilityAction() != null ? locked.movementMode() : predicted.movementMode(),
                locked.abilityAction() != null ? locked.movementDirection() : predicted.movementDirection(),
                locked.abilityAction() != null ? locked.phaseFacingMode() : predicted.phaseFacingMode());
    }

    void applyCustomVariableAction(
            Bot bot,
            Bot opponent,
            List<Entity> entities,
            Arena arena,
            ConditionResolutionService conditionResolutionService,
            StrategyBlock block) {
        String id = block.phaseFacingMode();
        String type = bot.customVariableTypes.get(id);
        if (type == null || bot.customVariableConditions.containsKey(id)) return;
        if ("boolean".equals(type)) {
            bot.customVariables.put(id, block.targetOffsetX() != 0);
            return;
        }
        long current = ((Number) bot.customVariables.getOrDefault(id, 0L)).longValue();
        JsonNode terms = block.variableTerms();
        if (terms == null || !terms.isArray() || terms.isEmpty()) {
            long amount = Math.round(block.targetOffsetX());
            long next = switch (block.movementDirection()) {
                case "add" -> current + amount;
                case "subtract" -> current - amount;
                default -> amount;
            };
            bot.customVariables.put(id, Math.max(-CUSTOM_INTEGER_LIMIT, Math.min(CUSTOM_INTEGER_LIMIT, next)));
            return;
        }
        double next = "set".equals(textValue(field(terms.get(0), "operator"), "add")) ? 0 : current;
        Condition context = new Condition("expression", 0, "opponent", null, null, "", null, "", "eq",
                Operand.number(0), null, 0, 0, "and");
        for (JsonNode term : terms) {
            JsonNode operand = field(term, "operand");
            double amount = "variable".equals(textValue(field(operand, "type"), "number"))
                    ? java.util.Optional.ofNullable(conditionResolutionService.resolveStateVariable(
                            textValue(field(operand, "value"), ""),
                            textValue(field(operand, "target"), "opponent"), context,
                            bot, opponent, entities, arena))
                        .map(DuelSimulationService.StateValue::numberValue).orElse(0.0)
                    : numberValue(field(operand, "value"), 0);
            next += "subtract".equals(textValue(field(term, "operator"), "add")) ? -amount : amount;
        }
        bot.customVariables.put(id, (long) Math.max(-CUSTOM_INTEGER_LIMIT,
                Math.min(CUSTOM_INTEGER_LIMIT, next)));
    }

    Vector movementVector(StrategyBlock block, Bot player, Entity target) {
        if (player == null || block == null || !"move_walk".equals(block.action())) {
            return new Vector(0, 0);
        }
        String direction = block.movementDirection() != null ? block.movementDirection() : "toward";
        if ("absolute".equals(block.movementMode())) {
            return switch (direction) {
                case "north" -> new Vector(0.0, -1.0);
                case "south" -> new Vector(0.0, 1.0);
                case "east" -> new Vector(1.0, 0.0);
                case "west" -> new Vector(-1.0, 0.0);
                case "northeast" -> new Vector(Math.sqrt(0.5), -Math.sqrt(0.5));
                case "northwest" -> new Vector(-Math.sqrt(0.5), -Math.sqrt(0.5));
                case "southeast" -> new Vector(Math.sqrt(0.5), Math.sqrt(0.5));
                case "southwest" -> new Vector(-Math.sqrt(0.5), Math.sqrt(0.5));
                default -> new Vector(0, 0);
            };
        }
        if (target == null) return new Vector(0, 0);
        Vector inward = new Vector(target.x() - player.x, target.y() - player.y);
        if (Math.hypot(inward.dx(), inward.dy()) <= 0.001) {
            double facingRadians = compassRadians(player.rotation);
            inward = new Vector(Math.cos(facingRadians), Math.sin(facingRadians));
        }
        Vector outward = new Vector(-inward.dx(), -inward.dy());
        Vector tangentLeft = new Vector(inward.dy(), -inward.dx());
        Vector tangentRight = new Vector(-inward.dy(), inward.dx());
        return switch (direction) {
            case "toward" -> inward;
            case "away" -> outward;
            case "left" -> tangentLeft;
            case "right" -> tangentRight;
            case "toward_left" -> addVectors(inward, tangentLeft);
            case "toward_right" -> addVectors(inward, tangentRight);
            case "away_left" -> addVectors(outward, tangentLeft);
            case "away_right" -> addVectors(outward, tangentRight);
            default -> new Vector(0, 0);
        };
    }

    void execute(Bot bot, Action action, Arena arena) {
        BotStateService.TickState tick = botStateService.beginTick(bot);
        if (!tick.alive()) return;
        boolean rewoundThisTick = tick.rewoundThisTick();
        boolean slowedWasActive = tick.slowedWasActive();
        boolean hitStaggerWasActive = tick.hitStaggerWasActive();
        if (bot.stunnedMs > 0) {
            if (tick.channelledAbility() != null) {
                botStateService.setAbilityReuseCooldown(bot, tick.channelledAbility());
            }
            cancelPreparation(bot);
            bot.microDashActiveMs = 0;
            bot.microDashRemaining = 0;
            bot.movementVelocityX = 0.0;
            bot.movementVelocityY = 0.0;
            bot.velocityX = 0.0;
            bot.velocityY = 0.0;
            return;
        }
        if (bot.preparingAbility != null && bot.silencedMs <= 0 && !bot.nullZoneSilenced) {
            action = new Action(action.dx(), action.dy(), action.dRot(), bot.preparingAbility,
                    bot.preparingTargetX, bot.preparingTargetY, null, null, null);
        }
        double actionMagnitude = Math.hypot(action.dx(), action.dy());
        boolean isContinuingMicroDash = bot.microDashActiveMs > 0 && bot.microDashRemaining > 0;
        double rotationMultiplier = hitStaggerWasActive ? HitStagger.ROTATION_MULTIPLIER : 1.0;
        bot.rotation = normalizeDegrees(bot.rotation
                + clamp(action.dRot(), -1, 1) * TURN_SPEED_DEGREES * rotationMultiplier);
        double movementSpeedMultiplier = slowedWasActive ? HitStagger.CONCUSSIVE_MOVEMENT_MULTIPLIER
                : hitStaggerWasActive ? HitStagger.MOVEMENT_MULTIPLIER : 1.0;
        if (rewoundThisTick) {
            clearMovement(bot);
        } else if (bot.movementLockMs > 0) {
            bot.microDashActiveMs = 0;
            bot.microDashRemaining = 0;
            bot.movementVelocityX = 0;
            bot.movementVelocityY = 0;
        } else if (isContinuingMicroDash) {
            double stepDistance = Math.min(bot.microDashStepDistance > 0 ? bot.microDashStepDistance : 75,
                    bot.microDashRemaining);
            double beforeX = bot.x, beforeY = bot.y;
            moveBot(bot, bot.microDashDirectionX, bot.microDashDirectionY, stepDistance, arena);
            double traveled = Math.hypot(bot.x - beforeX, bot.y - beforeY);
            bot.microDashRemaining = Math.max(0, bot.microDashRemaining - traveled);
            bot.movementVelocityX = bot.microDashDirectionX * bot.moveSpeed * movementSpeedMultiplier;
            bot.movementVelocityY = bot.microDashDirectionY * bot.moveSpeed * movementSpeedMultiplier;
            if (traveled <= 0 || bot.microDashRemaining <= 0) bot.microDashActiveMs = 0;
        }
        if (!rewoundThisTick && !isContinuingMicroDash && bot.movementLockMs <= 0) {
            Vector movementVelocity = nextMovementVelocity(
                    bot, action, actionMagnitude, bot.moveSpeed * movementSpeedMultiplier);
            bot.movementVelocityX = movementVelocity.dx();
            bot.movementVelocityY = movementVelocity.dy();
            moveBotByVelocity(bot, movementVelocity.dx(), movementVelocity.dy(), arena);
        }

        Integer abilityAction = action.abilityAction();
        Integer abilityId = abilityForAction(abilityAction);
        boolean channelledActive = abilityId != null
                && Abilities.definition(abilityId).activationModel() == Abilities.ActivationModel.CHANNELLED
                && selectedAbilityReady(bot, abilityId);
        if (tick.channelledAbility() != null && !tick.channelledAbility().equals(abilityId)) {
            botStateService.setAbilityReuseCooldown(bot, tick.channelledAbility());
        }
        if (channelledActive) {
            bot.triggeredAbility = abilityId;
            bot.abilityActiveMs.put(abilityId, STEP_MS);
        }
        if (!channelledActive && abilityAction != null
                && activateImmediateAbility(bot, abilityAction)) {
            bot.triggeredAbility = abilityId;
            bot.abilityTargetX = action.abilityTargetX();
            bot.abilityTargetY = action.abilityTargetY();
        }
        if (!channelledActive && bot.silencedMs <= 0 && !bot.nullZoneSilenced
                && abilityAction != null && AbilityContracts.containsAction(abilityAction)
                && !isImmediateAbility(abilityAction)) {
            activateConfiguredAbility(bot, abilityAction, action, arena);
        } else if (bot.preparingAbility != null
                && (bot.silencedMs > 0 || bot.nullZoneSilenced || bot.stunnedMs > 0)) {
            cancelPreparation(bot);
        }
    }

    void resolveImmediateAbilities(List<Bot> bots) {
        Bot first = bots.get(0);
        Bot second = bots.get(1);
        Abilities.CATALOG.entrySet().stream()
                .filter(entry -> entry.getValue().activationModel() == Abilities.ActivationModel.IMMEDIATE)
                .filter(entry -> Set.of(DeliveryType.MELEE, DeliveryType.RAY)
                        .contains(delivery(entry.getKey())))
                .map(java.util.Map.Entry::getKey)
                .forEach(ability -> {
                    resolveImmediateAbility(first, second, ability);
                    resolveImmediateAbility(second, first, ability);
                });
    }

    void resolveTriggeredAbilities(Bot attacker, Bot defender, Arena arena) {
        Integer ability = attacker.triggeredAbility;
        if (ability == null || defender.hp <= 0) return;
        if (ability == 18 || ability == 20) return;
        double dx = defender.x - attacker.x, dy = defender.y - attacker.y;
        double distance = Math.hypot(dx, dy);
        double bearing = vectorBearing(dx, dy);
        double facing = Math.abs(shortestDelta(attacker.rotation, bearing));
        int damage = switch (ability) {
            case 12 -> Abilities.damageAtDistance(12, distance);
            default -> (int) Math.round(contractEffectAmount(ability, EffectType.DAMAGE));
        };
        double range = Abilities.range(ability);
        boolean direct = delivery(ability) == DeliveryType.RAY
                ? rayIntersectsBot(attacker, defender, range)
                : distance <= range + (ability == 7 ? defender.size / 2.0 : 0)
                    && (DIRECTIONAL_MELEE_ABILITIES.contains(ability)
                            ? facing <= Abilities.arcDegrees(ability) / 2.0
                            : delivery(ability) == DeliveryType.RADIAL || facing <= 28);
        boolean effectiveDirect = direct && !defender.ignoresHostileEffects();
        AbilityEntitySystem.ShieldResult shield = effectiveDirect
                ? botStateService.resolveShield(defender, attacker.x, attacker.y, ability)
                : AbilityEntitySystem.ShieldResult.none();
        if (effectiveDirect && damage > 0) {
            if (!shield.prevents(EffectType.DAMAGE)) {
                botStateService.applyDamageFrom(attacker, defender,
                        (int) Math.round(damage * botStateService.damageMultiplier(attacker)));
            }
            if (ability == 7 && defender.hp > 0 && !shield.prevents(EffectType.DEBUFF)) {
                boolean alreadyBleeding = defender.bleedRemainingMs > 0;
                defender.bleedRemainingMs = AbilityContracts.effectDurationMs(7, "bleed");
                if (!alreadyBleeding) defender.bleedTickMs = (int) Abilities.stat(7, "bleedTickMs", 1_000);
                defender.bleedSourceSlot = attacker.slot;
            }
        }
        if (ability == 13 && effectiveDirect && defender.hp > 0
                && !shield.prevents(EffectType.DEBUFF)) {
            defender.shockRemainingMs = AbilityContracts.effectDurationMs(13, "shock");
            defender.shockTickElapsedMs = 0;
            defender.shockSourceSlot = attacker.slot;
        }
        if (ability == 10) {
            attacker.pendingHealing += (int) Math.round(contractEffectAmount(ability, EffectType.HEALING));
        }
        if (ability == 9 && effectiveDirect && defender.hp > 0
                && !shield.prevents(EffectType.DEBUFF)) {
            defender.slowedMs = Math.max(defender.slowedMs,
                    AbilityContracts.effectDurationMs(9, "slow"));
        }
        if (ability == 8 && effectiveDirect && distance > 0) {
            moveBot(defender, dx / distance, dy / distance,
                    contractEffectAmount(ability, EffectType.KNOCKBACK), arena);
        }
        if (ability == 21) {
            attacker.temporalRewindX = attacker.x;
            attacker.temporalRewindY = attacker.y;
            attacker.temporalRewindHp = attacker.hp;
            attacker.temporalRewindMs = (int) Abilities.stat(21, "delayMs", 3_000);
            attacker.temporalRewindPulseMs = 0;
        }
        if (ability == 25 && effectiveDirect) {
            if (!shield.prevents(EffectType.TELEPORT)) {
                double originalRotation = attacker.rotation;
                double passThroughDistance = Abilities.stat(25, "passThroughDistance", 50);
                attacker.x = clamp(defender.x + dx / Math.max(1, distance) * passThroughDistance,
                        attacker.size / 2.0, arena.width() - attacker.size / 2.0);
                attacker.y = clamp(defender.y + dy / Math.max(1, distance) * passThroughDistance,
                        attacker.size / 2.0, arena.height() - attacker.size / 2.0);
                if (!"keep".equals(attacker.triggeredPhaseFacingMode)) {
                    attacker.rotation = "mirror".equals(attacker.triggeredPhaseFacingMode)
                            ? normalizeDegrees(2 * bearing - originalRotation)
                            : normalizeDegrees(bearing + 180);
                }
            }
            if (shield.prevents(EffectType.DAMAGE)) return;
        }
        if (ability == 19 && attacker.microDashActiveMs <= 0) {
            startMicroDash(attacker, attacker.triggeredMovementMode, attacker.triggeredMovementDirection,
                    attacker.abilityTargetX, attacker.abilityTargetY, arena);
        }
    }

    int damageToDroneThisTick(ArenaEntity drone, List<Bot> bots,
                              List<ArenaEntity> projectileEffects, List<ArenaEntity> projectiles,
                              List<ArenaEntity> placements) {
        int damage = 0;
        for (Bot bot : bots) {
            double distance = Math.hypot(drone.x() - bot.x, drone.y() - bot.y);
            Integer ability = abilityForAction(bot.triggeredAbility);
            double range = ability == null ? 0 : Abilities.range(ability);
            int abilityDamage = ability == null ? 0 : Abilities.definition(ability).damageFalloff().isEmpty()
                    ? (int) Math.round(contractEffectAmount(ability, EffectType.DAMAGE))
                    : Abilities.damageAtDistance(ability, distance);
            boolean rayHit = delivery(ability) == DeliveryType.RAY
                    && rayIntersectsCircle(bot.x, bot.y, Math.cos(compassRadians(bot.rotation)),
                    Math.sin(compassRadians(bot.rotation)), range, drone.x(), drone.y(), drone.size() / 2.0);
            boolean areaHit = abilityAreaHits(bot, drone.x(), drone.y(), drone.size(), ability, range);
            if (rayHit || areaHit) damage += abilityDamage;
        }
        for (ArenaEntity projectile : projectiles) {
            if (overlaps(projectile, drone)) {
                damage += (int) Math.round(AbilityContracts.effectAmount(projectile.abilityId(), EffectType.DAMAGE)
                        * projectile.damageMultiplier());
            }
        }
        for (ArenaEntity effect : projectileEffects) {
            damage += projectileSimulationService.radialDamageToEntity(effect, drone);
        }
        for (ArenaEntity effect : placements) {
            double distance = Math.hypot(effect.x() - drone.x(), effect.y() - drone.y());
            if ("mineExplosion".equals(effect.type()) && distance <= effect.size() / 2.0) damage += (int) Math.round(contractEffectAmount(11, EffectType.DAMAGE));
            if ("gravityExplosion".equals(effect.type()) && distance <= effect.size() / 2.0) damage += Abilities.damageAtDistance(14, distance);
            if ("orbitalExplosion".equals(effect.type()) && distance <= effect.size() / 2.0) {
                damage += Abilities.damageAtDistance(22, distance);
            }
        }
        return damage;
    }

    boolean mineHitByCurrentAttack(ArenaEntity mine, List<Bot> bots,
                                   List<ArenaEntity> projectiles, List<ArenaEntity> placements) {
        if (projectiles.stream().anyMatch(entity -> overlaps(entity, mine))) return true;
        if (placements.stream().anyMatch(entity -> entity != mine
                && ("silenceWave".equals(entity.type()) || "windburstProjectile".equals(entity.type()))
                && overlaps(entity, mine))) return true;
        for (Bot bot : bots) {
            Integer ability = abilityForAction(bot.triggeredAbility);
            double range = delivery(ability) == DeliveryType.RAY ? Abilities.range(ability) : 0;
            if (range > 0 && rayIntersectsCircle(bot.x, bot.y, Math.cos(compassRadians(bot.rotation)),
                    Math.sin(compassRadians(bot.rotation)), range, mine.x(), mine.y(), mine.size() / 2.0)) return true;
            double meleeRange = ability == null ? 0 : Abilities.range(ability);
            if (meleeRange > 0 && abilityAreaHits(bot, mine.x(), mine.y(), mine.size(), ability, meleeRange)) return true;
        }
        return false;
    }

    private void resolveImmediateAbility(Bot attacker, Bot defender, int ability) {
        if (attacker.triggeredAbility == null || ability != attacker.triggeredAbility || !hasAbility(attacker, ability)) return;
        double distance = between(attacker.x, attacker.y, defender.x, defender.y);
        boolean hit = delivery(ability) == DeliveryType.RAY
                ? rayIntersectsBot(attacker, defender, Abilities.range(ability))
                : distance <= Abilities.range(ability) + defender.size / 2.0
                        && Math.abs(shortestDelta(attacker.rotation,
                                vectorBearing(defender.x - attacker.x, defender.y - attacker.y)))
                                <= Abilities.arcDegrees(ability) / 2.0;
        if (!hit) return;
        AbilityEntitySystem.ShieldResult shield = botStateService.resolveShield(
                defender, attacker.x, attacker.y, ability);
        if (!shield.prevents(EffectType.DAMAGE)) {
            int baseDamage = Abilities.definition(ability).damageFalloff().isEmpty()
                    ? (int) Math.round(contractEffectAmount(ability, EffectType.DAMAGE))
                    : Abilities.damageAtDistance(ability, distance);
            int damage = (int) Math.round(baseDamage * botStateService.damageMultiplier(attacker));
            botStateService.applyDamageFrom(attacker, defender, damage);
        }
        if (!shield.prevents(EffectType.DEBUFF)
                && AbilityContracts.get(ability).effects().stream()
                        .anyMatch(effect -> effect.type() == EffectType.DEBUFF && "stun".equals(effect.subtype()))) {
            defender.applyStun(AbilityContracts.effectDurationMs(ability, "stun"));
            defender.movementVelocityX = 0;
            defender.movementVelocityY = 0;
            defender.velocityX = 0;
            defender.velocityY = 0;
        }
    }

    private boolean activateImmediateAbility(Bot bot, int action) {
        Integer ability = abilityForAction(action);
        if (ability == null || !Abilities.isImmediateActivation(ability) || !selectedAbilityReady(bot, ability)) return false;
        var definition = Abilities.definition(ability);
        double cooldownMultiplier = 1.0 / bot.attackSpeedMultiplier;
        if (definition.charges() > 0 && !botStateService.consumeAbilityCharge(bot, ability)) {
            return false;
        }
        int cooldownMs = (int) Math.round(definition.cooldownMs() * cooldownMultiplier);
        bot.abilityCooldowns.put(ability, cooldownMs);
        int activeMs = definition.activeMs() > 0 ? definition.activeMs()
                : definition.windupMs() > 0 ? definition.windupMs() : STEP_MS;
        bot.abilityActiveMs.put(ability, activeMs);
        if (delivery(ability) == DeliveryType.PROJECTILE) {
            bot.abilitySpawn = projectileSimulationService.createProjectile(
                    ability, bot, bot.abilityEntitySerial++);
        }
        return true;
    }

    private void activateConfiguredAbility(Bot bot, int action, Action selectedAction, Arena arena) {
        Integer ability = abilityForAction(action);
        if (ability == null) return;
        if (!selectedAbilityReady(bot, ability)) return;
        int windup = Abilities.windupMs(ability);
        if (windup > 0) {
            boolean continuingPreparation = ability.equals(bot.preparingAbility);
            bot.preparingMs = continuingPreparation ? bot.preparingMs + STEP_MS : STEP_MS;
            if (!continuingPreparation) {
                bot.preparingTargetX = selectedAction.abilityTargetX();
                bot.preparingTargetY = selectedAction.abilityTargetY();
            }
            bot.preparingAbility = ability;
            if (bot.preparingMs < windup) return;
        }
        bot.triggeredAbility = ability;
        bot.triggeredMovementMode = selectedAction.movementMode();
        bot.triggeredMovementDirection = selectedAction.movementDirection();
        bot.triggeredPhaseFacingMode = selectedAction.phaseFacingMode();
        bot.abilityTargetX = selectedAction.abilityTargetX();
        bot.abilityTargetY = selectedAction.abilityTargetY();
        cancelPreparation(bot);
        bot.abilityCooldowns.put(ability, (int) Math.round(Abilities.cooldownMs(ability) / bot.attackSpeedMultiplier));
        bot.abilityActiveMs.put(ability, Abilities.durationMs(ability));
        if (Abilities.definition(ability).charges() > 0) botStateService.consumeAbilityCharge(bot, ability);
        if (ability == 19) startMicroDash(bot, selectedAction.movementMode(), selectedAction.movementDirection(),
                selectedAction.abilityTargetX(), selectedAction.abilityTargetY(), arena);
        if (ability == 20 && Double.isFinite(selectedAction.abilityTargetX())
                && Double.isFinite(selectedAction.abilityTargetY())) {
            bot.rotation = vectorBearing(selectedAction.abilityTargetX() - bot.x,
                    selectedAction.abilityTargetY() - bot.y);
        }
        if (ability == 11) {
            bot.abilitySpawn = AbilityEntityFactory.proximityMine(
                    "mine-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot,
                    bot.x, bot.y, bot.rotation);
        } else if (ability == 15) {
            bot.abilitySpawn = AbilityEntityFactory.silenceWave(
                    "silence-wave-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot,
                    bot.x, bot.y, bot.rotation);
        } else if (ability == 14) {
            bot.abilitySpawn = AbilityEntityFactory.gravityField(
                    "gravity-field-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot,
                    bot.x, bot.y, bot.rotation);
        } else if (ability == 24) {
            bot.abilitySpawn = AbilityEntityFactory.nullZone(
                    "null-zone-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot,
                    clamp(selectedAction.abilityTargetX(), Abilities.stat(24, "radius", 150),
                            arena.width() - Abilities.stat(24, "radius", 150)),
                    clamp(selectedAction.abilityTargetY(), Abilities.stat(24, "radius", 150),
                            arena.height() - Abilities.stat(24, "radius", 150)));
        } else if (ability == 17) {
            bot.abilitySpawn = AbilityEntityFactory.hunterDrone(
                    "hunter-drone-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot,
                    bot.x, bot.y, bot.rotation);
        } else if (ability == 22) {
            bot.abilitySpawn = AbilityEntityFactory.orbitalMarker(
                    "orbital-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot,
                    selectedAction.abilityTargetX(), selectedAction.abilityTargetY());
        } else if (ability == 21) {
            bot.abilitySpawn = AbilityEntityFactory.temporalRewindZone(
                    "rewind-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot, bot.x, bot.y);
        } else if (ability == 18) {
            bot.abilitySpawn = AbilityEntityFactory.windburst(
                    "windburst-" + bot.userId + "-" + bot.abilityEntitySerial++, bot.slot, bot.x, bot.y,
                    bot.rotation, bot.size, bot.attackDamageMultiplier);
        }
    }

    private static void cancelPreparation(Bot bot) {
        bot.preparingAbility = null;
        bot.preparingMs = 0;
        bot.preparingTargetX = Double.NaN;
        bot.preparingTargetY = Double.NaN;
    }

    private static boolean hasAbility(Bot bot, int ability) {
        return bot.abilities.contains(ability);
    }

    private static boolean isImmediateAbility(int action) {
        Integer ability = AbilityContracts.abilityForAction(action);
        return ability != null && Abilities.isImmediateActivation(ability);
    }

    private static boolean rayIntersectsBot(Bot attacker, Bot defender, double range) {
        if (attacker == null || defender == null || !Double.isFinite(range) || range <= 0) return false;
        double radians = compassRadians(attacker.rotation);
        double directionX = Math.cos(radians), directionY = Math.sin(radians);
        double offsetX = defender.x - attacker.x, offsetY = defender.y - attacker.y;
        double projection = offsetX * directionX + offsetY * directionY;
        double radius = defender.size / 2.0;
        double perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
        if (projection < -radius || perpendicularSquared > radius * radius) return false;
        double entryDistance = projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared));
        return Math.max(0, entryDistance) <= range;
    }

    private void startMicroDash(Bot bot, String movementMode, String movementDirection,
            double targetX, double targetY, Arena arena) {
        double angle = Double.isFinite(targetX) && Double.isFinite(targetY)
                ? Math.atan2(targetY - bot.y, targetX - bot.x) : compassRadians(bot.rotation);
        Vector direction = dashDirection(movementMode, movementDirection, angle, targetX - bot.x, targetY - bot.y);
        double beforeX = bot.x, beforeY = bot.y;
        double stepDistance = Abilities.stat(19, "stepDistance", 75);
        double dashDistance = Abilities.stat(19, "distance", 150);
        moveBot(bot, direction.dx(), direction.dy(), stepDistance, arena);
        bot.microDashDirectionX = direction.dx();
        bot.microDashDirectionY = direction.dy();
        bot.microDashRemaining = Math.max(0, dashDistance - Math.hypot(bot.x - beforeX, bot.y - beforeY));
        bot.microDashStepDistance = stepDistance;
        bot.microDashActiveMs = (int) Abilities.stat(19, "activeMs", 200);
    }

    private static Vector dashDirection(String movementMode, String movementDirection,
            double angle, double movementDx, double movementDy) {
        double distance = Math.max(1, Math.hypot(movementDx, movementDy));
        String direction = movementDirection != null ? movementDirection : "toward";
        if ("absolute".equals(movementMode)) return switch (direction) {
            case "north" -> new Vector(0, -1);
            case "south" -> new Vector(0, 1);
            case "east" -> new Vector(1, 0);
            case "west" -> new Vector(-1, 0);
            case "northeast" -> new Vector(Math.sqrt(0.5), -Math.sqrt(0.5));
            case "northwest" -> new Vector(-Math.sqrt(0.5), -Math.sqrt(0.5));
            case "southeast" -> new Vector(Math.sqrt(0.5), Math.sqrt(0.5));
            case "southwest" -> new Vector(-Math.sqrt(0.5), Math.sqrt(0.5));
            default -> new Vector(0, 0);
        };
        if (direction.endsWith("_left") || direction.endsWith("_right")) {
            double radial = direction.startsWith("away") ? -1 : 1;
            double side = direction.endsWith("right") ? 1 : -1;
            return new Vector((Math.cos(angle) * radial - Math.sin(angle) * side) * Math.sqrt(0.5),
                    (Math.sin(angle) * radial + Math.cos(angle) * side) * Math.sqrt(0.5));
        }
        if ("away".equals(direction)) return new Vector(-Math.cos(angle), -Math.sin(angle));
        if ("left".equals(direction) || "right".equals(direction)) {
            double side = "right".equals(direction) ? 1 : -1;
            return new Vector(-Math.sin(angle) * side, Math.cos(angle) * side);
        }
        return new Vector(movementDx / distance, movementDy / distance);
    }

    private static double contractEffectAmount(int abilityId, EffectType type) {
        return AbilityContracts.effectAmount(abilityId, type);
    }

    private static DeliveryType delivery(int abilityId) {
        return AbilityContracts.get(abilityId).delivery();
    }

    private static boolean abilityAreaHits(Bot attacker, double targetX, double targetY,
                                             double targetSize, int ability, double range) {
        if (delivery(ability) != DeliveryType.RADIAL
                && !DIRECTIONAL_MELEE_ABILITIES.contains(ability)) return false;
        double dx = targetX - attacker.x, dy = targetY - attacker.y;
        if (Math.hypot(dx, dy) > range + (ability == 25 ? 0 : targetSize / 2.0)) return false;
        if (!DIRECTIONAL_MELEE_ABILITIES.contains(ability)) return true;
        return Math.abs(shortestDelta(attacker.rotation, vectorBearing(dx, dy))) <= Abilities.arcDegrees(ability) / 2.0;
    }

    private static boolean overlaps(Entity first, Entity second) {
        return Math.hypot(first.x() - second.x(), first.y() - second.y())
                <= first.size() / 2.0 + second.size() / 2.0;
    }

    private static boolean overlaps(Entity first, ArenaEntity second) {
        return Math.hypot(first.x() - second.x(), first.y() - second.y())
                <= first.size() / 2.0 + second.size() / 2.0;
    }

    private static boolean overlaps(ArenaEntity first, ArenaEntity second) {
        return Math.hypot(first.x() - second.x(), first.y() - second.y())
                <= first.size() / 2.0 + second.size() / 2.0;
    }

    private static void clearMovement(Bot bot) {
        bot.microDashActiveMs = 0;
        bot.microDashRemaining = 0;
        bot.movementVelocityX = 0;
        bot.movementVelocityY = 0;
        bot.velocityX = 0;
        bot.velocityY = 0;
    }

    private static void moveBot(Bot bot, double dx, double dy, double distance, Arena arena) {
        double magnitude = Math.hypot(dx, dy);
        if (magnitude <= 0.0001 || distance <= 0) return;
        double radius = bot.size / 2.0;
        bot.x = clamp(bot.x + dx / magnitude * distance, radius, arena.width() - radius);
        bot.y = clamp(bot.y + dy / magnitude * distance, radius, arena.height() - radius);
        bot.velocityX = dx / magnitude * distance / (STEP_MS / 1000.0);
        bot.velocityY = dy / magnitude * distance / (STEP_MS / 1000.0);
    }

    private static Vector nextMovementVelocity(Bot bot, Action action, double magnitude, double maxSpeed) {
        double acceleration = Math.max(0.0, maxSpeed * 0.5);
        Vector desired = magnitude > 0.001
                ? new Vector(action.dx() / magnitude * maxSpeed, action.dy() / magnitude * maxSpeed)
                : new Vector(0, 0);
        return steerVelocity(new Vector(bot.movementVelocityX, bot.movementVelocityY), desired, acceleration, maxSpeed);
    }

    private static Vector steerVelocity(Vector current, Vector target, double maxDelta, double maxSpeed) {
        double deltaX = target.dx() - current.dx(), deltaY = target.dy() - current.dy();
        double distance = Math.hypot(deltaX, deltaY);
        if (distance > maxDelta && distance > 0) {
            deltaX = deltaX / distance * maxDelta;
            deltaY = deltaY / distance * maxDelta;
        }
        return clampVelocity(new Vector(current.dx() + deltaX, current.dy() + deltaY), maxSpeed);
    }

    private static Vector clampVelocity(Vector velocity, double maxSpeed) {
        double speed = Math.hypot(velocity.dx(), velocity.dy());
        return speed > maxSpeed && speed > 0
                ? new Vector(velocity.dx() / speed * maxSpeed, velocity.dy() / speed * maxSpeed) : velocity;
    }

    private static void moveBotByVelocity(Bot bot, double velocityX, double velocityY, Arena arena) {
        double radius = bot.size / 2.0;
        bot.x = clamp(bot.x + velocityX, radius, arena.width() - radius);
        bot.y = clamp(bot.y + velocityY, radius, arena.height() - radius);
        bot.velocityX = velocityX / (STEP_MS / 1000.0);
        bot.velocityY = velocityY / (STEP_MS / 1000.0);
    }

    private static Vector addVectors(Vector first, Vector second) {
        return new Vector(first.dx() + second.dx(), first.dy() + second.dy());
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static JsonNode field(JsonNode node, String name) {
        return node != null && node.isObject() ? node.get(name) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber() ? node.asDouble() : fallback;
    }
}
