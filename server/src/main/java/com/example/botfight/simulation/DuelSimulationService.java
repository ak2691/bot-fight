package com.example.botfight.simulation;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.simulation.combat.CombatCatalog;
import com.example.botfight.simulation.combat.CombatRules;
import com.example.botfight.simulation.combat.AbilityContracts;
import com.example.botfight.simulation.combat.AbilityContracts.EffectType;
import com.example.botfight.simulation.combat.AbilityContracts.ShieldMode;
import com.example.botfight.simulation.ecs.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.AbilityEntityCombatant;
import com.example.botfight.simulation.ecs.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.ArenaBounds;
import com.example.botfight.simulation.ecs.ArenaEntity;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class DuelSimulationService {
    private static final Set<String> PROTOTYPE_ACTIONS = Set.of("heavy_slash", "repulsor_burst", "concussive_shot", "repair_pulse", "proximity_mine", "quick_jab", "pistol_shot", "rail_shot", "gravity_grenade", "silence_pulse", "reactive_armor", "hunter_drone", "thrust", "micro_dash", "micro_dash_outward", "micro_dash_left", "micro_dash_right", "micro_dash_toward_left", "micro_dash_toward_right", "micro_dash_away_left", "micro_dash_away_right", "micro_dash_north", "micro_dash_south", "micro_dash_east", "micro_dash_west", "micro_dash_northeast", "micro_dash_northwest", "micro_dash_southeast", "micro_dash_southwest", "temporal_rewind", "orbital_strike", "absolute_guard", "null_zone", "phase_strike", "phase_strike_keep_facing", "phase_strike_face_origin", "phase_strike_mirror_facing");
    private static final Map<String, Integer> PROTOTYPE_COOLDOWNS = Map.ofEntries(Map.entry("heavy_slash", 5000), Map.entry("repulsor_burst", 8000), Map.entry("concussive_shot", 7000), Map.entry("repair_pulse", 12000), Map.entry("proximity_mine", 10000), Map.entry("quick_jab", 450), Map.entry("pistol_shot", 700), Map.entry("rail_shot", 11000), Map.entry("gravity_grenade", 13000), Map.entry("silence_pulse", 12000), Map.entry("reactive_armor", 13000), Map.entry("hunter_drone", 14000), Map.entry("thrust", 1000), Map.entry("micro_dash", 1500), Map.entry("temporal_rewind", 18000), Map.entry("orbital_strike", 18000), Map.entry("absolute_guard", 17000), Map.entry("null_zone", 18000), Map.entry("phase_strike", 1800));
    private static final String BOUNCY_WALL_TYPE = "bouncyWall";
    private static final int INHIBITION_SLOW_MS = 3_000;
    public static final String DUEL_RULESET_VERSION = "duel-v1";

    private static final int ARENA_WIDTH_UNITS = ArenaUnits.WIDTH;
    private static final int ARENA_HEIGHT_UNITS = ArenaUnits.HEIGHT;
    private static final int STEP_MS = 100;
    private static final int CORE_HP = 250;
    private static final int CORE_SIZE = 120;
    private static final String DEFENSE_WALL_TYPE = "defenseWall";
    private static final String WALL_CORE_TYPE = "wallCore";
    private static final int WALL_CORE_HP = 100;
    private static final int WALL_CORE_SIZE = 72;
    private static final double MOVE_ACCELERATION_PER_TICK = 4.0;
    private static final double MOVE_BRAKE_ACCELERATION_PER_TICK = 8.0;
    private static final double TURN_SPEED_DEGREES = 18.0;
    private static final int HEALTH_PACK_SIZE = 42;
    private static final int HEALTH_PACK_HEAL = 50;
    private static final String VANGUARD_BEACON_TYPE = "vanguardBeacon";
    private static final String ASSAULT_BOOST_TYPE = "assaultBoost";
    private static final String TEMPO_BOOST_TYPE = "tempoBoost";
    private static final String MOBILITY_BOOST_TYPE = "mobilityBoost";
    private static final int BUFF_PICKUP_SIZE = 76;
    private static final int CENTER_OBJECTIVE_SIZE = 92;
    private static final int CENTER_OBJECTIVE_CAPTURE_MS = 5_000;
    private static final int VANGUARD_DURATION_MS = 12_000;
    private static final int VANGUARD_COOLDOWN_MS = 10_000;
    private static final int BOOST_HP = 120;
    private static final int BOOST_RESPAWN_MS = 20_000;
    private static final int HEALTH_PACK_RESPAWN_MS = 15_000;
    private static final int HEALTH_PACK_MAX_CLAIMS = 2;
    private static final double PROJECTILE_WALL_HEAL_RANGE = 75.0;
    private static final int PROJECTILE_WALL_HEAL_PER_SECOND = 3;
    private static final int DAMAGE_ZONE_SIZE = 128;
    private static final String PROJECTILE_WALL_TYPE = "projectileWall";
    private static final int PROJECTILE_WALL_LENGTH = 120;
    private static final double PROJECTILE_WALL_THICKNESS = 8.0;
    private static final int DAMAGE_ZONE_ENTRY_DAMAGE = 25;
    private static final double DAMAGE_ZONE_DAMAGE_MULTIPLIER = 1.5;
    private static final int ATTACK_COOLDOWN_MS = 1000;
    private static final int ATTACK_ACTIVE_MS = 400;
    private static final int BLOCK_REUSE_COOLDOWN_MS = 2000;
    private static final int GRENADE_SIZE = 12;
    private static final double GRENADE_THROW_SPEED = 32.0;
    private static final double GRENADE_DECELERATION_PER_TICK = 1.6;
    private static final int GRENADE_STOP_FUSE_MS = 1_000;
    private static final int GRENADE_EXPLOSION_RADIUS = 50;
    private static final int GRENADE_EXPLOSION_VISIBLE_MS = 200;
    private static final int FIREBALL_SIZE = 30;
    private static final double FIREBALL_SPEED = 36.0;
    private static final int DASH_DURATION_MS = 1000;
    // Ten 100 ms movement steps over the one-second dash produce 400 arena units.
    private static final double DASH_SPEED = 40.0;
    private static final int MAX_PLAYER_OBJECT_SLOTS = 6;
    private static final int CENTER_OBJECT_COUNT = 1;
    private static final int MAX_ARENA_OBJECTS = CENTER_OBJECT_COUNT + MAX_PLAYER_OBJECT_SLOTS;
    private static final int MAX_LOGIC_BLOCKS = 100;
    private static final int MAX_TOTAL_CONDITIONS = 300;
    private static final int CUSTOM_INTEGER_LIMIT = 99_999;
    private static final int MAX_CLUSTERS = 100;
    private static final int MAX_CONDITIONS_PER_BLOCK = MAX_TOTAL_CONDITIONS;
    private static final int MIN_PRIORITY = 1;
    private static final int MAX_PRIORITY = 10;
    private static final Pattern OBJECT_TARGET = Pattern.compile("(?:(?:p[12]_)?object_([1-6])|object_(?:center|buff_[12])|wall_core_[1-3])");

    private final CombatCatalog combatCatalog;

    public DuelSimulationService(CombatCatalog combatCatalog) {
        this.combatCatalog = combatCatalog;
    }

    public List<MatchPlaybackDTO.ObstaclePlacementDTO> createMatchObstaclePlacements(
            long seed,
            int arenaWidth,
            int arenaHeight,
            List<DuelFighterRequest> fighterRequests) {
        return List.of();
    }

    public MatchPlaybackDTO simulate(DuelSimulationRequest request) {
        if (request == null || !DUEL_RULESET_VERSION.equals(request.rulesetVersion())) {
            throw new IllegalArgumentException("rulesetVersion must be duel-v1");
        }
        if (request.fighters() == null || request.fighters().size() != 2) {
            throw new IllegalArgumentException("duel-v1 requires exactly two fighters");
        }

        Arena arena = new Arena(
                request.arena() != null ? request.arena().width() : ARENA_WIDTH_UNITS,
                request.arena() != null ? request.arena().height() : ARENA_HEIGHT_UNITS,
                request.arena() != null ? request.arena().durationMs() : 60_000);

        List<Fighter> fighters = request.fighters().stream()
                .map(this::fighterFromRequest)
                .toList();
        // duel-v1 arenas contain fighters and ability-created entities only.
        // Client-provided/placeable fixtures are deliberately ignored.
        List<Obstacle> obstacles = new ArrayList<>();

        MatchPlaybackDTO.ArenaStateDTO initialState = new MatchPlaybackDTO.ArenaStateDTO(
                arena.width(),
                arena.height(),
                fighters.stream().map(DuelSimulationService::toPlacement).toList(),
                obstacles.stream().map(DuelSimulationService::toObstaclePlacement).toList());
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
        List<Grenade> grenades = new ArrayList<>();
        List<Fireball> fireballs = new ArrayList<>();
        List<ArenaEntity> prototypePlacements = new ArrayList<>();

        for (int elapsedMs = 0, tick = 0; elapsedMs <= arena.durationMs(); elapsedMs += STEP_MS, tick += 1) {
            for (Fighter fighter : fighters) {
                fighter.tickStartHp = fighter.hp;
                fighter.damageTakenThisTick = 0;
            }
            List<Obstacle> targetingObstacles = new ArrayList<>(obstacles);
            prototypePlacements.stream()
                    .map(placement -> new Obstacle("prototype:" + placement.ownerSlot() + ":" + placement.id(), placement.type(), placement.x(), placement.y(), placement.size(), 0, placement.timerMs(), placement.velocityX(), placement.velocityY()))
                    .forEach(targetingObstacles::add);
            Action firstPredicted = predictAction(fighters.get(0), fighters.get(1), targetingObstacles, grenades, fireballs, arena);
            Action secondPredicted = predictAction(fighters.get(1), fighters.get(0), targetingObstacles, grenades, fireballs, arena);
            Action firstAction = commandLockedAction(fighters.get(0), firstPredicted);
            Action secondAction = commandLockedAction(fighters.get(1), secondPredicted);
            boolean firstSwung = applyAction(fighters.get(0), firstAction, arena);
            boolean secondSwung = applyAction(fighters.get(1), secondAction, arena);
            resolvePrototypeActions(fighters.get(0), fighters.get(1), targetingObstacles, arena);
            resolvePrototypeActions(fighters.get(1), fighters.get(0), targetingObstacles, arena);
            for (Fighter spawningFighter : fighters) {
                ArenaEntity spawn = spawningFighter.prototypeSpawn;
                if (spawn == null) continue;
                prototypePlacements.add(spawn);
            }
            fighters.stream()
                    .map(fighter -> fighter.thrownGrenade)
                    .filter(grenade -> grenade != null)
                    .forEach(grenades::add);
            fighters.stream()
                    .map(fighter -> fighter.thrownFireball)
                    .filter(fireball -> fireball != null)
                    .forEach(fireballs::add);
            obstacles = applyObstacleEffects(fighters, obstacles, firstAction, secondAction);
            GrenadeUpdate grenadeUpdate = updateGrenades(grenades, fighters, obstacles, arena);
            grenades = grenadeUpdate.grenades();
            obstacles = grenadeUpdate.obstacles();
            FireballUpdate fireballUpdate = updateFireballs(fireballs, fighters, obstacles, arena);
            fireballs = fireballUpdate.fireballs();
            obstacles = fireballUpdate.obstacles();

            boolean firstSwingHit = firstSwung && attackHits(fighters.get(0), fighters.get(1));
            boolean secondSwingHit = secondSwung && attackHits(fighters.get(1), fighters.get(0));
            var firstSwingShield = firstSwingHit ? resolveShield(fighters.get(1), fighters.get(0).x, fighters.get(0).y, "swing") : AbilityEntitySystem.ShieldResult.none();
            var secondSwingShield = secondSwingHit ? resolveShield(fighters.get(0), fighters.get(1).x, fighters.get(1).y, "swing") : AbilityEntitySystem.ShieldResult.none();
            boolean firstLanded = firstSwingHit && !firstSwingShield.prevents(EffectType.DAMAGE);
            boolean secondLanded = secondSwingHit && !secondSwingShield.prevents(EffectType.DAMAGE);
            if (firstLanded) {
                applyDamageFrom(fighters.get(0), fighters.get(1), incomingAttackDamage(fighters.get(0), fighters.get(1)));
            }
            if (secondLanded) {
                applyDamageFrom(fighters.get(1), fighters.get(0), incomingAttackDamage(fighters.get(1), fighters.get(0)));
            }

            GunReflection firstGunReflection = reflectGunShot(fighters.get(0), fighters, obstacles);
            obstacles = firstGunReflection.obstacles();
            GunReflection secondGunReflection = reflectGunShot(fighters.get(1), fighters, obstacles);
            obstacles = secondGunReflection.obstacles();
            applyGunReflectionDamage(fighters.get(0), firstGunReflection, fighters);
            applyGunReflectionDamage(fighters.get(1), secondGunReflection, fighters);
            boolean firstGunHit = !firstGunReflection.reflected() && gunHits(fighters.get(0), fighters.get(1), obstacles);
            boolean secondGunHit = !secondGunReflection.reflected() && gunHits(fighters.get(1), fighters.get(0), obstacles);
            var firstGunShield = firstGunHit ? resolveShield(fighters.get(1), fighters.get(0).x, fighters.get(0).y, "fire_gun") : AbilityEntitySystem.ShieldResult.none();
            var secondGunShield = secondGunHit ? resolveShield(fighters.get(0), fighters.get(1).x, fighters.get(1).y, "fire_gun") : AbilityEntitySystem.ShieldResult.none();
            boolean firstGunLanded = firstGunHit && !firstGunShield.prevents(EffectType.DAMAGE);
            boolean secondGunLanded = secondGunHit && !secondGunShield.prevents(EffectType.DAMAGE);
            if (firstGunLanded) {
                applyDamageFrom(fighters.get(0), fighters.get(1), incomingGunDamage(fighters.get(0), fighters.get(1)));
            }
            if (secondGunLanded) {
                applyDamageFrom(fighters.get(1), fighters.get(0), incomingGunDamage(fighters.get(1), fighters.get(0)));
            }
            boolean firstStunHit = stunHits(fighters.get(0), fighters.get(1));
            boolean secondStunHit = stunHits(fighters.get(1), fighters.get(0));
            var firstStunShield = firstStunHit ? resolveShield(fighters.get(1), fighters.get(0).x, fighters.get(0).y, "stun") : AbilityEntitySystem.ShieldResult.none();
            var secondStunShield = secondStunHit ? resolveShield(fighters.get(0), fighters.get(1).x, fighters.get(1).y, "stun") : AbilityEntitySystem.ShieldResult.none();
            boolean firstStunLanded = firstStunHit && !firstStunShield.prevents(EffectType.DEBUFF);
            boolean secondStunLanded = secondStunHit && !secondStunShield.prevents(EffectType.DEBUFF);
            if (firstStunLanded) applyStun(fighters.get(0), fighters.get(1));
            if (secondStunLanded) applyStun(fighters.get(1), fighters.get(0));
            applyGrenadeExplosions(fighters, grenadeUpdate.explosions());
            applyFireballHits(fighters, fireballUpdate.hits());
            applyBurnDamage(fighters);
            prototypePlacements = updatePrototypePlacements(prototypePlacements, fighters, arena, grenades, grenadeUpdate.explosions(), fireballs);
            fighters.forEach(fighter -> {
                if (fighter.pendingHealing > 0) {
                    fighter.hp = Math.min(fighter.maxHp, fighter.hp + fighter.pendingHealing);
                    fighter.pendingHealing = 0;
                }
                fighter.damageTakenLastTick = fighter.damageTakenThisTick;
                fighter.hpNetChangeLastTick = fighter.hp - fighter.tickStartHp;
            });

            List<MatchPlaybackDTO.ObstaclePlacementDTO> frameObstacles = new ArrayList<>();
            frameObstacles.addAll(obstacles.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(grenades.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(grenadeUpdate.explosions().stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(fireballs.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(prototypePlacements.stream().map(DuelSimulationService::toObstaclePlacement).toList());

            frames.add(new MatchPlaybackDTO.ReplayFrameDTO(
                    tick,
                    elapsedMs,
                    fighters.stream().map(DuelSimulationService::toPlacement).toList(),
                    frameObstacles));

            boolean firstDefeated = fighters.get(0).hp <= 0;
            boolean secondDefeated = fighters.get(1).hp <= 0;
            if (firstDefeated || secondDefeated) {
                Fighter winner = firstDefeated == secondDefeated
                        ? null
                        : firstDefeated ? fighters.get(1) : fighters.get(0);
                return duelResult(request.matchId(), initialState, frames, winner);
            }
        }

        return duelResult(request.matchId(), initialState, frames, null);
    }

    private Fighter fighterFromRequest(DuelFighterRequest request) {
        Fighter fighter = new Fighter();
        fighter.userId = request.userId();
        fighter.username = request.username();
        fighter.slot = request.slot();
        fighter.x = request.x();
        fighter.y = request.y();
        fighter.rotation = request.rotation() != null ? request.rotation() : request.slot() == 1 ? 90.0 : 270.0;
        fighter.size = request.size();
        fighter.brain = request.brain();
        initializeCustomVariables(fighter);
        boolean hasLoadout = request.brain() != null && request.brain().path("loadout").isObject();
        fighter.combatClass = hasLoadout ? "custom" : hasText(request.selectedClass()) ? request.selectedClass() : "melee";
        fighter.abilities = readAbilities(request.brain(), fighter.combatClass);
        fighter.maxHp = hasLoadout ? 100 + readStatPoints(request.brain(), "maxHp") * 10 : combatRules(fighter).maxHp();
        fighter.moveSpeed = hasLoadout ? 8.0 + readStatPoints(request.brain(), "moveSpeed") : combatRules(fighter).moveSpeed();
        fighter.attackDamageMultiplier = 1.0 + readStatPoints(request.brain(), "attackDamage") * 0.1;
        fighter.attackSpeedMultiplier = 1.0 + readStatPoints(request.brain(), "attackSpeed") * 0.1;
        fighter.hp = fighter.maxHp;
        fighter.spawnX = fighter.x;
        fighter.spawnY = fighter.y;
        fighter.blockCharges = hasAbility(fighter, "block") ? combatRules(fighter).blockMaxCharges() : 0;
        fighter.blockRechargeMs = 0;
        fighter.dashCooldownMs = 0;
        fighter.gunAmmo = hasAbility(fighter, "fire_gun") ? combatRules(fighter).gunAmmoMax() : 0;
        fighter.gunReloadMs = 0;
        fighter.fireballCharges = hasAbility(fighter, "shoot_fireball") ? combatRules(fighter).fireballChargesMax() : 0;
        fighter.fireballReloadMs = 0;
        return fighter;
    }

    private static void initializeCustomVariables(Fighter fighter) {
        JsonNode variables = fighter.brain != null ? fighter.brain.get("customVariables") : null;
        if (variables == null || !variables.isArray()) return;
        int slots = 0;
        for (JsonNode variable : variables) {
            JsonNode conditions = variable.get("conditions");
            slots += 1 + (conditions != null && conditions.isArray() ? conditions.size() : 0);
            if (slots > 100) break;
            String id = textValue(field(variable, "id"), "");
            String type = textValue(field(variable, "valueType"), "number");
            if (!id.startsWith("custom.") || fighter.customVariableTypes.containsKey(id)) continue;
            fighter.customVariableTypes.put(id, type);
            fighter.customVariables.put(id, "boolean".equals(type)
                    ? field(variable, "initialValue") != null && field(variable, "initialValue").asBoolean(false)
                    : (long) clamp(numberValue(field(variable, "initialValue"), 0), -CUSTOM_INTEGER_LIMIT, CUSTOM_INTEGER_LIMIT));
            if ("boolean".equals(type) && conditions != null && conditions.isArray()) fighter.customVariableConditions.put(id, conditions);
        }
    }

    private static Set<String> readAbilities(JsonNode brain, String legacyClass) {
        JsonNode abilities = brain != null ? brain.path("loadout").path("abilities") : null;
        if (abilities == null || !abilities.isArray()) {
            return switch (legacyClass) {
                case "ranged" -> Set.of("fire_gun", "throw_grenade");
                case "mage" -> Set.of("shoot_fireball", "stun");
                default -> Set.of("swing", "block", "dash");
            };
        }
        Set<String> result = new HashSet<>();
        abilities.forEach(node -> {
            if (node.isTextual()) result.add(node.asText());
        });
        return result;
    }

    private static int readStatPoints(JsonNode brain, String stat) {
        if (brain == null) return 0;
        return Math.max(0, Math.min(12, brain.path("loadout").path("statPoints").path(stat).asInt(0)));
    }

    private static boolean hasAbility(Fighter fighter, String ability) {
        return fighter.abilities.contains(ability);
    }

    private static boolean selectedAbilityReady(Fighter fighter, String ability) {
        return switch (ability) {
            case "swing" -> hasAbility(fighter, "swing") && fighter.attackCooldownMs <= 0;
            case "block" -> hasAbility(fighter, "block") && fighter.blockCharges > 0;
            case "dash" -> canDash(fighter) && fighter.dashCooldownMs <= 0 && fighter.dashActiveMs <= 0;
            case "fire_gun" -> hasAbility(fighter, "fire_gun") && fighter.gunAmmo > 0 && fighter.gunCooldownMs <= 0 && fighter.gunReloadMs <= 0;
            case "throw_grenade" -> hasAbility(fighter, "throw_grenade") && fighter.grenadeCooldownMs <= 0;
            case "shoot_fireball" -> fireballAvailable(fighter);
            case "stun" -> stunAvailable(fighter);
            default -> hasAbility(fighter, ability) && fighter.abilityCooldowns.getOrDefault(ability, 0) <= 0;
        };
    }

    private static int selectedAbilityCooldownMs(Fighter fighter, String ability) {
        return switch (ability) {
            case "swing" -> fighter.attackCooldownMs;
            case "block" -> fighter.blockCooldownMs > 0 ? fighter.blockCooldownMs : fighter.blockCharges > 0 ? 0 : fighter.blockRechargeMs;
            case "dash" -> fighter.dashCooldownMs;
            case "fire_gun" -> Math.max(fighter.gunCooldownMs, fighter.gunReloadMs);
            case "throw_grenade" -> fighter.grenadeCooldownMs;
            case "shoot_fireball" -> Math.max(fighter.fireballCooldownMs, fighter.fireballReloadMs);
            case "stun" -> fighter.stunCooldownMs;
            default -> fighter.abilityCooldowns.getOrDefault(ability, 0);
        };
    }

    private CombatRules combatRules(Fighter fighter) {
        return combatCatalog.forSubmittedClass(fighter.combatClass);
    }

    private static int selectedAbilityAmmo(Fighter fighter, String ability) {
        return switch (ability) {
            case "block" -> fighter.blockCharges;
            case "fire_gun" -> fighter.gunAmmo;
            case "shoot_fireball" -> fighter.fireballCharges;
            default -> 0;
        };
    }

    private static MatchPlaybackDTO duelResult(
            UUID matchId,
            MatchPlaybackDTO.ArenaStateDTO initialState,
            List<MatchPlaybackDTO.ReplayFrameDTO> frames,
            Fighter winner) {
        return new MatchPlaybackDTO(
                matchId,
                DUEL_RULESET_VERSION,
                "COMPLETED",
                initialState,
                frames,
                winner != null ? "FIGHTER_WIN" : "DRAW",
                winner != null ? winner.userId : null,
                winner != null ? winner.username + " wins the fight." : "The fight ended in a draw.");
    }

    private Action predictAction(Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        if (player.hp <= 0) return new Action(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, 500, 400);
        ActionPlan plan = selectStrategyActionPlan(player.brain, player, opponent, obstacles, grenades, fireballs, arena);
        boolean canDash = combatRules(player).canDash();
        StrategyBlock movementBlock = plan.movement != null ? plan.movement : canDash ? plan.dashMovement : null;
        StrategyBlock facingBlock = plan.rotation;
        Entity movementTarget = movementBlock != null && "coordinates".equals(movementBlock.movementMode)
                ? new Obstacle("movement-coordinate", "coordinate", movementBlock.targetX, movementBlock.targetY, 0, 0, 0)
                : offsetTarget(targetEntity(movementBlock != null ? movementBlock.actionTarget : "opponent", player, opponent, obstacles, grenades, fireballs), movementBlock);
        Entity facingTarget = offsetTarget(targetEntity(facingBlock != null
                ? facingBlock.actionTarget
                : movementBlock != null ? movementBlock.actionTarget : "opponent", player, opponent, obstacles, grenades, fireballs), facingBlock != null ? facingBlock : movementBlock);
        Entity specialTarget = plan.special != null && "target".equals(plan.special.targetMode)
                ? offsetTarget(targetEntity(plan.special.actionTarget, player, opponent, obstacles, grenades, fireballs), plan.special)
                : null;
        String movementAction = configuredMovementAction(movementBlock);
        Vector movement = movementVectorForAction(movementAction, player, movementTarget, arena);
        return new Action(
                movement.dx(),
                movement.dy(),
                facingBlock != null && "rotate_toward_enemy".equals(facingBlock.action)
                        ? turnTowardTarget(player, facingTarget) : 0.0,
                plan.swing != null && "swing".equals(plan.swing.action) ? 1.0 : 0.0,
                plan.block != null && "block".equals(plan.block.action) ? 1.0 : 0.0,
                plan.gun != null && "fire_gun".equals(plan.gun.action) ? 1.0 : 0.0,
                plan.grenade != null && "throw_grenade".equals(plan.grenade.action) ? 1.0 : 0.0,
                plan.fireball != null && "shoot_fireball".equals(plan.fireball.action) ? 1.0 : 0.0,
                plan.stun != null && "stun".equals(plan.stun.action) ? 1.0 : 0.0,
                canDash && plan.dash != null && plan.dash.action.startsWith("dash") ? 1.0 : 0.0,
                configuredSpecialAction(plan.special),
                specialTarget != null ? specialTarget.x() : plan.special != null ? plan.special.targetX : 500,
                specialTarget != null ? specialTarget.y() : plan.special != null ? plan.special.targetY : 400);
    }

    private static String configuredMovementAction(StrategyBlock block) {
        if (block == null) return "move_stop";
        if (block.movementMode == null) return block.action;
        String prefix = "dash".equals(block.action) ? "dash" : "move";
        String direction = block.movementDirection != null ? block.movementDirection : "toward";
        if ("absolute".equals(block.movementMode)) return prefix + "_" + direction;
        return switch (direction) {
            case "away" -> prefix + "_outward";
            case "left" -> prefix + "_tangent_left";
            case "right" -> prefix + "_tangent_right";
            case "toward_left" -> prefix + "_diagonal_in_left";
            case "toward_right" -> prefix + "_diagonal_in_right";
            case "away_left" -> prefix + "_diagonal_out_left";
            case "away_right" -> prefix + "_diagonal_out_right";
            default -> "dash".equals(prefix) ? "dash" : "move_inward";
        };
    }

    private static String configuredSpecialAction(StrategyBlock block) {
        if (block == null) return null;
        if ("phase_strike".equals(block.action)) return switch (block.phaseFacingMode != null ? block.phaseFacingMode : "face_target") { case "keep" -> "phase_strike_keep_facing"; case "face_origin" -> "phase_strike_face_origin"; case "mirror" -> "phase_strike_mirror_facing"; default -> "phase_strike"; };
        if (!"micro_dash".equals(block.action) || block.movementMode == null) return block.action;
        String direction = block.movementDirection != null ? block.movementDirection : "toward";
        if ("absolute".equals(block.movementMode)) return "micro_dash_" + direction;
        return switch (direction) { case "away" -> "micro_dash_outward"; case "left" -> "micro_dash_left"; case "right" -> "micro_dash_right"; case "toward_left" -> "micro_dash_toward_left"; case "toward_right" -> "micro_dash_toward_right"; case "away_left" -> "micro_dash_away_left"; case "away_right" -> "micro_dash_away_right"; default -> "micro_dash"; };
    }

    private static Action commandLockedAction(Fighter fighter, Action predicted) {
        if (fighter.commandLockedMs <= 0 || fighter.commandLockAction == null) return predicted;
        Action locked = fighter.commandLockAction;
        boolean dashNow = predicted.dash() > 0.5;
        boolean lockedDashFinished = locked.dash() > 0.5 && !dashNow;
        return new Action(
                dashNow ? predicted.dx() : lockedDashFinished ? 0.0 : locked.dx(),
                dashNow ? predicted.dy() : lockedDashFinished ? 0.0 : locked.dy(),
                locked.dRot(),
                locked.swing(),
                predicted.block(),
                locked.gun(),
                predicted.grenade(),
                locked.fireball(),
                predicted.stun(),
                predicted.dash(),
                locked.special(),
                locked.specialTargetX(),
                locked.specialTargetY());
    }

    private ActionPlan selectStrategyActionPlan(JsonNode strategy, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        List<PriorityEntry> selected = selectPriorityEntries(strategy, player, opponent, obstacles, grenades, fireballs, arena);
        ActionPlan plan = new ActionPlan();
        plan.primary = selected.stream()
                .map(PriorityEntry::block)
                .filter(block -> !"no_dash".equals(block.action) && !"variable".equals(block.action))
                .findFirst()
                .orElse(null);
        for (PriorityEntry entry : selected) {
            StrategyBlock block = entry.block();
            if ("variable".equals(block.action)) {
                applyCustomVariableAction(player, opponent, obstacles, grenades, fireballs, arena, block);
                continue;
            }
            String head = actionHead(block.action);
            if ("no_dash".equals(block.action)) {
                plan.dash = block;
                continue;
            }
            if (block.action.startsWith("dash") && plan.dashMovement == null) plan.dashMovement = block;
            if ("ability".equals(head) && plan.ability != null) continue;
            if ("ability".equals(head)) plan.ability = block;
            switch (head) {
                case "rotation" -> {
                    if (plan.rotation == null) plan.rotation = block;
                }
                case "dash" -> {
                    if (plan.dash == null) plan.dash = block;
                }
                case "ability" -> {
                    String ability = abilityKind(block.action);
                    switch (ability) {
                        case "swing" -> plan.swing = block;
                        case "block" -> plan.block = block;
                        case "gun" -> plan.gun = block;
                        case "grenade" -> plan.grenade = block;
                        case "fireball" -> plan.fireball = block;
                        case "stun" -> plan.stun = block;
                        case "dash" -> plan.dash = block;
                        case "special" -> plan.special = block;
                        default -> { }
                    }
                }
                default -> {
                    if (plan.movement == null) plan.movement = block;
                }
            }
        }
        return plan;
    }

    private static String abilityKind(String action) {
        if ("swing".equals(action)) return "swing";
        if ("block".equals(action)) return "block";
        if ("fire_gun".equals(action)) return "gun";
        if ("throw_grenade".equals(action)) return "grenade";
        if ("shoot_fireball".equals(action)) return "fireball";
        if ("stun".equals(action)) return "stun";
        if ("no_dash".equals(action) || action.startsWith("dash")) return "dash";
        if (PROTOTYPE_ACTIONS.contains(action)) return "special";
        return "";
    }

    private List<PriorityEntry> selectPriorityEntries(JsonNode strategy, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        JsonNode columns = strategy != null ? strategy.get("columns") : null;
        if (columns != null && columns.isArray()) {
            return selectTreeEntries(columns, player, opponent, obstacles, grenades, fireballs, arena);
        }
        List<PriorityEntry> matching = normalizeStrategyEntries(strategy).stream()
                .filter(entry -> !entryUsesHiddenTarget(entry, player)
                        && strategyBlockExecutableNow(entry.block(), player, opponent, obstacles, grenades, fireballs)
                        && evaluateConditions(entry.clusterConditions(), player, opponent, obstacles, grenades, fireballs, arena)
                        && evaluateConditions(entry.block().conditions(), player, opponent, obstacles, grenades, fireballs, arena))
                .sorted(DuelSimulationService::comparePriorityEntries)
                .toList();
        return matching;
    }

    private List<PriorityEntry> selectTreeEntries(JsonNode columns, Fighter player, Fighter opponent,
            List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        List<TreeColumn> normalized = normalizeTreeColumns(columns);
        List<PriorityEntry> selected = new ArrayList<>();
        normalized.stream()
                .sorted(Comparator.comparingDouble(TreeColumn::createdOrder))
                .forEach(column -> {
                    List<StrategyBlock> blocks = selectTreeBranch(column.branches(), player, opponent, obstacles, grenades, fireballs, arena);
                    for (StrategyBlock block : blocks) selected.add(new PriorityEntry(block, 0, column.index(), column.index(), List.of()));
                });
        return selected;
    }

    private List<StrategyBlock> selectTreeBranch(List<TreeBranch> branches, Fighter player, Fighter opponent,
            List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        List<TreeBranch> ordered = branches.stream().sorted(Comparator.comparingDouble(TreeBranch::createdOrder)).toList();
        List<StrategyBlock> selected = new ArrayList<>();
        for (TreeBranch branch : ordered) {
            StrategyBlock conditionBlock = branch.blocks().get(0);
            boolean hidden = player.jammedMs > 0 && (branch.blocks().stream().anyMatch(block -> actionUsesTarget(block.action()))
                    || conditionBlock.conditions().stream().anyMatch(DuelSimulationService::conditionUsesTarget));
            boolean matches = "else".equals(branch.branchType())
                    || (!hidden && evaluateConditions(conditionBlock.conditions(), player, opponent, obstacles, grenades, fireballs, arena));
            if (!matches) continue;
            List<StrategyBlock> child = selectTreeBranch(branch.children(), player, opponent, obstacles, grenades, fireballs, arena);
            selected.addAll(child);
            branch.blocks().stream()
                    .filter(block -> strategyBlockExecutableNow(block, player, opponent, obstacles, grenades, fireballs))
                    .forEach(selected::add);
        }
        return selected;
    }

    private static List<TreeColumn> normalizeTreeColumns(JsonNode columns) {
        List<TreeColumn> normalized = new ArrayList<>();
        int[] remainingActions = { MAX_LOGIC_BLOCKS };
        int[] remainingConditions = { MAX_TOTAL_CONDITIONS };
        int limit = Math.min(columns.size(), MAX_CLUSTERS);
        for (int index = 0; index < limit && remainingConditions[0] > 0; index += 1) {
            JsonNode column = columns.get(index);
            normalized.add(new TreeColumn(
                    index,
                    numberValue(field(column, "createdOrder"), index),
                    normalizeTreeBranches(field(column, "branches"), remainingActions, remainingConditions)));
        }
        return normalized;
    }

    private static List<TreeBranch> normalizeTreeBranches(JsonNode branches, int[] remainingActions, int[] remainingConditions) {
        if (branches == null || !branches.isArray() || remainingConditions[0] <= 0) return List.of();
        List<TreeBranch> normalized = new ArrayList<>();
        for (int index = 0; index < branches.size() && remainingConditions[0] > 0; index += 1) {
            JsonNode branch = branches.get(index);
            List<StrategyBlock> blocks = normalizeTreeActions(branch, index).stream()
                    .filter(block -> "none".equals(block.action()) || remainingActions[0] > 0)
                    .limit(Math.max(1, remainingActions[0]))
                    .toList();
            if (blocks.isEmpty()) {
                blocks = List.of(new StrategyBlock(index, "none", "opponent", 0, 0, "target", 500, 400, null, null, null, null, 1, normalizeConditions(field(branch, "conditions"))));
            }
            remainingActions[0] -= (int) blocks.stream().filter(block -> !"none".equals(block.action())).count();
            String branchType = index == 0 ? "if" : "else".equals(textValue(field(branch, "branchType"), "else_if")) ? "else" : "else_if";
            if ("else".equals(branchType)) {
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.actionTarget(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), List.of())).toList();
            } else {
                int conditionLimit = Math.min(remainingConditions[0], blocks.isEmpty() ? 0 : blocks.get(0).conditions().size());
                List<Condition> limitedConditions = blocks.isEmpty() ? List.of() : blocks.get(0).conditions().subList(0, conditionLimit);
                remainingConditions[0] -= conditionLimit;
                blocks = blocks.stream().map(block -> new StrategyBlock(block.index(), block.action(), block.actionTarget(), block.targetOffsetX(), block.targetOffsetY(), block.targetMode(), block.targetX(), block.targetY(), block.movementMode(), block.movementDirection(), block.phaseFacingMode(), block.variableTerms(), block.priority(), limitedConditions)).toList();
            }
            normalized.add(new TreeBranch(
                    branchType,
                    numberValue(field(branch, "createdOrder"), index),
                    blocks,
                    normalizeTreeBranches(field(branch, "children"), remainingActions, remainingConditions)));
        }
        return normalized;
    }

    private static List<StrategyBlock> normalizeTreeActions(JsonNode branch, int index) {
        JsonNode actions = field(branch, "actions");
        List<StrategyBlock> blocks = new ArrayList<>();
        Set<String> heads = new HashSet<>();
        if (actions != null && actions.isArray() && !actions.isEmpty()) {
            for (JsonNode actionNode : actions) {
                String action = textValue(field(actionNode, "action"), "none");
                String head = actionHead(action);
                String headKey = "variable".equals(head) ? head + ":" + textValue(field(actionNode, "variableId"), String.valueOf(blocks.size())) : head;
                if (!heads.add(headKey)) continue;
                blocks.add(new StrategyBlock(index, action,
                        normalizeTarget(textValue(field(actionNode, "actionTarget"), "opponent"), "opponent"),
                        "variable".equals(action)
                                ? clamp(numberValue(field(actionNode, "value"), 0), -CUSTOM_INTEGER_LIMIT, CUSTOM_INTEGER_LIMIT)
                                : clamp(numberValue(field(actionNode, "targetOffsetX"), 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                        clamp(numberValue(field(actionNode, "targetOffsetY"), 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
                        textValue(field(actionNode, "targetMode"), field(actionNode, "targetX") != null || field(actionNode, "targetY") != null ? "coordinates" : "target"),
                        clamp(numberValue(field(actionNode, "targetX"), 500), 0, ARENA_WIDTH_UNITS),
                        clamp(numberValue(field(actionNode, "targetY"), 400), 0, ARENA_HEIGHT_UNITS),
                        textValue(field(actionNode, "movementMode"), null),
                        "variable".equals(action) ? textValue(field(actionNode, "operation"), "set") : textValue(field(actionNode, "movementDirection"), null),
                        "variable".equals(action) ? textValue(field(actionNode, "variableId"), "") : textValue(field(actionNode, "phaseFacingMode"), null),
                        "variable".equals(action) ? field(actionNode, "terms") : null,
                        normalizePriority(numberValue(field(branch, "priority"), 1.0)),
                        normalizeConditions(field(branch, "conditions"))));
            }
        }
        if (blocks.isEmpty()) blocks.add(normalizeStrategyBlock(branch, index));
        if (blocks.stream().anyMatch(block -> !"none".equals(block.action()))) {
            blocks.removeIf(block -> "none".equals(block.action()));
        }
        return blocks;
    }

    private static boolean entryUsesHiddenTarget(PriorityEntry entry, Fighter player) {
        if (player.jammedMs <= 0) return false;
        return actionUsesTarget(entry.block().action())
                || entry.clusterConditions().stream().anyMatch(DuelSimulationService::conditionUsesTarget)
                || entry.block().conditions().stream().anyMatch(DuelSimulationService::conditionUsesTarget);
    }

    private static boolean actionUsesTarget(String action) {
        return switch (action) {
            case "move_walk", "move_inward", "move_outward", "move_tangent_left", "move_tangent_right",
                    "move_diagonal_in_left", "move_diagonal_in_right", "move_diagonal_out_left",
                    "move_diagonal_out_right", "move_center", "rotate_toward_enemy",
                    "dash", "dash_outward", "dash_tangent_left", "dash_tangent_right",
                    "dash_diagonal_in_left", "dash_diagonal_in_right", "dash_diagonal_out_left",
                    "dash_diagonal_out_right",
                    "micro_dash", "micro_dash_outward" -> true;
            default -> false;
        };
    }

    private static boolean strategyBlockHasExecutableTarget(StrategyBlock block, Fighter player, Fighter opponent,
            List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        if (("move_walk".equals(block.action()) || "dash".equals(block.action()) || "micro_dash".equals(block.action()))
                && ("absolute".equals(block.movementMode()) || "coordinates".equals(block.movementMode()))) return true;
        if (!actionUsesTarget(block.action())
                && !(Set.of("orbital_strike", "null_zone").contains(block.action()) && "target".equals(block.targetMode()))) return true;
        return targetEntity(block.actionTarget(), player, opponent, obstacles, grenades, fireballs) != null;
    }

    private static boolean strategyBlockExecutableNow(StrategyBlock block, Fighter player, Fighter opponent,
            List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        if (!strategyBlockHasExecutableTarget(block, player, opponent, obstacles, grenades, fireballs)) return false;
        String action = block.action();
        if ("variable".equals(action)) return true;
        if ("none".equals(action)) return false;
        String head = actionHead(action);
        if ("movement".equals(head) || "rotation".equals(head) || "no_dash".equals(action)) return true;
        if ("dash".equals(head)) return selectedAbilityReady(player, "dash");
        String ability = PROTOTYPE_ACTIONS.contains(action) ? abilityForPrototypeAction(action) : action;
        return selectedAbilityReady(player, ability);
    }

    private static boolean conditionUsesTarget(Condition condition) {
        if ("expression".equals(condition.type())) {
            return variableUsesHiddenTarget(condition.left())
                    || (condition.right() != null
                    && "variable".equals(condition.right().type())
                    && variableUsesHiddenTarget(condition.right().valueText()));
        }
        return condition.type().startsWith("enemy_")
                || condition.type().startsWith("opponent_")
                || condition.type().startsWith("target_");
    }

    private static boolean variableUsesHiddenTarget(String variableId) {
        return variableId != null
                && (variableId.startsWith("opponent.") || variableId.startsWith("target."));
    }

    private static List<PriorityEntry> normalizeStrategyEntries(JsonNode strategy) {
        if (strategy == null || !strategy.isObject()) return List.of();
        List<PriorityEntry> entries = new ArrayList<>();
        int remainingBlocks = MAX_LOGIC_BLOCKS;
        JsonNode sourceBlocks = strategy.get("blocks");
        if (sourceBlocks != null && sourceBlocks.isArray()) {
            int blockLimit = Math.min(sourceBlocks.size(), remainingBlocks);
            for (int index = 0; index < blockLimit; index += 1) {
                entries.add(new PriorityEntry(
                        normalizeStrategyBlock(sourceBlocks.get(index), index),
                        index,
                        -1,
                        1,
                        List.of()));
            }
            remainingBlocks -= blockLimit;
        }

        JsonNode sourceClusters = strategy.get("clusters");
        if (sourceClusters != null && sourceClusters.isArray()) {
            int clusterLimit = Math.min(sourceClusters.size(), MAX_CLUSTERS);
            for (int clusterIndex = 0; clusterIndex < clusterLimit && remainingBlocks > 0; clusterIndex += 1) {
                JsonNode cluster = sourceClusters.get(clusterIndex);
                if (cluster == null || !cluster.isObject()) continue;
                List<Condition> clusterConditions = normalizeConditions(cluster.get("conditions"));
                JsonNode clusterBlocks = cluster.get("blocks");
                if (clusterBlocks == null || !clusterBlocks.isArray()) continue;
                int blockLimit = Math.min(clusterBlocks.size(), remainingBlocks);
                for (int blockIndex = 0; blockIndex < blockLimit; blockIndex += 1) {
                    entries.add(new PriorityEntry(
                            normalizeStrategyBlock(clusterBlocks.get(blockIndex), blockIndex),
                            blockIndex,
                            clusterIndex,
                            normalizePriority(numberValue(cluster.get("priority"), 1.0)),
                            clusterConditions));
                }
                remainingBlocks -= blockLimit;
            }
        }
        return entries;
    }

    private static StrategyBlock normalizeStrategyBlock(JsonNode block, int index) {
        return new StrategyBlock(
                index,
                textValue(field(block, "action"), "move_stop"),
                normalizeTarget(textValue(field(block, "actionTarget"), "opponent"), "opponent"),
                clamp(numberValue(field(block, "targetOffsetX"), 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                clamp(numberValue(field(block, "targetOffsetY"), 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
                textValue(field(block, "targetMode"), field(block, "targetX") != null || field(block, "targetY") != null ? "coordinates" : "target"),
                clamp(numberValue(field(block, "targetX"), 500), 0, ARENA_WIDTH_UNITS),
                clamp(numberValue(field(block, "targetY"), 400), 0, ARENA_HEIGHT_UNITS),
                textValue(field(block, "movementMode"), null),
                textValue(field(block, "movementDirection"), null),
                textValue(field(block, "phaseFacingMode"), null),
                field(block, "terms"),
                normalizePriority(numberValue(field(block, "priority"), 1.0)),
                normalizeConditions(field(block, "conditions")));
    }

    private static List<Condition> normalizeConditions(JsonNode conditions) {
        if (conditions == null || !conditions.isArray()) return List.of();
        List<Condition> normalized = new ArrayList<>();
        int limit = Math.min(conditions.size(), MAX_CONDITIONS_PER_BLOCK);
        for (int index = 0; index < limit; index += 1) {
            JsonNode condition = conditions.get(index);
            normalized.add(new Condition(
                    textValue(field(condition, "type"), ""),
                    numberValue(field(condition, "value"), 0.0),
                    normalizeTarget(textValue(field(condition, "target"), "opponent"), "opponent"),
                    normalizeTarget(textValue(field(condition, "leftTarget"), textValue(field(condition, "target"), "opponent")), "opponent"),
                    normalizeTarget(textValue(field(condition, "rightTarget"), textValue(field(condition, "target"), "opponent")), "opponent"),
                    textValue(field(condition, "left"), ""),
                    textValue(field(condition, "ability"), ""),
                    textValue(field(condition, "comparator"), "lt"),
                    normalizeOperand(field(condition, "right")),
                    numberValue(field(field(condition, "right"), "min"), -30.0),
                    numberValue(field(field(condition, "right"), "max"), 30.0),
                    index > 0 && "or".equals(textValue(field(condition, "join"), "and")) ? "or" : "and"));
        }
        return normalized;
    }

    private boolean evaluateConditions(List<Condition> conditions, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        boolean matches = true;
        for (int index = 0; index < conditions.size(); index += 1) {
            Condition condition = conditions.get(index);
            boolean conditionMatches = evaluateCondition(condition, player, opponent, obstacles, grenades, fireballs, arena);
            matches = index > 0 && "or".equals(condition.join())
                    ? matches || conditionMatches
                    : matches && conditionMatches;
        }
        return matches;
    }

    private boolean evaluateCondition(Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        if ("expression".equals(condition.type())) {
            return evaluateExpressionCondition(condition, player, opponent, obstacles, grenades, fireballs, arena);
        }
        return "always".equals(condition.type());
    }

    private boolean evaluateExpressionCondition(Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        StateValue left = resolveStateVariable(condition.left(), condition.leftTarget(), condition, player, opponent, obstacles, grenades, fireballs, arena);
        if (left == null) return false;
        if ("target.bearingFromMe".equals(condition.left())) {
            return directionFallsInRange(left.numberValue(), condition.rangeMin(), condition.rangeMax());
        }
        StateValue right = "variable".equals(condition.right().type())
                ? resolveStateVariable(condition.right().valueText(), condition.rightTarget(), condition, player, opponent, obstacles, grenades, fireballs, arena)
                : condition.right().toStateValue(left.type());
        if (right == null || left.type() != right.type()) return false;
        return compareValues(left, condition.comparator(), right);
    }

    private StateValue resolveStateVariable(String variable, String targetId, Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena) {
        if (variable != null && variable.startsWith("custom.")) {
            String type = player.customVariableTypes.get(variable);
            if (type == null) return null;
            JsonNode derived = player.customVariableConditions.get(variable);
            if (derived != null) {
                if (!player.resolvingCustomVariables.add(variable)) return StateValue.bool(false);
                boolean value = evaluateConditions(normalizeConditions(derived), player, opponent, obstacles, grenades, fireballs, arena);
                player.resolvingCustomVariables.remove(variable);
                return StateValue.bool(value);
            }
            Object value = player.customVariables.get(variable);
            return "boolean".equals(type) ? StateValue.bool(Boolean.TRUE.equals(value)) : StateValue.number(value instanceof Number number ? number.doubleValue() : 0);
        }
        Entity target = targetEntity(targetId, player, opponent, obstacles, grenades, fireballs);
        if (variable.matches("^(my|opponent)\\.selectedAbility(Ready|CooldownMs|Ammo|Preparing|PreparationMs)$")) {
            Fighter observed = variable.startsWith("my.") ? player : opponent;
            String ability = condition.ability();
            if (variable.endsWith("Ready")) return StateValue.bool(selectedAbilityReady(observed, ability));
            if (variable.endsWith("CooldownMs")) return StateValue.number(millisecondsToSeconds(selectedAbilityCooldownMs(observed, ability)));
            if (variable.endsWith("Ammo")) return StateValue.number(selectedAbilityAmmo(observed, ability));
            if (variable.endsWith("Preparing")) return StateValue.bool(ability.equals(observed.preparingAbility));
            return StateValue.number(ability.equals(observed.preparingAbility) ? millisecondsToSeconds(observed.preparingMs) : 0);
        }
        return switch (variable) {
            case "match.elapsedSeconds" -> StateValue.number(millisecondsToSeconds((int) player.matchElapsedMs));
            case "my.hp" -> StateValue.number(player.hp);
            case "my.damageTakenLastTick" -> StateValue.number(player.damageTakenLastTick);
            case "my.hpNetChangeLastTick" -> StateValue.number(player.hpNetChangeLastTick);
            case "my.x" -> StateValue.number(player.x);
            case "my.y" -> StateValue.number(player.y);
            case "opponent.hp" -> StateValue.number(opponent.hp);
            case "opponent.damageTakenLastTick" -> StateValue.number(opponent.damageTakenLastTick);
            case "opponent.hpNetChangeLastTick" -> StateValue.number(opponent.hpNetChangeLastTick);
            case "opponent.x" -> StateValue.number(opponent.x);
            case "opponent.y" -> StateValue.number(opponent.y);
            case "my.slowedMs" -> StateValue.number(millisecondsToSeconds(player.slowedMs));
            case "opponent.slowedMs" -> StateValue.number(millisecondsToSeconds(opponent.slowedMs));
            case "my.coreHp" -> StateValue.number(coreHp(obstacles, player.slot));
            case "opponent.coreHp" -> StateValue.number(coreHp(obstacles, opponent.slot));
            case "target.distance" -> StateValue.number(target != null
                    ? Math.hypot(target.x() - player.x, target.y() - player.y)
                    : Double.POSITIVE_INFINITY);
            case "target.hp" -> StateValue.number(target instanceof Obstacle obstacle ? Math.max(0, obstacle.hp)
                    : target instanceof Fighter fighter ? fighter.hp : 0);
            case "target.bearingFromMe" -> {
                double bearing = target != null ? compassBearing(player, target) : 0.0;
                yield StateValue.number(bearing > 180 ? bearing - 360 : bearing);
            }
            case "target.movementDirection" -> {
                Velocity velocity = entityVelocity(target);
                if (velocity == null || Math.hypot(velocity.x(), velocity.y()) <= 0.001) yield StateValue.number(Double.NaN);
                double bearing = normalizeDegrees(Math.toDegrees(Math.atan2(velocity.x(), -velocity.y())));
                yield StateValue.number(bearing > 180 ? bearing - 360 : bearing);
            }
            case "target.velocity" -> {
                Velocity velocity = entityVelocity(target);
                yield StateValue.number(velocity == null ? 0 : Math.hypot(velocity.x(), velocity.y()));
            }
            case "my.bearingFromTarget" -> StateValue.number(target != null ? compassBearing(target, player) : 0.0);
            case "target.relativeBearing" -> StateValue.number(target != null
                    ? Math.abs(angleDelta(player.rotation, compassBearing(player, target))) : 0.0);
            case "target.relativeBearingClockwise" -> StateValue.number(target != null
                    ? clockwiseAngleDelta(player.rotation, compassBearing(player, target)) : 0.0);
            case "target.relativeBearingCounterclockwise" -> StateValue.number(target != null
                    ? clockwiseAngleDelta(compassBearing(player, target), player.rotation) : 0.0);
            case "target.facing" -> StateValue.number(target instanceof Fighter fighter ? normalizeDegrees(fighter.rotation) : 0.0);
            case "target.count" -> StateValue.number(matchingTargets(targetId, player, opponent, obstacles, grenades, fireballs).size());
            case "target.age" -> StateValue.number(target instanceof Obstacle obstacle && obstacle.id.startsWith("prototype:") ? millisecondsToSeconds(obstacle.usesRemaining) : 0.0);
            case "opponent.objectDistance" -> StateValue.number(target instanceof Obstacle
                    ? Math.hypot(target.x() - opponent.x, target.y() - opponent.y)
                    : Double.POSITIVE_INFINITY);
            case "my.edgeDistance" -> StateValue.number(edgeDistanceUnits(player, arena));
            case "target.edgeDistance" -> StateValue.number(target != null ? edgeDistanceUnits(target, arena) : 0.0);
            case "target.exists" -> StateValue.bool(target != null);
            case "target.alive" -> StateValue.bool(target instanceof Obstacle obstacle
                    ? obstacle.hp > 0
                    : target instanceof Fighter fighter && fighter.hp > 0);
            case "target.isDamageZone" -> StateValue.bool(target instanceof Obstacle obstacle && "damageZone".equals(obstacle.type));
            case "target.isProjectileWall" -> StateValue.bool(target instanceof Obstacle obstacle
                    && PROJECTILE_WALL_TYPE.equals(obstacle.type));
            case "target.isBouncyWall" -> StateValue.bool(target instanceof Obstacle obstacle
                    && BOUNCY_WALL_TYPE.equals(obstacle.type));
            case "my.jammed" -> StateValue.bool(player.jammedMs > 0);
            case "my.commandLocked" -> StateValue.bool(player.commandLockedMs > 0);
            case "opponent.jammed" -> StateValue.bool(opponent.jammedMs > 0);
            case "opponent.commandLocked" -> StateValue.bool(opponent.commandLockedMs > 0);
            case "my.insideDamageZone" -> StateValue.bool(obstacles.stream()
                    .anyMatch(obstacle -> "damageZone".equals(obstacle.type) && overlapsObstacle(player, obstacle)));
            default -> null;
        };
    }

    private static double millisecondsToSeconds(int value) {
        return value / 1000.0;
    }

    private static boolean compareValues(StateValue left, String comparator, StateValue right) {
        if (left.type() == ValueType.BOOLEAN) {
            return "neq".equals(comparator)
                    ? left.booleanValue() != right.booleanValue()
                    : left.booleanValue() == right.booleanValue();
        }
        double leftNumber = left.numberValue();
        double rightNumber = right.numberValue();
        if (!Double.isFinite(leftNumber) || !Double.isFinite(rightNumber)) return false;
        return switch (comparator) {
            case "lt" -> leftNumber < rightNumber;
            case "lte" -> leftNumber <= rightNumber;
            case "eq" -> leftNumber == rightNumber;
            case "neq" -> leftNumber != rightNumber;
            case "gte" -> leftNumber >= rightNumber;
            case "gt" -> leftNumber > rightNumber;
            default -> false;
        };
    }

    private static boolean fireballAvailable(Fighter fighter) {
        return hasAbility(fighter, "shoot_fireball")
                && fighter.fireballCharges > 0
                && fighter.fireballReloadMs <= 0
                && fighter.fireballCooldownMs <= 0
                && fighter.fireballActiveMs <= 0;
    }

    private static boolean stunAvailable(Fighter fighter) {
        return hasAbility(fighter, "stun")
                && fighter.stunCooldownMs <= 0
                && fighter.stunActiveMs <= 0;
    }

    private static Entity targetEntity(String target, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        String[] selector = target != null ? target.split(":", -1) : new String[0];
        if (selector.length == 3) {
            List<Entity> candidates = new ArrayList<>(matchingTargets(selector[0], player, opponent, obstacles, grenades, fireballs));
            Comparator<Entity> comparator = switch (selector[1]) {
                case "farthest" -> Comparator.comparingDouble((Entity entity) -> Math.hypot(entity.x() - player.x, entity.y() - player.y)).reversed();
                case "oldest" -> Comparator.comparing(DuelSimulationService::entityId);
                case "newest" -> Comparator.comparing(DuelSimulationService::entityId).reversed();
                default -> Comparator.comparingDouble(entity -> Math.hypot(entity.x() - player.x, entity.y() - player.y));
            };
            candidates.sort(comparator);
            int ordinal = Math.max(1, Math.min(100, Integer.parseInt(selector[2])));
            return candidates.size() >= ordinal ? candidates.get(ordinal - 1) : null;
        }
        if ("opponent".equals(target)) return opponent;
        String resolvedTarget = "my_core".equals(target) ? "core_" + player.slot
                : "opponent_core".equals(target) ? "core_" + opponent.slot
                : "defender_core".equals(target) ? "core_1" : target;
        if ("opponent_grenade".equals(target)) {
            return grenades.stream()
                    .filter(grenade -> opponent.userId.equals(grenade.ownerUserId()))
                    .findFirst()
                    .orElse(null);
        }
        if ("opponent_fireball".equals(target)) {
            return fireballs.stream()
                    .filter(fireball -> opponent.userId.equals(fireball.ownerUserId()))
                    .min(Comparator.comparingDouble(fireball -> Math.hypot(fireball.x() - player.x, fireball.y() - player.y)))
                    .orElse(null);
        }
        if ("my_grenade".equals(target)) return grenades.stream().filter(grenade -> player.userId.equals(grenade.ownerUserId())).findFirst().orElse(null);
        if ("my_fireball".equals(target)) return fireballs.stream().filter(fireball -> player.userId.equals(fireball.ownerUserId())).min(Comparator.comparingDouble(fireball -> Math.hypot(fireball.x() - player.x, fireball.y() - player.y))).orElse(null);
        if ("orbital_zone".equals(target)) {
            return obstacles.stream().filter(obstacle -> "orbitalMarker".equals(obstacle.type()))
                    .min(Comparator.comparingDouble(obstacle -> Math.hypot(obstacle.x() - player.x, obstacle.y() - player.y)))
                    .orElse(null);
        }
        Map<String, String> entityTypes = Map.ofEntries(
                Map.entry("opponent_concussive_shot", "concussiveShot"), Map.entry("opponent_proximity_mine", "proximityMine"),
                Map.entry("opponent_gravity_field", "gravityField"), Map.entry("opponent_hunter_drone", "hunterDrone"),
                Map.entry("opponent_orbital_zone", "orbitalMarker"), Map.entry("opponent_null_zone", "nullZone"),
                Map.entry("opponent_silence_wave", "silenceWave"), Map.entry("opponent_temporal_rewind_zone", "temporalRewindZone"), Map.entry("my_concussive_shot", "concussiveShot"), Map.entry("my_proximity_mine", "proximityMine"),
                Map.entry("my_gravity_field", "gravityField"), Map.entry("my_hunter_drone", "hunterDrone"),
                Map.entry("my_orbital_zone", "orbitalMarker"), Map.entry("my_null_zone", "nullZone"), Map.entry("my_silence_wave", "silenceWave"), Map.entry("my_temporal_rewind_zone", "temporalRewindZone"));
        if (entityTypes.containsKey(target)) {
            int ownerSlot = target.startsWith("my_") ? player.slot : opponent.slot;
            String ownerPrefix = "prototype:" + ownerSlot + ":";
            return obstacles.stream()
                    .filter(obstacle -> entityTypes.get(target).equals(obstacle.type()) && obstacle.id().startsWith(ownerPrefix))
                    .min(Comparator.comparingDouble(obstacle -> Math.hypot(obstacle.x() - player.x, obstacle.y() - player.y)))
                    .orElse(null);
        }
        return obstacles.stream()
                .filter(obstacle -> isPlaceableObstacleType(obstacle.type)
                        || WALL_CORE_TYPE.equals(obstacle.type)
                        || "core".equals(obstacle.type))
                .filter(obstacle -> obstacle.id.equals(resolvedTarget))
                .findFirst()
                .orElse(null);
    }

    private static List<Entity> matchingTargets(String target, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        String base = target == null ? "" : target.split(":", -1)[0];
        List<Entity> matches = new ArrayList<>();
        if ("opponent".equals(base)) {
            matches.add(opponent);
            return matches;
        }
        if ("opponent_grenade".equals(base)) grenades.stream().filter(entity -> opponent.userId.equals(entity.ownerUserId())).forEach(matches::add);
        else if ("opponent_fireball".equals(base)) fireballs.stream().filter(entity -> opponent.userId.equals(entity.ownerUserId())).forEach(matches::add);
        else if ("my_grenade".equals(base)) grenades.stream().filter(entity -> player.userId.equals(entity.ownerUserId())).forEach(matches::add);
        else if ("my_fireball".equals(base)) fireballs.stream().filter(entity -> player.userId.equals(entity.ownerUserId())).forEach(matches::add);
        else {
            Map<String, String> types = Map.ofEntries(Map.entry("orbital_zone", "orbitalMarker"), Map.entry("opponent_concussive_shot", "concussiveShot"),
                    Map.entry("opponent_proximity_mine", "proximityMine"), Map.entry("opponent_gravity_field", "gravityField"),
                    Map.entry("opponent_hunter_drone", "hunterDrone"), Map.entry("opponent_orbital_zone", "orbitalMarker"), Map.entry("opponent_null_zone", "nullZone"),
                    Map.entry("opponent_silence_wave", "silenceWave"), Map.entry("opponent_temporal_rewind_zone", "temporalRewindZone"), Map.entry("my_concussive_shot", "concussiveShot"), Map.entry("my_proximity_mine", "proximityMine"), Map.entry("my_gravity_field", "gravityField"),
                    Map.entry("my_hunter_drone", "hunterDrone"), Map.entry("my_orbital_zone", "orbitalMarker"), Map.entry("my_null_zone", "nullZone"), Map.entry("my_silence_wave", "silenceWave"), Map.entry("my_temporal_rewind_zone", "temporalRewindZone"));
            String type = types.get(base);
            if (type != null) obstacles.stream().filter(entity -> type.equals(entity.type())
                    && ("orbital_zone".equals(base) || entity.id().startsWith("prototype:" + (base.startsWith("my_") ? player.slot : opponent.slot) + ":"))).forEach(matches::add);
        }
        return matches;
    }

    private static double compassBearing(Entity from, Entity to) {
        return normalizeDegrees(Math.toDegrees(Math.atan2(to.x() - from.x(), from.y() - to.y())));
    }

    private static double compassRadians(double compassDegrees) { return Math.toRadians(compassDegrees - 90.0); }
    private static double vectorBearing(double dx, double dy) {
        return normalizeDegrees(Math.toDegrees(Math.atan2(dx, -dy)));
    }
    private static double clockwiseAngleDelta(double from, double to) { return normalizeDegrees(to - from); }
    private static Velocity entityVelocity(Entity entity) {
        if (entity instanceof Fighter fighter) return new Velocity(fighter.velocityX, fighter.velocityY);
        if (entity instanceof Grenade grenade) return new Velocity(grenade.velocityX(), grenade.velocityY());
        if (entity instanceof Fireball fireball) return new Velocity(fireball.velocityX(), fireball.velocityY());
        if (entity instanceof Obstacle obstacle) return new Velocity(obstacle.velocityX(), obstacle.velocityY());
        return null;
    }
    private static String entityId(Entity entity) {
        if (entity instanceof Grenade grenade) return grenade.id();
        if (entity instanceof Fireball fireball) return fireball.id();
        if (entity instanceof Obstacle obstacle) return obstacle.id();
        if (entity instanceof Fighter fighter) return fighter.userId.toString();
        return "";
    }

    private static Entity offsetTarget(Entity target, StrategyBlock block) {
        if (target == null || block == null) return target;
        return new TargetPoint(target.x() + block.targetOffsetX(), target.y() + block.targetOffsetY(), target.size());
    }

    private static int coreHp(List<Obstacle> obstacles, int slot) {
        return obstacles.stream().filter(obstacle -> obstacle.id.equals("core_" + slot)).mapToInt(Obstacle::hp).findFirst().orElse(0);
    }

    private static boolean canDash(Fighter fighter) {
        return hasAbility(fighter, "dash");
    }

    private static Vector movementVectorForAction(String action, Fighter player, Entity target, Arena arena) {
        if (player == null || "none".equals(action) || "move_stop".equals(action) || "rotate_toward_enemy".equals(action)
                || "swing".equals(action) || "block".equals(action) || "fire_gun".equals(action)
                || "throw_grenade".equals(action) || "shoot_fireball".equals(action) || "stun".equals(action)) {
            return new Vector(0, 0);
        }
        if ("move_center".equals(action)) {
            return new Vector(arena.width() / 2.0 - player.x, arena.height() / 2.0 - player.y);
        }
        switch (action) {
            case "move_north", "dash_north" -> {
                return new Vector(0.0, -1.0);
            }
            case "move_south", "dash_south" -> {
                return new Vector(0.0, 1.0);
            }
            case "move_east", "dash_east" -> {
                return new Vector(1.0, 0.0);
            }
            case "move_west", "dash_west" -> {
                return new Vector(-1.0, 0.0);
            }
            case "move_northeast", "dash_northeast" -> {
                return new Vector(Math.sqrt(0.5), -Math.sqrt(0.5));
            }
            case "move_northwest", "dash_northwest" -> {
                return new Vector(-Math.sqrt(0.5), -Math.sqrt(0.5));
            }
            case "move_southeast", "dash_southeast" -> {
                return new Vector(Math.sqrt(0.5), Math.sqrt(0.5));
            }
            case "move_southwest", "dash_southwest" -> {
                return new Vector(-Math.sqrt(0.5), Math.sqrt(0.5));
            }
            default -> {
            }
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
        return switch (action) {
            case "move_inward", "dash" -> inward;
            case "move_outward", "dash_outward" -> outward;
            case "move_tangent_left", "dash_tangent_left" -> tangentLeft;
            case "move_tangent_right", "dash_tangent_right" -> tangentRight;
            case "move_diagonal_in_left", "dash_diagonal_in_left" -> addVectors(inward, tangentLeft);
            case "move_diagonal_in_right", "dash_diagonal_in_right" -> addVectors(inward, tangentRight);
            case "move_diagonal_out_left", "dash_diagonal_out_left" -> addVectors(outward, tangentLeft);
            case "move_diagonal_out_right", "dash_diagonal_out_right" -> addVectors(outward, tangentRight);
            default -> new Vector(0, 0);
        };
    }

    private boolean applyAction(Fighter fighter, Action action, Arena arena) {
        CombatRules spec = combatRules(fighter);
        fighter.matchElapsedMs = Math.min(99_999_000L, fighter.matchElapsedMs + STEP_MS);
        if (fighter.hp <= 0) {
            fighter.attackActiveMs = Math.max(0, fighter.attackActiveMs - STEP_MS);
            fighter.gunActiveMs = Math.max(0, fighter.gunActiveMs - STEP_MS);
            fighter.fireballActiveMs = Math.max(0, fighter.fireballActiveMs - STEP_MS);
            fighter.stunActiveMs = Math.max(0, fighter.stunActiveMs - STEP_MS);
            fighter.blockActive = false;
            fighter.gunShotActive = false;
            fighter.stunCastActive = false;
            fighter.thrownGrenade = null;
            fighter.thrownFireball = null;
            fighter.prototypeTriggered = null;
            fighter.prototypeSpawn = null;
            fighter.dashActiveMs = 0;
            fighter.microDashActiveMs = 0;
            fighter.microDashRemaining = 0;
            fighter.movementVelocityX = 0;
            fighter.movementVelocityY = 0;
            fighter.velocityX = 0;
            fighter.velocityY = 0;
            fighter.entityHitIds.clear();
            return false;
        }
        boolean rewoundThisTick = false;
        fighter.slowedMs = Math.max(0, fighter.slowedMs - STEP_MS);
        fighter.movementLockMs = Math.max(0, fighter.movementLockMs - STEP_MS);
        if (fighter.shockRemainingMs > 0) {
            fighter.shockRemainingMs = Math.max(0, fighter.shockRemainingMs - STEP_MS);
            fighter.shockTickElapsedMs += STEP_MS;
            if (fighter.shockTickElapsedMs >= 1000) {
                fighter.shockTickElapsedMs -= 1000;
                applyDamage(fighter, 3);
                fighter.movementLockMs = 300;
            }
        }
        if (fighter.bleedRemainingMs > 0) {
            boolean tickDueBeforeOrAtExpiry = fighter.bleedTickMs <= fighter.bleedRemainingMs;
            fighter.bleedRemainingMs = Math.max(0, fighter.bleedRemainingMs - STEP_MS);
            fighter.bleedTickMs -= STEP_MS;
            if (tickDueBeforeOrAtExpiry && fighter.bleedTickMs <= 0) {
                applyDamage(fighter, 2);
                fighter.bleedTickMs += 1000;
            }
            if (fighter.bleedRemainingMs <= 0) fighter.bleedTickMs = 0;
        }
        if (fighter.temporalRewindMs > 0) {
            fighter.temporalRewindMs = Math.max(0, fighter.temporalRewindMs - STEP_MS);
            if (fighter.temporalRewindMs == 0) {
                fighter.x = fighter.temporalRewindX;
                fighter.y = fighter.temporalRewindY;
                fighter.hp = Math.min(fighter.maxHp, fighter.temporalRewindHp);
                fighter.temporalRewindPulseMs = 400;
                rewoundThisTick = true;
            }
        }
        fighter.temporalRewindPulseMs = Math.max(0, fighter.temporalRewindPulseMs - STEP_MS);
        int cooldownStepMs = STEP_MS;
        double attackCooldownMultiplier = 1.0 / fighter.attackSpeedMultiplier;
        double movementSpeedMultiplier = 1.0;
        fighter.attackCooldownMs = Math.max(0, fighter.attackCooldownMs - cooldownStepMs);
        fighter.attackActiveMs = Math.max(0, fighter.attackActiveMs - STEP_MS);
        rechargeBlock(fighter, spec, cooldownStepMs);
        boolean blockWasActive = fighter.blockActive;
        fighter.blockCooldownMs = Math.max(0, fighter.blockCooldownMs - STEP_MS);
        fighter.blockActive = false;
        boolean dashWasActive = fighter.dashActiveMs > 0;
        fighter.dashCooldownMs = Math.max(0, fighter.dashCooldownMs - cooldownStepMs);
        fighter.dashActiveMs = Math.max(0, fighter.dashActiveMs - STEP_MS);
        boolean dashEndedThisTick = dashWasActive && fighter.dashActiveMs == 0;
        fighter.microDashActiveMs = Math.max(0, fighter.microDashActiveMs - STEP_MS);
        fighter.gunCooldownMs = Math.max(0, fighter.gunCooldownMs - cooldownStepMs);
        fighter.gunActiveMs = Math.max(0, fighter.gunActiveMs - STEP_MS);
        reloadGun(fighter, spec, cooldownStepMs);
        fighter.gunShotActive = false;
        fighter.grenadeCooldownMs = Math.max(0, fighter.grenadeCooldownMs - cooldownStepMs);
        fighter.thrownGrenade = null;
        fighter.fireballCooldownMs = Math.max(0, fighter.fireballCooldownMs - cooldownStepMs);
        fighter.fireballActiveMs = Math.max(0, fighter.fireballActiveMs - STEP_MS);
        reloadFireballs(fighter, spec, cooldownStepMs);
        fighter.thrownFireball = null;
        fighter.stunCooldownMs = Math.max(0, fighter.stunCooldownMs - cooldownStepMs);
        fighter.stunActiveMs = Math.max(0, fighter.stunActiveMs - STEP_MS);
        fighter.stunCastActive = false;
        fighter.stunnedMs = Math.max(0, fighter.stunnedMs - STEP_MS);
        fighter.silencedMs = Math.max(0, fighter.silencedMs - STEP_MS);
        fighter.quickJabComboMs = Math.max(0, fighter.quickJabComboMs - STEP_MS);
        if (fighter.quickJabComboMs == 0) fighter.quickJabComboCount = 0;
        fighter.abilityCooldowns.replaceAll((id, value) -> Math.max(0, value - cooldownStepMs));
        fighter.abilityActiveMs.replaceAll((id, value) -> Math.max(0, value - STEP_MS));
        fighter.prototypeTriggered = null;
        fighter.entityHitIds.clear();
        fighter.prototypeSpawn = null;

        boolean swungThisTick = false;
        if (fighter.stunnedMs > 0) {
            if (blockWasActive) fighter.blockCooldownMs = BLOCK_REUSE_COOLDOWN_MS;
            fighter.preparingAbility = null;
            fighter.preparingMs = 0;
            fighter.preparingTargetX = Double.NaN;
            fighter.preparingTargetY = Double.NaN;
            fighter.dashActiveMs = 0;
            fighter.microDashActiveMs = 0;
            fighter.microDashRemaining = 0;
            fighter.movementVelocityX = 0.0;
            fighter.movementVelocityY = 0.0;
            fighter.velocityX = 0.0;
            fighter.velocityY = 0.0;
            return false;
        }
        if (fighter.preparingAbility != null && fighter.silencedMs <= 0 && !fighter.nullZoneSilenced) {
            action = new Action(action.dx(), action.dy(), action.dRot(), 0, 0, 0, 0, 0, 0,
                    action.dash(), fighter.preparingAbility, fighter.preparingTargetX, fighter.preparingTargetY);
        }
        double actionMagnitude = Math.hypot(action.dx(), action.dy());
        boolean dashAvailable = hasAbility(fighter, "dash") && fighter.dashCooldownMs <= 0;
        boolean isContinuingDash = fighter.dashActiveMs > 0;
        boolean isContinuingMicroDash = fighter.microDashActiveMs > 0 && fighter.microDashRemaining > 0;
        fighter.rotation = normalizeDegrees(fighter.rotation + clamp(action.dRot(), -1, 1) * TURN_SPEED_DEGREES);

        if (rewoundThisTick) {
            fighter.dashActiveMs = 0;
            fighter.microDashActiveMs = 0;
            fighter.microDashRemaining = 0;
            fighter.movementVelocityX = 0;
            fighter.movementVelocityY = 0;
            fighter.velocityX = 0;
            fighter.velocityY = 0;
        } else if (fighter.movementLockMs > 0) {
            fighter.dashActiveMs = 0;
            fighter.microDashActiveMs = 0;
            fighter.microDashRemaining = 0;
            fighter.movementVelocityX = 0;
            fighter.movementVelocityY = 0;
        } else if (dashEndedThisTick) {
            fighter.movementVelocityX = 0;
            fighter.movementVelocityY = 0;
            fighter.velocityX = 0;
            fighter.velocityY = 0;
        } else if (isContinuingMicroDash) {
            double stepDistance = Math.min(fighter.microDashStepDistance > 0 ? fighter.microDashStepDistance : 75, fighter.microDashRemaining);
            double beforeX = fighter.x, beforeY = fighter.y;
            moveFighter(fighter, fighter.microDashDirectionX, fighter.microDashDirectionY, stepDistance, arena);
            double traveled = Math.hypot(fighter.x - beforeX, fighter.y - beforeY);
            fighter.microDashRemaining = Math.max(0, fighter.microDashRemaining - traveled);
            fighter.movementVelocityX = fighter.microDashDirectionX * fighter.moveSpeed * movementSpeedMultiplier;
            fighter.movementVelocityY = fighter.microDashDirectionY * fighter.moveSpeed * movementSpeedMultiplier;
            if (traveled <= 0 || fighter.microDashRemaining <= 0) fighter.microDashActiveMs = 0;
        } else if (isContinuingDash) {
            fighter.movementVelocityX = fighter.dashDirectionX * fighter.moveSpeed * movementSpeedMultiplier;
            fighter.movementVelocityY = fighter.dashDirectionY * fighter.moveSpeed * movementSpeedMultiplier;
            moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED * movementSpeedMultiplier, arena);
        } else if (action.dash() > 0.5 && dashAvailable) {
            double radians = compassRadians(fighter.rotation);
            fighter.dashDirectionX = actionMagnitude > 0.001 ? action.dx() / actionMagnitude : Math.cos(radians);
            fighter.dashDirectionY = actionMagnitude > 0.001 ? action.dy() / actionMagnitude : Math.sin(radians);
            fighter.dashActiveMs = DASH_DURATION_MS;
            fighter.dashCooldownMs = spec.dashCooldownMs();
            fighter.movementVelocityX = fighter.dashDirectionX * fighter.moveSpeed * movementSpeedMultiplier;
            fighter.movementVelocityY = fighter.dashDirectionY * fighter.moveSpeed * movementSpeedMultiplier;
            moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED * movementSpeedMultiplier, arena);
        }

        if (!rewoundThisTick && !dashEndedThisTick && !isContinuingMicroDash && !isContinuingDash && fighter.dashActiveMs <= 0 && action.dash() <= 0.5) {
            Vector movementVelocity = nextMovementVelocity(fighter, action, actionMagnitude, fighter.moveSpeed * movementSpeedMultiplier);
            fighter.movementVelocityX = movementVelocity.dx();
            fighter.movementVelocityY = movementVelocity.dy();
            moveFighterByVelocity(fighter, movementVelocity.dx(), movementVelocity.dy(), arena);
        }
        if (action.block() > 0.5 && hasAbility(fighter, "block") && fighter.blockCharges > 0
                && (blockWasActive || fighter.blockCooldownMs <= 0)) {
            fighter.blockActive = true;
        }
        if (blockWasActive && !fighter.blockActive) fighter.blockCooldownMs = BLOCK_REUSE_COOLDOWN_MS;
        if (!fighter.blockActive && action.swing() > 0.5 && hasAbility(fighter, "swing") && fighter.attackCooldownMs <= 0) {
            fighter.attackActiveMs = ATTACK_ACTIVE_MS;
            fighter.attackCooldownMs = (int) Math.round(ATTACK_COOLDOWN_MS * attackCooldownMultiplier);
            swungThisTick = true;
        }
        if (!fighter.blockActive && action.gun() > 0.5 && hasAbility(fighter, "fire_gun")
                && fighter.gunAmmo > 0
                && fighter.gunReloadMs <= 0
                && fighter.gunCooldownMs <= 0 && fighter.gunActiveMs <= 0) {
            fighter.gunAmmo = Math.max(0, fighter.gunAmmo - 1);
            if (fighter.gunAmmo <= 0) {
                fighter.gunReloadMs = (int) Math.round(spec.gunReloadMs() * attackCooldownMultiplier);
            }
            fighter.gunActiveMs = spec.gunActiveMs();
            fighter.gunCooldownMs = (int) Math.round(spec.gunCooldownMs() * attackCooldownMultiplier);
            fighter.gunShotActive = true;
        }
        if (!fighter.blockActive && action.grenade() > 0.5 && hasAbility(fighter, "throw_grenade") && fighter.grenadeCooldownMs <= 0) {
            fighter.grenadeCooldownMs = (int) Math.round(spec.grenadeCooldownMs() * attackCooldownMultiplier);
            fighter.thrownGrenade = createGrenade(fighter);
            fighter.grenadeSerial += 1;
        }
        if (!fighter.blockActive && action.fireball() > 0.5 && fireballAvailable(fighter)) {
            fighter.fireballCharges = Math.max(0, fighter.fireballCharges - 1);
            if (fighter.fireballCharges <= 0) {
                fighter.fireballReloadMs = (int) Math.round(spec.fireballReloadMs() * attackCooldownMultiplier);
            }
            fighter.fireballActiveMs = spec.fireballActiveMs();
            fighter.fireballCooldownMs = (int) Math.round(spec.fireballCooldownMs() * attackCooldownMultiplier);
            fighter.thrownFireball = createFireball(fighter);
            fighter.fireballSerial += 1;
        }
        if (!fighter.blockActive && action.stun() > 0.5 && stunAvailable(fighter)) {
            fighter.stunActiveMs = spec.stunActiveMs();
            fighter.stunCooldownMs = (int) Math.round(spec.stunCooldownMs() * attackCooldownMultiplier);
            fighter.stunCastActive = true;
        }
        if (!fighter.blockActive && fighter.silencedMs <= 0 && !fighter.nullZoneSilenced && action.special() != null && PROTOTYPE_ACTIONS.contains(action.special())) {
            String ability = abilityForPrototypeAction(action.special());
            if (hasAbility(fighter, ability) && fighter.abilityCooldowns.getOrDefault(ability, 0) <= 0) {
                int windup = prototypeWindupMs(ability);
                if (windup > 0) {
                    boolean continuingPreparation = ability.equals(fighter.preparingAbility);
                    fighter.preparingMs = continuingPreparation ? fighter.preparingMs + STEP_MS : STEP_MS;
                    if (!continuingPreparation) {
                        fighter.preparingTargetX = action.specialTargetX();
                        fighter.preparingTargetY = action.specialTargetY();
                    }
                    fighter.preparingAbility = ability;
                    if (fighter.preparingMs >= windup) fighter.prototypeTriggered = action.special();
                } else fighter.prototypeTriggered = action.special();
                if (fighter.prototypeTriggered != null) {
                    fighter.prototypeTargetX = action.specialTargetX();
                    fighter.prototypeTargetY = action.specialTargetY();
                    fighter.preparingAbility = null;
                    fighter.preparingMs = 0;
                    fighter.preparingTargetX = Double.NaN;
                    fighter.preparingTargetY = Double.NaN;
                    fighter.abilityCooldowns.put(ability, (int) Math.round(PROTOTYPE_COOLDOWNS.getOrDefault(ability, 1000) * attackCooldownMultiplier));
                    fighter.abilityActiveMs.put(ability, prototypeDurationMs(ability));
                    if ("micro_dash".equals(ability)) startMicroDash(fighter, action.special(), action.specialTargetX(), action.specialTargetY(), arena);
                    if ("proximity_mine".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.proximityMine("mine-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, fighter.x, fighter.y, fighter.rotation);
                    } else if ("silence_pulse".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.silenceWave("silence-wave-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, fighter.x, fighter.y, fighter.rotation);
                    } else if ("gravity_grenade".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.gravityField("gravity-field-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, fighter.x, fighter.y, fighter.rotation);
                    } else if ("null_zone".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.nullZone("null-zone-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, clamp(action.specialTargetX(), 150, arena.width() - 150), clamp(action.specialTargetY(), 150, arena.height() - 150));
                    } else if ("hunter_drone".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.hunterDrone("hunter-drone-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, fighter.x, fighter.y, fighter.rotation);
                    } else if ("orbital_strike".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.orbitalMarker("orbital-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, action.specialTargetX(), action.specialTargetY());
                    } else if ("temporal_rewind".equals(ability)) {
                        fighter.prototypeSpawn = AbilityEntityFactory.temporalRewindZone("rewind-" + fighter.userId + "-" + fighter.grenadeSerial++, fighter.slot, fighter.x, fighter.y);
                    }
                }
            }
        } else if (fighter.preparingAbility != null && (fighter.silencedMs > 0 || fighter.nullZoneSilenced || fighter.stunnedMs > 0)) {
            fighter.preparingAbility = null;
            fighter.preparingMs = 0;
            fighter.preparingTargetX = Double.NaN;
            fighter.preparingTargetY = Double.NaN;
        }
        return swungThisTick;
    }

    private static String abilityForPrototypeAction(String action) {
        if (action == null) return "";
        if (action.startsWith("micro_dash")) return "micro_dash";
        if (action.startsWith("phase_strike")) return "phase_strike";
        return action;
    }

    private static int prototypeWindupMs(String ability) {
        return switch (ability) { case "heavy_slash" -> 300; case "concussive_shot" -> 500; case "repair_pulse" -> 800; case "rail_shot" -> 900; case "silence_pulse" -> 1000; case "null_zone" -> 1500; default -> 0; };
    }

    private static int prototypeDurationMs(String ability) {
        return switch (ability) { case "heavy_slash" -> 400; case "gravity_grenade", "silence_pulse" -> 2000; case "reactive_armor" -> 4000; case "hunter_drone" -> 6000; case "absolute_guard" -> 1500; case "null_zone" -> 5000; default -> 300; };
    }

    private static void startMicroDash(Fighter fighter, String action, double targetX, double targetY, Arena arena) {
        double angle = Double.isFinite(targetX) && Double.isFinite(targetY) ? Math.atan2(targetY - fighter.y, targetX - fighter.x) : compassRadians(fighter.rotation);
        double ux, uy;
        if (action.endsWith("_north")) { ux = 0; uy = -1; }
        else if (action.endsWith("_south")) { ux = 0; uy = 1; }
        else if (action.endsWith("_east")) { ux = 1; uy = 0; }
        else if (action.endsWith("_west")) { ux = -1; uy = 0; }
        else if (action.endsWith("_northeast")) { ux = Math.sqrt(0.5); uy = -Math.sqrt(0.5); }
        else if (action.endsWith("_northwest")) { ux = -Math.sqrt(0.5); uy = -Math.sqrt(0.5); }
        else if (action.endsWith("_southeast")) { ux = Math.sqrt(0.5); uy = Math.sqrt(0.5); }
        else if (action.endsWith("_southwest")) { ux = -Math.sqrt(0.5); uy = Math.sqrt(0.5); }
        else if (action.contains("_toward_") || action.contains("_away_")) {
            double radial = action.contains("_away_") ? -1 : 1, side = action.endsWith("right") ? 1 : -1;
            ux = (Math.cos(angle) * radial - Math.sin(angle) * side) * Math.sqrt(0.5);
            uy = (Math.sin(angle) * radial + Math.cos(angle) * side) * Math.sqrt(0.5);
        } else if (action.endsWith("outward")) { ux = -Math.cos(angle); uy = -Math.sin(angle); }
        else if (action.endsWith("left") || action.endsWith("right")) {
            double side = action.endsWith("right") ? 1 : -1;
            ux = -Math.sin(angle) * side; uy = Math.cos(angle) * side;
        } else { ux = Math.cos(angle); uy = Math.sin(angle); }
        double beforeX = fighter.x, beforeY = fighter.y;
        moveFighter(fighter, ux, uy, 75, arena);
        fighter.microDashDirectionX = ux;
        fighter.microDashDirectionY = uy;
        fighter.microDashRemaining = Math.max(0, 150 - Math.hypot(fighter.x - beforeX, fighter.y - beforeY));
        fighter.microDashStepDistance = 75;
        fighter.microDashActiveMs = 250;
    }

    private static void resolvePrototypeActions(Fighter attacker, Fighter defender, List<Obstacle> obstacles, Arena arena) {
        String action = attacker.prototypeTriggered;
        if (action == null || defender.hp <= 0) return;
        String ability = abilityForPrototypeAction(action);
        double dx = defender.x - attacker.x, dy = defender.y - attacker.y;
        double distance = Math.hypot(dx, dy);
        double bearing = vectorBearing(dx, dy);
        double facing = Math.abs(angleDelta(attacker.rotation, bearing));
        int damage = switch (ability) { case "quick_jab" -> Math.min(15, 8 + attacker.quickJabComboCount); case "pistol_shot" -> distance <= 500.0 / 3.0 ? 8 : distance <= 1000.0 / 3.0 ? 6 : 4; default -> (int) Math.round(contractEffectAmount(ability, EffectType.DAMAGE)); };
        double range = switch (ability) { case "heavy_slash" -> 92; case "quick_jab" -> 75; case "thrust" -> 110; case "phase_strike" -> 160; case "pistol_shot", "concussive_shot" -> 500; case "rail_shot" -> 900; case "repulsor_burst" -> 110; case "gravity_grenade" -> 120; default -> 0; };
        boolean rayAbility = Set.of("pistol_shot", "concussive_shot", "rail_shot").contains(ability);
        boolean direct = rayAbility
                ? rayIntersectsFighter(attacker, defender, range)
                : distance <= range + (Set.of("heavy_slash", "quick_jab", "thrust").contains(ability) ? defender.size / 2.0 : 0)
                    && (Set.of("repulsor_burst", "gravity_grenade", "proximity_mine", "phase_strike").contains(ability) || facing <= 28);
        boolean effectiveDirect = direct && !defender.ignoresHostileEffects();
        AbilityEntitySystem.ShieldResult shield = effectiveDirect
                ? resolveShield(defender, attacker.x, attacker.y, ability)
                : AbilityEntitySystem.ShieldResult.none();
        if (effectiveDirect && damage > 0) {
            if (!shield.prevents(EffectType.DAMAGE)) applyDamageFrom(attacker, defender, (int) Math.round(damage * attacker.attackDamageMultiplier));
            if ("heavy_slash".equals(ability) && defender.hp > 0 && !shield.prevents(EffectType.DEBUFF)) {
                boolean alreadyBleeding = defender.bleedRemainingMs > 0;
                defender.bleedRemainingMs = 5000;
                if (!alreadyBleeding) defender.bleedTickMs = 1000;
            }
            if ("quick_jab".equals(ability) && !shield.prevents(EffectType.DAMAGE)) {
                attacker.quickJabComboCount = Math.min(7, attacker.quickJabComboCount + 1);
                attacker.quickJabComboMs = 1000;
            }
        }
        if ("rail_shot".equals(ability) && effectiveDirect && defender.hp > 0 && !shield.prevents(EffectType.DEBUFF)) { defender.shockRemainingMs = 3000; defender.shockTickElapsedMs = 0; }
        if ("repair_pulse".equals(ability)) attacker.pendingHealing += (int) Math.round(contractEffectAmount(ability, EffectType.HEALING));
        if ("concussive_shot".equals(ability) && effectiveDirect && defender.hp > 0 && !shield.prevents(EffectType.DEBUFF)) defender.slowedMs = Math.max(defender.slowedMs, 2000);
        if ("repulsor_burst".equals(ability) && effectiveDirect && distance > 0) moveFighter(defender, dx / distance, dy / distance, contractEffectAmount(ability, EffectType.KNOCKBACK), arena);
        if ("thrust".equals(ability) && effectiveDirect && distance > 0) moveFighter(defender, dx / distance, dy / distance, contractEffectAmount(ability, EffectType.KNOCKBACK), arena);
        if ("temporal_rewind".equals(ability)) {
            attacker.temporalRewindX = attacker.x;
            attacker.temporalRewindY = attacker.y;
            attacker.temporalRewindHp = attacker.hp;
            attacker.temporalRewindMs = 3000;
            attacker.temporalRewindPulseMs = 0;
        }
        if ("phase_strike".equals(ability) && distance <= 160) {
            double originalRotation = attacker.rotation;
            attacker.x = clamp(defender.x + dx / Math.max(1, distance) * 50, attacker.size / 2.0, arena.width - attacker.size / 2.0);
            attacker.y = clamp(defender.y + dy / Math.max(1, distance) * 50, attacker.size / 2.0, arena.height - attacker.size / 2.0);
            if (!"phase_strike_keep_facing".equals(action)) {
                attacker.rotation = "phase_strike_mirror_facing".equals(action)
                        ? normalizeDegrees(2 * bearing - originalRotation)
                        : normalizeDegrees(bearing + 180);
            }
        }
        if (action.startsWith("micro_dash") && attacker.microDashActiveMs <= 0) {
            double amount = 150;
            double movementDx = Double.isFinite(attacker.prototypeTargetX) ? attacker.prototypeTargetX - attacker.x : dx;
            double movementDy = Double.isFinite(attacker.prototypeTargetY) ? attacker.prototypeTargetY - attacker.y : dy;
            double movementDistance = Math.max(1, Math.hypot(movementDx, movementDy));
            double ux, uy;
            if (action.endsWith("_north")) { ux = 0; uy = -1; }
            else if (action.endsWith("_south")) { ux = 0; uy = 1; }
            else if (action.endsWith("_east")) { ux = 1; uy = 0; }
            else if (action.endsWith("_west")) { ux = -1; uy = 0; }
            else if (action.endsWith("_northeast")) { ux = Math.sqrt(0.5); uy = -Math.sqrt(0.5); }
            else if (action.endsWith("_northwest")) { ux = -Math.sqrt(0.5); uy = -Math.sqrt(0.5); }
            else if (action.endsWith("_southeast")) { ux = Math.sqrt(0.5); uy = Math.sqrt(0.5); }
            else if (action.endsWith("_southwest")) { ux = -Math.sqrt(0.5); uy = Math.sqrt(0.5); }
            else if (action.contains("_toward_") || action.contains("_away_")) {
                double radial = action.contains("_away_") ? -1 : 1, side = action.endsWith("right") ? 1 : -1;
                ux = (movementDx / movementDistance * radial - movementDy / movementDistance * side) * Math.sqrt(0.5);
                uy = (movementDy / movementDistance * radial + movementDx / movementDistance * side) * Math.sqrt(0.5);
            }
            else if (action.endsWith("outward")) { ux = -movementDx / movementDistance; uy = -movementDy / movementDistance; }
            else if (action.endsWith("left") || action.endsWith("right")) {
                double side = action.endsWith("right") ? 1 : -1;
                ux = -movementDy / movementDistance * side;
                uy = movementDx / movementDistance * side;
            } else { ux = movementDx / movementDistance; uy = movementDy / movementDistance; }
            attacker.microDashDirectionX = ux;
            attacker.microDashDirectionY = uy;
            double beforeX = attacker.x, beforeY = attacker.y;
            moveFighter(attacker, ux, uy, 75, arena);
            double traveled = Math.hypot(attacker.x - beforeX, attacker.y - beforeY);
            attacker.microDashRemaining = Math.max(0, amount - traveled);
            attacker.microDashStepDistance = 75;
            attacker.microDashActiveMs = 250;
        }
    }

    private static boolean rayIntersectsFighter(Fighter attacker, Fighter defender, double range) {
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

    private List<ArenaEntity> updatePrototypePlacements(List<ArenaEntity> placements, List<Fighter> fighters,
                                                        Arena arena, List<Grenade> grenades,
                                                        List<GrenadeExplosion> grenadeExplosions, List<Fireball> fireballs) {
        return AbilityEntitySystem.tick(placements, fighters, new ArenaBounds(arena.width(), arena.height()), STEP_MS,
                new AbilityEntitySystem.Combat<>() {
                    @Override
                    public void damage(Fighter fighter, int amount) {
                        applyDamage(fighter, amount);
                    }

                    @Override
                    public void damageFromOwner(List<Fighter> activeFighters, int ownerSlot, Fighter target, int amount) {
                        Fighter owner = activeFighters.stream().filter(fighter -> fighter.slot == ownerSlot).findFirst().orElse(null);
                        if (owner != null) applyDamageFrom(owner, target, amount);
                        else applyDamage(target, amount);
                    }

                    @Override
                    public int damageToEntity(ArenaEntity entity, List<Fighter> activeFighters, List<ArenaEntity> activeEntities) {
                        return damageToDroneThisTick(entity, activeFighters, grenadeExplosions, fireballs, activeEntities);
                    }

                    @Override
                    public boolean entityHitByCurrentAttack(ArenaEntity entity, List<Fighter> activeFighters, List<ArenaEntity> activeEntities) {
                        boolean recordedHit = activeFighters.stream().anyMatch(fighter -> fighter.entityHitIds.contains(entity.id()));
                        return recordedHit || mineHitByCurrentAttack(entity, activeFighters, grenades, fireballs, activeEntities);
                    }

                    @Override
                    public AbilityEntitySystem.ShieldResult shield(Fighter fighter, double sourceX, double sourceY, String abilityId) {
                        return resolveShield(fighter, sourceX, sourceY, abilityId);
                    }
                });
    }

    private static boolean directionFallsInRange(double value, double start, double end) {
        double rawSpan = end - start;
        if (!Double.isFinite(value) || !Double.isFinite(start) || !Double.isFinite(end) || Math.abs(rawSpan) > 360) return false;
        double span = Math.abs(rawSpan) == 360 ? 360 : rawSpan >= 0 ? rawSpan : 360 + rawSpan;
        double distance = ((value - start) % 360 + 360) % 360;
        return distance <= span + 1e-9;
    }

    private int damageToDroneThisTick(ArenaEntity drone, List<Fighter> fighters, List<GrenadeExplosion> explosions,
                                      List<Fireball> fireballs, List<ArenaEntity> placements) {
        int damage = 0;
        for (Fighter fighter : fighters) {
            double distance = Math.hypot(drone.x() - fighter.x, drone.y() - fighter.y);
            double bearing = vectorBearing(drone.x() - fighter.x, drone.y() - fighter.y);
            double facing = Math.abs(angleDelta(fighter.rotation, bearing));
            if (fighter.attackActiveMs > 0 && distance <= combatRules(fighter).attackRange() + drone.size() / 2.0 && facing <= combatRules(fighter).attackArcDegrees()) damage += combatRules(fighter).attackDamage();
            if (fighter.gunShotActive && rayIntersectsCircle(fighter.x, fighter.y, Math.cos(compassRadians(fighter.rotation)), Math.sin(compassRadians(fighter.rotation)), combatRules(fighter).gunRange(), drone.x(), drone.y(), drone.size() / 2.0)) damage += combatRules(fighter).gunDamage(distance);
            if (fighter.stunCastActive && distance <= combatRules(fighter).stunRange() + drone.size() / 2.0 && facing <= combatRules(fighter).stunArcDegrees() / 2.0) damage += combatRules(fighter).stunDamage();
            String ability = abilityForPrototypeAction(fighter.prototypeTriggered);
            double range = switch (ability) { case "heavy_slash" -> 92; case "quick_jab" -> 75; case "thrust" -> 110; case "phase_strike" -> 160; case "pistol_shot", "concussive_shot" -> 500; case "rail_shot" -> 900; case "repulsor_burst" -> 110; default -> 0; };
            int abilityDamage = switch (ability) { case "heavy_slash" -> 30; case "quick_jab" -> Math.min(15, 8 + fighter.quickJabComboCount); case "repulsor_burst" -> 20; case "phase_strike" -> 14; case "pistol_shot" -> 6; case "concussive_shot" -> 8; case "rail_shot" -> 40; default -> 0; };
            boolean rayHit = Set.of("pistol_shot", "concussive_shot", "rail_shot").contains(ability) && rayIntersectsCircle(fighter.x, fighter.y, Math.cos(compassRadians(fighter.rotation)), Math.sin(compassRadians(fighter.rotation)), range, drone.x(), drone.y(), drone.size() / 2.0);
            boolean areaHit = Set.of("heavy_slash", "quick_jab", "thrust", "phase_strike", "repulsor_burst").contains(ability) && distance <= range + drone.size() / 2.0 && ("repulsor_burst".equals(ability) || facing <= 28);
            if (rayHit || areaHit) damage += abilityDamage;
        }
        for (Fireball fireball : fireballs) if (Math.hypot(fireball.x() - drone.x(), fireball.y() - drone.y()) <= (fireball.size() + drone.size()) / 2.0) damage += 15;
        for (GrenadeExplosion explosion : explosions) damage += combatRules(fighters.stream().filter(f -> f.userId.equals(explosion.ownerUserId())).findFirst().orElse(fighters.getFirst())).grenadeDamage(Math.hypot(explosion.x() - drone.x(), explosion.y() - drone.y()));
        for (ArenaEntity effect : placements) {
            double distance = Math.hypot(effect.x() - drone.x(), effect.y() - drone.y());
            if ("mineExplosion".equals(effect.type()) && distance <= effect.size() / 2.0 + drone.size() / 2.0) damage += 18;
            if ("gravityExplosion".equals(effect.type()) && distance <= effect.size() / 2.0 + drone.size() / 2.0) damage += 35;
            if ("orbitalExplosion".equals(effect.type()) && distance <= effect.size() / 2.0 + drone.size() / 2.0) damage += Math.round(50 * Math.max(0.25, 1 - distance / 130));
        }
        return damage;
    }

    private boolean mineHitByCurrentAttack(ArenaEntity mine, List<Fighter> fighters, List<Grenade> grenades,
                                                  List<Fireball> fireballs, List<ArenaEntity> placements) {
        if (grenades.stream().anyMatch(entity -> Math.hypot(entity.x() - mine.x(), entity.y() - mine.y()) <= (entity.size() + mine.size()) / 2.0)) return true;
        if (fireballs.stream().anyMatch(entity -> Math.hypot(entity.x() - mine.x(), entity.y() - mine.y()) <= (entity.size() + mine.size()) / 2.0)) return true;
        if (placements.stream().anyMatch(entity -> entity != mine && "silenceWave".equals(entity.type())
                && Math.hypot(entity.x() - mine.x(), entity.y() - mine.y()) <= (entity.size() + mine.size()) / 2.0)) return true;
        for (Fighter fighter : fighters) {
            if (fighter.gunShotActive && rayIntersectsCircle(fighter.x, fighter.y, Math.cos(compassRadians(fighter.rotation)), Math.sin(compassRadians(fighter.rotation)), combatRules(fighter).gunRange(), mine.x(), mine.y(), mine.size() / 2.0)) return true;
            String ability = fighter.prototypeTriggered;
            double range = switch (ability != null ? ability : "") { case "pistol_shot", "concussive_shot" -> 500; case "rail_shot" -> 900; default -> 0; };
            if (range > 0 && rayIntersectsCircle(fighter.x, fighter.y, Math.cos(compassRadians(fighter.rotation)), Math.sin(compassRadians(fighter.rotation)), range, mine.x(), mine.y(), mine.size() / 2.0)) return true;
        }
        return false;
    }

    private static void rechargeBlock(Fighter fighter, CombatRules spec, int stepMs) {
        if (!spec.canBlock()) {
            fighter.blockCharges = 0;
            fighter.blockRechargeMs = 0;
            return;
        }
        fighter.blockCharges = (int) clamp(fighter.blockCharges, 0, spec.blockMaxCharges());
        if (fighter.blockCharges >= spec.blockMaxCharges()) {
            fighter.blockRechargeMs = 0;
            return;
        }
        fighter.blockRechargeMs += stepMs;
        while (fighter.blockCharges < spec.blockMaxCharges() && fighter.blockRechargeMs >= spec.blockRechargeMs()) {
            fighter.blockCharges += 1;
            fighter.blockRechargeMs -= spec.blockRechargeMs();
        }
        if (fighter.blockCharges >= spec.blockMaxCharges()) fighter.blockRechargeMs = 0;
    }

    private static void reloadGun(Fighter fighter, CombatRules spec, int stepMs) {
        if (!spec.canFireGun()) {
            fighter.gunAmmo = 0;
            fighter.gunReloadMs = 0;
            return;
        }
        fighter.gunAmmo = (int) clamp(fighter.gunAmmo, 0, spec.gunAmmoMax());
        if (fighter.gunAmmo > 0) {
            fighter.gunReloadMs = 0;
            return;
        }
        fighter.gunReloadMs = Math.max(0, fighter.gunReloadMs - stepMs);
        if (fighter.gunReloadMs <= 0) {
            fighter.gunAmmo = spec.gunAmmoMax();
        }
    }

    private static void reloadFireballs(Fighter fighter, CombatRules spec, int stepMs) {
        if (!spec.canShootFireball()) {
            fighter.fireballCharges = 0;
            fighter.fireballReloadMs = 0;
            return;
        }
        fighter.fireballCharges = (int) clamp(fighter.fireballCharges, 0, spec.fireballChargesMax());
        if (fighter.fireballCharges > 0) {
            fighter.fireballReloadMs = 0;
            return;
        }
        fighter.fireballReloadMs = Math.max(0, fighter.fireballReloadMs - stepMs);
        if (fighter.fireballReloadMs <= 0) {
            fighter.fireballCharges = spec.fireballChargesMax();
        }
    }

    private boolean attackHits(Fighter attacker, Fighter defender) {
        CombatRules spec = combatRules(attacker);
        if (!hasAbility(attacker, "swing")) return false;
        if (Math.hypot(defender.x - attacker.x, defender.y - attacker.y) > spec.attackRange()) return false;
        double bearing = vectorBearing(defender.x - attacker.x, defender.y - attacker.y);
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.attackArcDegrees();
    }

    private static boolean blocksPoint(Fighter defender, double sourceX, double sourceY, double halfArcDegrees) {
        if (!defender.blockActive || defender.blockCharges <= 0) return false;
        double bearing = vectorBearing(sourceX - defender.x, sourceY - defender.y);
        return Math.abs(angleDelta(defender.rotation, bearing)) <= halfArcDegrees;
    }

    private static AbilityEntitySystem.ShieldResult resolveShield(Fighter fighter, double sourceX, double sourceY, String abilityId) {
        return resolveShield(fighter, sourceX, sourceY, abilityId, null);
    }

    private static AbilityEntitySystem.ShieldResult resolveShield(Fighter fighter, double sourceX, double sourceY, String abilityId, Integer chargeCost) {
        if (fighter.ignoresHostileEffects()) {
            return new AbilityEntitySystem.ShieldResult(true, EnumSet.allOf(EffectType.class));
        }
        var policy = AbilityContracts.get(abilityId).shieldInteraction();
        if (policy.mode() == ShieldMode.IGNORE || !fighter.blockActive || fighter.blockCharges <= 0) {
            return AbilityEntitySystem.ShieldResult.none();
        }
        if (policy.mode() == ShieldMode.BLOCK && !blocksPoint(fighter, sourceX, sourceY, policy.halfArcDegrees())) {
            return AbilityEntitySystem.ShieldResult.none();
        }
        int charges = chargeCost != null ? chargeCost
                : policy.chargeCost() == AbilityContracts.ChargeCost.ALL ? fighter.blockCharges : 1;
        consumeBlockCharges(fighter, charges);
        return new AbilityEntitySystem.ShieldResult(policy.mode() == ShieldMode.BLOCK, policy.prevents());
    }

    private static double contractEffectAmount(String abilityId, EffectType type) {
        return AbilityContracts.get(abilityId).effects().stream()
                .filter(effect -> effect.type() == type)
                .findFirst()
                .map(AbilityContracts.Effect::amount)
                .orElse(0.0);
    }

    private static void consumeBlockCharges(Fighter fighter, int charges) {
        fighter.blockCharges = Math.max(0, fighter.blockCharges - charges);
        if (fighter.blockCharges <= 0) {
            fighter.blockActive = false;
            fighter.blockCooldownMs = Math.max(fighter.blockCooldownMs, BLOCK_REUSE_COOLDOWN_MS);
        }
    }

    private int incomingAttackDamage(Fighter attacker, Fighter defender) {
        return (int) Math.round(combatRules(attacker).attackDamage()
                * fighterDamageMultiplier(attacker)
                * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1.0));
    }

    private boolean gunHits(Fighter attacker, Fighter defender, List<Obstacle> obstacles) {
        if (!attacker.gunShotActive) return false;
        CombatRules spec = combatRules(attacker);
        if (!spec.canFireGun()) return false;
        double radians = compassRadians(attacker.rotation);
        double forwardX = Math.cos(radians);
        double forwardY = Math.sin(radians);
        double rightX = -forwardY;
        double rightY = forwardX;
        double relX = defender.x - attacker.x;
        double relY = defender.y - attacker.y;
        double forwardDistance = relX * forwardX + relY * forwardY;
        double sideDistance = relX * rightX + relY * rightY;
        double defenderRadius = defender.size / 2.0;
        return forwardDistance >= 0
                && forwardDistance <= spec.gunRange() + defenderRadius
                && Math.abs(sideDistance) <= defenderRadius
                && !projectileWallBlocksSegment(attacker.x, attacker.y, defender.x, defender.y, 0, obstacles);
    }

    private boolean stunHits(Fighter attacker, Fighter defender) {
        if (!attacker.stunCastActive) return false;
        CombatRules spec = combatRules(attacker);
        if (!spec.canStun()) return false;
        double dx = defender.x - attacker.x;
        double dy = defender.y - attacker.y;
        double distance = Math.hypot(dx, dy);
        if (distance > spec.stunRange() + defender.size / 2.0) return false;
        double bearing = vectorBearing(dx, dy);
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.stunArcDegrees() / 2.0;
    }

    private void applyStun(Fighter attacker, Fighter defender) {
        if (defender.ignoresHostileEffects()) return;
        CombatRules spec = combatRules(attacker);
        applyDamage(defender, (int) Math.round(spec.stunDamage() * fighterDamageMultiplier(attacker)));
        if (defender.hp <= 0) return;
        defender.stunnedMs = Math.max(defender.stunnedMs, spec.stunDurationMs());
        defender.dashActiveMs = 0;
        defender.movementVelocityX = 0.0;
        defender.movementVelocityY = 0.0;
        defender.velocityX = 0.0;
        defender.velocityY = 0.0;
    }

    private static void applyDamage(Fighter target, int damage) {
        if (target.hp <= 0 || target.ignoresHostileEffects()) return;
        int previousHp = target.hp;
        int remaining = Math.max(0, damage);
        if (target.abilityActiveMs.getOrDefault("reactive_armor", 0) > 0) remaining = (int) Math.round(remaining * 0.5);
        if (target.shieldHp > 0 && remaining > 0) {
            int absorbed = Math.min(target.shieldHp, remaining);
            target.shieldHp -= absorbed;
            remaining -= absorbed;
        }
        if (remaining > 0) {
            target.hp = Math.max(0, target.hp - remaining);
        }
        target.damageTakenThisTick += Math.max(0, previousHp - target.hp);
        if (previousHp > 0 && target.hp <= 0) {
            clearFighterEffects(target);
        }
    }

    private static void applyDamageFrom(Fighter source, Fighter target, int damage) {
        boolean reflecting = source != null && source != target && target.abilityActiveMs.getOrDefault("reactive_armor", 0) > 0;
        applyDamage(target, damage);
        if (reflecting) applyDamage(source, (int) Math.round(Math.max(0, damage) * 0.5));
    }

    private static void clearFighterEffects(Fighter fighter) {
        fighter.shieldHp = 0;
        fighter.slowedMs = 0;
        fighter.silencedMs = 0;
        fighter.nullZoneSilenced = false;
        fighter.burnRemainingMs = 0;
        fighter.burnTickMs = 0;
        fighter.burnDamageMultiplier = 1.0;
        fighter.bleedRemainingMs = 0;
        fighter.bleedTickMs = 0;
        fighter.stunnedMs = 0;
        fighter.shockRemainingMs = 0;
        fighter.shockTickElapsedMs = 0;
        fighter.movementLockMs = 0;
        fighter.blockActive = false;
        fighter.blockActiveMs = 0;
        fighter.dashActiveMs = 0;
        fighter.microDashActiveMs = 0;
        fighter.microDashRemaining = 0;
        fighter.abilityActiveMs.clear();
        fighter.quickJabComboCount = 0;
        fighter.quickJabComboMs = 0;
        fighter.temporalRewindMs = 0;
        fighter.temporalRewindPulseMs = 0;
        fighter.pendingHealing = 0;
        fighter.damageZoneIds.clear();
        fighter.inDamageZone = false;
        fighter.defenseZoneEffectMs = 0;
        fighter.vanguardMs = 0;
        fighter.utilityHealAccumulatorMs = 0;
    }

    private static List<Obstacle> createDefenseObjective(Arena arena) {
        return List.of(
                new Obstacle("core_1", "core", arena.width() / 2.0, CORE_SIZE / 2.0, CORE_SIZE, 0, 0, CORE_HP),
                new Obstacle("defense_wall", DEFENSE_WALL_TYPE, arena.width() / 2.0, arena.height() / 4.0, arena.width(), 0, 0, 1),
                new Obstacle("wall_core_1", WALL_CORE_TYPE, arena.width() / 6.0, arena.height() / 3.0, WALL_CORE_SIZE, 0, 0, WALL_CORE_HP),
                new Obstacle("wall_core_2", WALL_CORE_TYPE, arena.width() / 2.0, arena.height() / 3.0, WALL_CORE_SIZE, 0, 0, WALL_CORE_HP),
                new Obstacle("wall_core_3", WALL_CORE_TYPE, arena.width() * 5.0 / 6.0, arena.height() / 3.0, WALL_CORE_SIZE, 0, 0, WALL_CORE_HP));
    }

    private void applyDefenseZone(List<Fighter> fighters, List<Obstacle> obstacles) {
        long destroyed = obstacles.stream().filter(obstacle -> WALL_CORE_TYPE.equals(obstacle.type) && obstacle.hp <= 0).count();
        double wallY = obstacles.stream().filter(obstacle -> DEFENSE_WALL_TYPE.equals(obstacle.type)).mapToDouble(Obstacle::y).findFirst().orElse(ARENA_HEIGHT_UNITS / 4.0);
        int ratePerSecond = destroyed == 0 ? 10 : destroyed == 1 ? 5 : 0;
        Fighter defender = fighters.stream().filter(fighter -> fighter.slot == 1).findFirst().orElse(null);
        Fighter attacker = fighters.stream().filter(fighter -> fighter.slot == 2).findFirst().orElse(null);
        if (defender != null && defender.hp > 0 && defender.y < wallY) {
            defender.defenseZoneEffectMs += STEP_MS;
            int amount = defender.defenseZoneEffectMs * ratePerSecond / 1000;
            if (amount > 0) {
                defender.hp = Math.min(combatRules(defender).maxHp(), defender.hp + amount);
                defender.defenseZoneEffectMs -= amount * 1000 / Math.max(1, ratePerSecond);
            }
        } else if (defender != null) {
            defender.defenseZoneEffectMs = 0;
        }
        if (attacker != null && attacker.hp > 0 && attacker.y < wallY) {
            attacker.defenseZoneEffectMs += STEP_MS;
            int amount = attacker.defenseZoneEffectMs * ratePerSecond / 1000;
            if (amount > 0) {
                applyDamage(attacker, amount);
                attacker.defenseZoneEffectMs -= amount * 1000 / Math.max(1, ratePerSecond);
            }
        } else if (attacker != null) {
            attacker.defenseZoneEffectMs = 0;
        }
    }

    private void applyProjectileWallHealing(List<Fighter> fighters, List<Obstacle> obstacles) {
        for (Fighter fighter : fighters) {
            boolean nearWall = obstacles.stream().filter(obstacle -> PROJECTILE_WALL_TYPE.equals(obstacle.type)).anyMatch(wall -> {
                double radians = compassRadians(wall.rotation);
                double offsetX = Math.cos(radians) * wall.size / 2.0;
                double offsetY = Math.sin(radians) * wall.size / 2.0;
                return pointToSegmentDistance(fighter.x, fighter.y, wall.x - offsetX, wall.y - offsetY, wall.x + offsetX, wall.y + offsetY)
                        <= PROJECTILE_WALL_HEAL_RANGE;
            });
            if (!nearWall || fighter.hp <= 0) { fighter.utilityHealAccumulatorMs = 0; continue; }
            fighter.utilityHealAccumulatorMs += STEP_MS;
            int heal = fighter.utilityHealAccumulatorMs * PROJECTILE_WALL_HEAL_PER_SECOND / 1000;
            if (heal > 0) {
                fighter.hp = Math.min(combatRules(fighter).maxHp(), fighter.hp + heal);
                fighter.utilityHealAccumulatorMs -= heal * 1000 / PROJECTILE_WALL_HEAL_PER_SECOND;
            }
        }
    }

    private List<Obstacle> applyWallCoreDamage(List<Obstacle> obstacles, Fighter attacker, boolean swung, boolean gunShot) {
        if (attacker.slot != 2 || attacker.hp <= 0 || (!swung && !gunShot && !attacker.stunCastActive)) return obstacles;
        List<Obstacle> next = new ArrayList<>();
        for (Obstacle obstacle : obstacles) {
            if (!WALL_CORE_TYPE.equals(obstacle.type) || obstacle.hp <= 0) { next.add(obstacle); continue; }
            int damage = swung && attackHitsObstacle(attacker, obstacle)
                    ? combatRules(attacker).attackDamage()
                    : gunShot && gunHitsObstacle(attacker, obstacle, obstacles)
                        ? combatRules(attacker).gunDamage(Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y))
                        : attacker.stunCastActive && stunHitsObstacle(attacker, obstacle) ? combatRules(attacker).stunDamage() : 0;
            next.add(damage > 0 ? obstacle.withHp(Math.max(0, obstacle.hp - (int) Math.round(damage * objectiveDamageMultiplier(attacker)))) : obstacle);
        }
        return next;
    }

    private static List<Obstacle> removeUnpoweredDefenseWall(List<Obstacle> obstacles) {
        long remaining = obstacles.stream().filter(obstacle -> WALL_CORE_TYPE.equals(obstacle.type) && obstacle.hp > 0).count();
        return remaining == 0 ? obstacles.stream().filter(obstacle -> !DEFENSE_WALL_TYPE.equals(obstacle.type)).toList() : obstacles;
    }

    private List<Obstacle> applyCoreDamage(List<Obstacle> obstacles, List<Fighter> fighters, Fighter attacker, boolean swung, boolean gunShot) {
        if (attacker.hp <= 0 || (!swung && !gunShot && !attacker.stunCastActive)) return obstacles;
        List<Obstacle> next = new ArrayList<>();
        for (Obstacle obstacle : obstacles) {
            if (!"core".equals(obstacle.type) || attacker.slot != 2 || obstacle.hp <= 0) {
                next.add(obstacle);
                continue;
            }
            int damage = swung && attackHitsObstacle(attacker, obstacle)
                    ? combatRules(attacker).attackDamage()
                    : gunShot && gunHitsObstacle(attacker, obstacle, obstacles)
                        ? combatRules(attacker).gunDamage(Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y))
                        : attacker.stunCastActive && stunHitsObstacle(attacker, obstacle) ? combatRules(attacker).stunDamage() : 0;
            if (damage <= 0) { next.add(obstacle); continue; }
            next.add(obstacle.withHp(Math.max(0, obstacle.hp - (int) Math.round(damage * objectiveDamageMultiplier(attacker) * coreDamageMultiplier(obstacles)))));
        }
        return next;
    }

    private static double coreDamageMultiplier(List<Obstacle> obstacles) {
        long destroyed = obstacles.stream().filter(candidate -> WALL_CORE_TYPE.equals(candidate.type) && candidate.hp <= 0).count();
        return destroyed == 0 ? 0.0 : destroyed == 1 ? 0.5 : destroyed == 2 ? 1.0 : 2.0;
    }

    private boolean stunHitsObstacle(Fighter attacker, Obstacle obstacle) {
        CombatRules spec = combatRules(attacker);
        double dx = obstacle.x - attacker.x;
        double dy = obstacle.y - attacker.y;
        if (!spec.canStun() || Math.hypot(dx, dy) > spec.stunRange() + obstacle.size / 2.0) return false;
        double bearing = vectorBearing(dx, dy);
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.stunArcDegrees() / 2.0;
    }

    private static Obstacle applyCoreHit(Obstacle core, List<Fighter> fighters, Fighter attacker, int baseDamage) {
        int ownerSlot = "core_1".equals(core.id) ? 1 : 2;
        Fighter owner = fighters.stream().filter(fighter -> fighter.slot == ownerSlot).findFirst().orElse(null);
        int damage = owner == null || owner.hp <= 0 ? (int) Math.round(baseDamage * 1.5) : baseDamage;
        if (owner != null && owner.hp > 0) applyDamage(attacker, (int) Math.round(baseDamage * 0.5));
        return core.withHp(Math.max(0, core.hp - damage));
    }

    private static void applyInhibitionOnHit(Fighter attacker, Fighter defender) {
        if (attacker.inhibitionCharges <= 0 || defender.ignoresHostileEffects()) return;
        attacker.inhibitionCharges -= 1;
        defender.slowedMs = INHIBITION_SLOW_MS;
    }

    private List<Obstacle> applyKillableBuffDamage(List<Obstacle> obstacles, Fighter attacker, boolean swungThisTick, boolean gunShotActive) {
        if (!swungThisTick && !gunShotActive && !attacker.stunCastActive) return obstacles;
        List<Obstacle> nextObstacles = new ArrayList<>();
        boolean consumedHit = false;
        for (Obstacle obstacle : obstacles) {
            if (!isBuffPickupType(obstacle.type) || obstacle.hp <= 0 || consumedHit) {
                nextObstacles.add(obstacle);
                continue;
            }
            int damage = 0;
            if (swungThisTick && attackHitsObstacle(attacker, obstacle)) {
                damage = combatRules(attacker).attackDamage();
            } else if (gunShotActive && gunHitsObstacle(attacker, obstacle, obstacles)) {
                damage = combatRules(attacker).gunDamage(Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y));
            } else if (attacker.stunCastActive && stunHitsObstacle(attacker, obstacle)) {
                damage = combatRules(attacker).stunDamage();
            }
            if (damage <= 0) {
                nextObstacles.add(obstacle);
                continue;
            }
            consumedHit = true;
            nextObstacles.addAll(damageKillableBuff(List.of(obstacle), obstacle.id, attacker, damage));
        }
        return nextObstacles;
    }

    private static List<Obstacle> damageKillableBuff(List<Obstacle> obstacles, String obstacleId, Fighter attacker, int damage) {
        if (attacker == null || damage <= 0) return obstacles;
        List<Obstacle> nextObstacles = new ArrayList<>();
        for (Obstacle obstacle : obstacles) {
            if (!obstacle.id.equals(obstacleId) || !isBuffPickupType(obstacle.type)) {
                nextObstacles.add(obstacle);
                continue;
            }
            int remainingHp = Math.max(0, obstacle.hp - damage);
            if (remainingHp <= 0) {
                applyBuffPickup(attacker, obstacle.type);
                nextObstacles.add(obstacle.withState(obstacle.usesRemaining, -BOOST_RESPAWN_MS));
            } else {
                nextObstacles.add(obstacle.withHp(remainingHp));
            }
        }
        return nextObstacles;
    }

    private List<Obstacle> applyGrenadeBuffDamage(List<Obstacle> obstacles, List<Fighter> fighters, List<GrenadeExplosion> explosions) {
        List<Obstacle> nextObstacles = obstacles;
        for (GrenadeExplosion explosion : explosions) {
            Fighter owner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(explosion.ownerUserId()))
                    .findFirst()
                    .orElse(null);
            if (owner == null) continue;
            for (Obstacle obstacle : nextObstacles) {
                if ("core".equals(obstacle.type) && owner.slot == 2) {
                    int damage = grenadeDamageToEntity(combatRules(owner), explosion, obstacle);
                    if (damage > 0) {
                        List<Obstacle> updated = new ArrayList<>();
                        int appliedDamage = (int) Math.round(damage * coreDamageMultiplier(nextObstacles));
                        for (Obstacle candidate : nextObstacles) updated.add(candidate.id.equals(obstacle.id) ? candidate.withHp(Math.max(0, candidate.hp - appliedDamage)) : candidate);
                        nextObstacles = updated;
                        break;
                    }
                }
                if (!isBuffPickupType(obstacle.type)) continue;
                int damage = grenadeDamageToEntity(combatRules(owner), explosion, obstacle);
                if (damage > 0) {
                    nextObstacles = damageKillableBuff(nextObstacles, obstacle.id, owner, damage);
                    break;
                }
            }
            for (Obstacle obstacle : nextObstacles) {
                if (!WALL_CORE_TYPE.equals(obstacle.type) || obstacle.hp <= 0) continue;
                int damage = grenadeDamageToEntity(combatRules(owner), explosion, obstacle);
                if (damage > 0) {
                    List<Obstacle> updated = new ArrayList<>();
                    for (Obstacle candidate : nextObstacles) updated.add(candidate.id.equals(obstacle.id) ? candidate.withHp(Math.max(0, candidate.hp - damage)) : candidate);
                    nextObstacles = updated;
                    break;
                }
            }
        }
        return nextObstacles;
    }

    private boolean attackHitsObstacle(Fighter attacker, Obstacle obstacle) {
        CombatRules spec = combatRules(attacker);
        if (!spec.canSwing()) return false;
        if (Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y) > spec.attackRange() + obstacle.size / 2.0) return false;
        double bearing = vectorBearing(obstacle.x - attacker.x, obstacle.y - attacker.y);
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.attackArcDegrees();
    }

    private boolean gunHitsObstacle(Fighter attacker, Obstacle obstacle, List<Obstacle> obstacles) {
        CombatRules spec = combatRules(attacker);
        if (!spec.canFireGun()) return false;
        double distance = Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y);
        if (distance > spec.gunRange()) return false;
        double bearing = vectorBearing(obstacle.x - attacker.x, obstacle.y - attacker.y);
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= Math.toDegrees(Math.atan2(obstacle.size / 2.0, Math.max(1.0, distance)))
                && !projectileWallBlocksSegment(attacker.x, attacker.y, obstacle.x, obstacle.y, 0, obstacles);
    }

    private int incomingGunDamage(Fighter attacker, Fighter defender) {
        double distance = Math.hypot(defender.x - attacker.x, defender.y - attacker.y);
        double damage = combatRules(attacker).gunDamage(distance);
        return (int) Math.round(damage * fighterDamageMultiplier(attacker) * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1.0));
    }

    private static double fighterDamageMultiplier(Fighter fighter) {
        return fighter.attackDamageMultiplier
                * (1.0 + fighter.assaultBoostStacks * 0.25)
                * (fighter.vanguardMs > 0 ? 1.25 : 1.0);
    }

    private static double objectiveDamageMultiplier(Fighter fighter) {
        return 1.0 + fighter.assaultBoostStacks * 0.25;
    }

    private static Grenade createGrenade(Fighter fighter) {
        double radians = compassRadians(fighter.rotation);
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double spawnDistance = fighter.size / 2.0 + GRENADE_SIZE / 2.0 + 2.0;
        return new Grenade(
                "grenade-" + fighter.userId + "-" + fighter.grenadeSerial,
                fighter.userId,
                fighter.x + directionX * spawnDistance,
                fighter.y + directionY * spawnDistance,
                GRENADE_SIZE,
                directionX * GRENADE_THROW_SPEED,
                directionY * GRENADE_THROW_SPEED,
                0,
                false,
                fighterDamageMultiplier(fighter));
    }

    private static Fireball createFireball(Fighter fighter) {
        double radians = compassRadians(fighter.rotation);
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double spawnDistance = fighter.size / 2.0 + FIREBALL_SIZE / 2.0 + 2.0;
        return new Fireball(
                "fireball-" + fighter.userId + "-" + fighter.fireballSerial,
                fighter.userId,
                fighter.x + directionX * spawnDistance,
                fighter.y + directionY * spawnDistance,
                FIREBALL_SIZE,
                directionX * FIREBALL_SPEED,
                directionY * FIREBALL_SPEED,
                0.0,
                false,
                fighterDamageMultiplier(fighter));
    }

    private static GrenadeUpdate updateGrenades(
            List<Grenade> grenades,
            List<Fighter> fighters,
            List<Obstacle> obstacles,
            Arena arena) {
        List<Grenade> remaining = new ArrayList<>();
        List<GrenadeExplosion> explosions = new ArrayList<>();
        List<Obstacle> nextObstacles = obstacles;
        for (Grenade grenade : grenades) {
            Grenade next = advanceGrenade(grenade, arena);
            if (projectileWallBlocksSegment(
                    grenade.x(), grenade.y(), next.x(), next.y(), next.size() / 2.0, obstacles)) {
                continue;
            }
            WallReflection wallReflection = findBouncyWallReflection(
                    grenade.x(), grenade.y(), next.velocityX(), next.velocityY(), next.size(), nextObstacles);
            if (wallReflection != null) {
                double speed = Math.hypot(next.velocityX(), next.velocityY()) * 1.25;
                double clearance = next.size() / 2.0 + PROJECTILE_WALL_THICKNESS / 2.0 + 0.1;
                next = new Grenade(
                        next.id(), next.ownerUserId(),
                        wallReflection.hitX() + wallReflection.outX() * clearance,
                        wallReflection.hitY() + wallReflection.outY() * clearance,
                        next.size(),
                        wallReflection.outX() * speed,
                        wallReflection.outY() * speed,
                        0,
                        true,
                        next.damageMultiplier() * 1.5);
                nextObstacles = consumeBouncyWall(nextObstacles, wallReflection.wall().id);
            }
            Grenade collisionGrenade = next;
            boolean touchedOpponent = fighters.stream()
                    .anyMatch(fighter -> fighter.projectileHittable() && (collisionGrenade.reflected()
                            || !fighter.userId.equals(collisionGrenade.ownerUserId()))
                            && overlapsShape(fighter, collisionGrenade, 0));
            boolean touchedDamageableObject = nextObstacles.stream()
                    .filter(obstacle -> obstacle.hp > 0)
                    .filter(obstacle -> isBuffPickupType(obstacle.type)
                            || WALL_CORE_TYPE.equals(obstacle.type)
                            || "core".equals(obstacle.type))
                    .anyMatch(obstacle -> overlapsShape(obstacle, collisionGrenade, 0));
            boolean stoppedLongEnough = Math.hypot(next.velocityX(), next.velocityY()) <= 0.001
                    && next.stoppedMs() >= GRENADE_STOP_FUSE_MS;
            if (touchedOpponent || touchedDamageableObject || stoppedLongEnough) {
                explosions.add(new GrenadeExplosion(
                        next.id() + "-explosion",
                        next.x(),
                        next.y(),
                        GRENADE_EXPLOSION_RADIUS * 2,
                        GRENADE_EXPLOSION_VISIBLE_MS,
                        next.ownerUserId(),
                        next.damageMultiplier()));
            } else {
                remaining.add(next);
            }
        }
        return new GrenadeUpdate(remaining, explosions, nextObstacles);
    }

    private static Grenade advanceGrenade(Grenade grenade, Arena arena) {
        double nextX = clamp(grenade.x() + grenade.velocityX(), GRENADE_SIZE / 2.0, arena.width() - GRENADE_SIZE / 2.0);
        double nextY = clamp(grenade.y() + grenade.velocityY(), GRENADE_SIZE / 2.0, arena.height() - GRENADE_SIZE / 2.0);
        boolean hitWall = nextX != grenade.x() + grenade.velocityX() || nextY != grenade.y() + grenade.velocityY();
        double velocityX = grenade.velocityX();
        double velocityY = grenade.velocityY();
        if (hitWall) {
            velocityX = 0.0;
            velocityY = 0.0;
        } else {
            double speed = Math.hypot(velocityX, velocityY);
            if (speed <= GRENADE_DECELERATION_PER_TICK) {
                velocityX = 0.0;
                velocityY = 0.0;
            } else {
                double nextSpeed = speed - GRENADE_DECELERATION_PER_TICK;
                velocityX = velocityX / speed * nextSpeed;
                velocityY = velocityY / speed * nextSpeed;
            }
        }
        int stoppedMs = Math.hypot(velocityX, velocityY) <= 0.001 ? grenade.stoppedMs() + STEP_MS : 0;
        return new Grenade(
                grenade.id(), grenade.ownerUserId(), nextX, nextY, grenade.size(),
                velocityX, velocityY, stoppedMs, grenade.reflected(), grenade.damageMultiplier());
    }

    private FireballUpdate updateFireballs(
            List<Fireball> fireballs,
            List<Fighter> fighters,
            List<Obstacle> obstacles,
            Arena arena) {
        List<Fireball> remaining = new ArrayList<>();
        List<FireballHit> hits = new ArrayList<>();
        List<Obstacle> nextObstacles = obstacles;
        for (Fireball fireball : fireballs) {
            Fireball next = advanceFireball(fireball);
            if (projectileWallBlocksSegment(
                    fireball.x(), fireball.y(), next.x(), next.y(), next.size() / 2.0, obstacles)) {
                continue;
            }
            WallReflection wallReflection = findBouncyWallReflection(
                    fireball.x(), fireball.y(), next.velocityX(), next.velocityY(), next.size(), nextObstacles);
            if (wallReflection != null) {
                double speed = Math.hypot(next.velocityX(), next.velocityY()) * 1.25;
                double clearance = next.size() / 2.0 + PROJECTILE_WALL_THICKNESS / 2.0 + 0.1;
                next = new Fireball(
                        next.id(), next.ownerUserId(),
                        wallReflection.hitX() + wallReflection.outX() * clearance,
                        wallReflection.hitY() + wallReflection.outY() * clearance,
                        next.size(),
                        wallReflection.outX() * speed,
                        wallReflection.outY() * speed,
                        next.traveled(),
                        true,
                        next.damageMultiplier() * 1.5);
                nextObstacles = consumeBouncyWall(nextObstacles, wallReflection.wall().id);
            }
            Fireball collisionFireball = next;
            Fighter fireballOwner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(collisionFireball.ownerUserId()))
                    .findFirst().orElse(null);
            Obstacle hitCore = fireballOwner == null ? null : nextObstacles.stream()
                    .filter(obstacle -> (WALL_CORE_TYPE.equals(obstacle.type)
                            || (fireballOwner.slot == 2 && "core".equals(obstacle.type)))
                            && obstacle.hp > 0 && overlapsShape(obstacle, collisionFireball, 0))
                    .findFirst().orElse(null);
            if (hitCore != null) {
                int damage = (int) Math.round(combatRules(fireballOwner).fireballDamage() * collisionFireball.damageMultiplier());
                List<Obstacle> updated = new ArrayList<>();
                int appliedDamage = "core".equals(hitCore.type)
                        ? (int) Math.round(damage * coreDamageMultiplier(nextObstacles)) : damage;
                for (Obstacle obstacle : nextObstacles) updated.add(obstacle.id.equals(hitCore.id) ? obstacle.withHp(Math.max(0, obstacle.hp - appliedDamage)) : obstacle);
                nextObstacles = updated;
                continue;
            }
            Obstacle hitBuff = nextObstacles.stream()
                    .filter(obstacle -> isBuffPickupType(obstacle.type) && overlapsShape(obstacle, collisionFireball, 0))
                    .findFirst()
                    .orElse(null);
            if (hitBuff != null) {
                Fireball buffHitFireball = next;
                Fighter owner = fighters.stream()
                        .filter(fighter -> fighter.userId.equals(buffHitFireball.ownerUserId()))
                        .findFirst()
                        .orElse(null);
                if (owner != null) {
                    nextObstacles = damageKillableBuff(nextObstacles, hitBuff.id, owner, (int) Math.round(combatRules(owner).fireballDamage() * buffHitFireball.damageMultiplier()));
                }
                continue;
            }
            Fighter hit = fighters.stream()
                    .filter(fighter -> fighter.projectileHittable() && (collisionFireball.reflected()
                            || !fighter.userId.equals(collisionFireball.ownerUserId()))
                            && overlapsShape(fighter, collisionFireball, 0))
                    .findFirst()
                    .orElse(null);
            if (hit != null) {
                hits.add(new FireballHit(next.ownerUserId(), hit.userId, next.damageMultiplier(), next.x(), next.y()));
            } else if (next.traveled() < combatCatalog.duelV1().fireballRange() && insideArena(next, arena)) {
                remaining.add(next);
            }
        }
        return new FireballUpdate(remaining, hits, nextObstacles);
    }

    private static Fireball advanceFireball(Fireball fireball) {
        double velocityX = fireball.velocityX();
        double velocityY = fireball.velocityY();
        return new Fireball(
                fireball.id(),
                fireball.ownerUserId(),
                fireball.x() + velocityX,
                fireball.y() + velocityY,
                fireball.size(),
                velocityX,
                velocityY,
                fireball.traveled() + Math.hypot(velocityX, velocityY),
                fireball.reflected(),
                fireball.damageMultiplier());
    }

    private static boolean insideArena(Entity entity, Arena arena) {
        return entity.x() >= -entity.size() && entity.x() <= arena.width() + entity.size()
                && entity.y() >= -entity.size() && entity.y() <= arena.height() + entity.size();
    }

    private GunReflection reflectGunShot(Fighter attacker, List<Fighter> fighters, List<Obstacle> obstacles) {
        if (!attacker.gunShotActive) return new GunReflection(false, null, obstacles);
        double radians = compassRadians(attacker.rotation);
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        WallReflection reflection = findBouncyWallReflection(
                attacker.x, attacker.y,
                directionX * combatRules(attacker).gunRange(),
                directionY * combatRules(attacker).gunRange(),
                0,
                obstacles);
        if (reflection == null) return new GunReflection(false, null, obstacles);
        double maxDistance = Math.max(0, combatRules(attacker).gunRange() - reflection.distance());
        Fighter target = fighters.stream()
                .map(fighter -> new FighterRayHit(
                        fighter,
                        rayCircleEntryDistance(
                                reflection.hitX() + reflection.outX() * (PROJECTILE_WALL_THICKNESS / 2.0 + 0.1),
                                reflection.hitY() + reflection.outY() * (PROJECTILE_WALL_THICKNESS / 2.0 + 0.1),
                                reflection.outX(),
                                reflection.outY(),
                                fighter.x,
                                fighter.y,
                                fighter.size / 2.0)))
                .filter(hit -> hit.distance() != null && hit.distance() <= maxDistance)
                .min(Comparator.comparingDouble(FighterRayHit::distance))
                .map(FighterRayHit::fighter)
                .orElse(null);
        return new GunReflection(true, target, consumeBouncyWall(obstacles, reflection.wall().id));
    }

    private void applyGunReflectionDamage(Fighter attacker, GunReflection reflection, List<Fighter> fighters) {
        if (!reflection.reflected() || reflection.target() == null) return;
        Fighter target = reflection.target();
        applyDamage(target, (int) Math.round(incomingGunDamage(attacker, target) * 1.5));
    }

    private static WallReflection findBouncyWallReflection(
            double x,
            double y,
            double velocityX,
            double velocityY,
            int projectileSize,
            List<Obstacle> obstacles) {
        double speed = Math.hypot(velocityX, velocityY);
        if (speed <= 0.000001) return null;
        double directionX = velocityX / speed;
        double directionY = velocityY / speed;
        return obstacles.stream()
                .filter(obstacle -> BOUNCY_WALL_TYPE.equals(obstacle.type))
                .map(wall -> {
                    double radians = compassRadians(wall.rotation);
                    double offsetX = Math.cos(radians) * wall.size / 2.0;
                    double offsetY = Math.sin(radians) * wall.size / 2.0;
                    Double distance = raySegmentIntersectionDistance(
                            x, y, directionX, directionY,
                            wall.x - offsetX, wall.y - offsetY,
                            wall.x + offsetX, wall.y + offsetY);
                    if (distance == null || distance > speed + projectileSize / 2.0) return null;
                    double normalX = -Math.sin(radians);
                    double normalY = Math.cos(radians);
                    if (directionX * normalX + directionY * normalY > 0) {
                        normalX *= -1;
                        normalY *= -1;
                    }
                    return new WallReflection(
                            wall,
                            distance,
                            x + directionX * distance,
                            y + directionY * distance,
                            normalX,
                            normalY);
                })
                .filter(reflection -> reflection != null)
                .min(Comparator.comparingDouble(WallReflection::distance))
                .orElse(null);
    }

    private static List<Obstacle> consumeBouncyWall(List<Obstacle> obstacles, String wallId) {
        return obstacles.stream()
                .map(obstacle -> obstacle.id.equals(wallId)
                        ? new Obstacle(
                                obstacle.id, obstacle.type, obstacle.x, obstacle.y, obstacle.size,
                                obstacle.rotation, obstacle.usesRemaining - 1)
                        : obstacle)
                .filter(obstacle -> !BOUNCY_WALL_TYPE.equals(obstacle.type) || obstacle.usesRemaining > 0)
                .toList();
    }

    private static Double raySegmentIntersectionDistance(
            double originX,
            double originY,
            double directionX,
            double directionY,
            double ax,
            double ay,
            double bx,
            double by) {
        double segmentX = bx - ax;
        double segmentY = by - ay;
        double denominator = directionX * segmentY - directionY * segmentX;
        if (Math.abs(denominator) <= 0.000001) return null;
        double offsetX = ax - originX;
        double offsetY = ay - originY;
        double distance = (offsetX * segmentY - offsetY * segmentX) / denominator;
        double segmentT = (offsetX * directionY - offsetY * directionX) / denominator;
        return distance >= 0 && segmentT >= 0 && segmentT <= 1 ? distance : null;
    }

    private static Double rayCircleEntryDistance(
            double originX,
            double originY,
            double directionX,
            double directionY,
            double centerX,
            double centerY,
            double radius) {
        double offsetX = centerX - originX;
        double offsetY = centerY - originY;
        double projection = offsetX * directionX + offsetY * directionY;
        double perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
        double radiusSquared = radius * radius;
        if (perpendicularSquared > radiusSquared) return null;
        double entry = projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
        return entry >= 0 ? entry : null;
    }

    private static boolean projectileWallBlocksSegment(
            double startX,
            double startY,
            double endX,
            double endY,
            double projectileRadius,
            List<Obstacle> obstacles) {
        return obstacles.stream()
                .filter(obstacle -> PROJECTILE_WALL_TYPE.equals(obstacle.type) || DEFENSE_WALL_TYPE.equals(obstacle.type))
                .anyMatch(wall -> {
                    double radians = compassRadians(wall.rotation);
                    double offsetX = Math.cos(radians) * wall.size / 2.0;
                    double offsetY = Math.sin(radians) * wall.size / 2.0;
                    return segmentDistance(
                            startX,
                            startY,
                            endX,
                            endY,
                            wall.x - offsetX,
                            wall.y - offsetY,
                            wall.x + offsetX,
                            wall.y + offsetY) <= projectileRadius + PROJECTILE_WALL_THICKNESS / 2.0;
                });
    }

    private static double segmentDistance(
            double ax, double ay, double bx, double by,
            double cx, double cy, double dx, double dy) {
        if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
        return Math.min(
                Math.min(pointToSegmentDistance(ax, ay, cx, cy, dx, dy),
                        pointToSegmentDistance(bx, by, cx, cy, dx, dy)),
                Math.min(pointToSegmentDistance(cx, cy, ax, ay, bx, by),
                        pointToSegmentDistance(dx, dy, ax, ay, bx, by)));
    }

    private static double pointToSegmentDistance(
            double px, double py, double ax, double ay, double bx, double by) {
        double dx = bx - ax;
        double dy = by - ay;
        double lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0.000001) return Math.hypot(px - ax, py - ay);
        double t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    private static boolean segmentsIntersect(
            double ax, double ay, double bx, double by,
            double cx, double cy, double dx, double dy) {
        double abC = cross(ax, ay, bx, by, cx, cy);
        double abD = cross(ax, ay, bx, by, dx, dy);
        double cdA = cross(cx, cy, dx, dy, ax, ay);
        double cdB = cross(cx, cy, dx, dy, bx, by);
        if (Math.abs(abC) <= 0.000001 && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
        if (Math.abs(abD) <= 0.000001 && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
        if (Math.abs(cdA) <= 0.000001 && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
        if (Math.abs(cdB) <= 0.000001 && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;
        return (abC > 0) != (abD > 0) && (cdA > 0) != (cdB > 0);
    }

    private static double cross(
            double ax, double ay, double bx, double by, double px, double py) {
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    }

    private static boolean isWallType(String type) {
        return PROJECTILE_WALL_TYPE.equals(type) || BOUNCY_WALL_TYPE.equals(type);
    }

    private static double snapWallRotation(Double rotation) {
        double value = rotation != null ? rotation : 0.0;
        return normalizeDegrees(Math.round(value / 45.0) * 45.0);
    }

    private static boolean pointOnSegment(
            double px, double py, double ax, double ay, double bx, double by) {
        return px >= Math.min(ax, bx) - 0.000001
                && px <= Math.max(ax, bx) + 0.000001
                && py >= Math.min(ay, by) - 0.000001
                && py <= Math.max(ay, by) + 0.000001;
    }

    private void applyFireballHits(List<Fighter> fighters, List<FireballHit> hits) {
        for (FireballHit hit : hits) {
            Fighter owner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(hit.ownerUserId()))
                    .findFirst()
                    .orElse(null);
            CombatRules ownerSpec = owner != null ? combatRules(owner) : combatCatalog.duelV1();
            for (Fighter fighter : fighters) {
                if (!fighter.userId.equals(hit.targetUserId())) continue;
                if (fighter.ignoresHostileEffects()) continue;
                var shield = resolveShield(fighter, hit.sourceX(), hit.sourceY(), "shoot_fireball");
                if (shield.prevents(EffectType.DAMAGE)) continue;
                applyDamage(fighter, (int) Math.round(ownerSpec.fireballDamage() * hit.damageMultiplier()));
                if (fighter.hp <= 0) continue;
                boolean alreadyBurning = fighter.burnRemainingMs > 0;
                fighter.burnRemainingMs = ownerSpec.fireballBurnDurationMs();
                if (!alreadyBurning) fighter.burnTickMs = ownerSpec.fireballBurnTickMs();
                fighter.burnDamageMultiplier = Math.max(fighter.burnDamageMultiplier, hit.damageMultiplier());
            }
        }
    }

    private void applyBurnDamage(List<Fighter> fighters) {
        for (Fighter fighter : fighters) {
            if (fighter.burnRemainingMs <= 0) {
                fighter.burnTickMs = 0;
                fighter.burnDamageMultiplier = 1.0;
                continue;
            }
            boolean tickDueBeforeOrAtExpiry = fighter.burnTickMs <= fighter.burnRemainingMs;
            fighter.burnRemainingMs = Math.max(0, fighter.burnRemainingMs - STEP_MS);
            fighter.burnTickMs = Math.max(0, fighter.burnTickMs - STEP_MS);
            if (tickDueBeforeOrAtExpiry && fighter.burnTickMs <= 0) {
                applyDamage(fighter, (int) Math.round(
                        combatCatalog.duelV1().fireballBurnDamage() * fighter.burnDamageMultiplier));
                fighter.burnTickMs = combatCatalog.duelV1().fireballBurnTickMs();
            }
            if (fighter.burnRemainingMs <= 0) {
                fighter.burnTickMs = 0;
                fighter.burnDamageMultiplier = 1.0;
            }
        }
    }

    private void applyGrenadeExplosions(List<Fighter> fighters, List<GrenadeExplosion> explosions) {
        for (GrenadeExplosion explosion : explosions) {
            Fighter owner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(explosion.ownerUserId()))
                    .findFirst()
                    .orElse(null);
            CombatRules ownerSpec = owner != null ? combatRules(owner) : combatCatalog.duelV1();
            for (Fighter fighter : fighters) {
            int shieldCharges = grenadeShieldChargesToFighter(explosion, fighter);
            if (shieldCharges > 0 && resolveShield(fighter, explosion.x(), explosion.y(), "throw_grenade", shieldCharges).prevents(EffectType.DAMAGE)) continue;
            int damage = grenadeDamageToFighter(ownerSpec, explosion, fighter);
            if (damage > 0) {
                applyDamage(fighter, damage);
            }
            }
        }
    }

    private static int grenadeDamageToFighter(CombatRules ownerSpec, GrenadeExplosion explosion, Fighter fighter) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(fighter.x - explosion.x(), fighter.y - explosion.y()) - fighter.size / 2.0);
        return (int) Math.round(ownerSpec.grenadeDamage(nearestBodyDistance) * explosion.damageMultiplier());
    }

    private static int grenadeDamageToEntity(CombatRules ownerSpec, GrenadeExplosion explosion, Entity entity) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(entity.x() - explosion.x(), entity.y() - explosion.y()) - entity.size() / 2.0);
        return (int) Math.round(ownerSpec.grenadeDamage(nearestBodyDistance) * explosion.damageMultiplier());
    }

    private static int grenadeShieldChargesToFighter(GrenadeExplosion explosion, Fighter fighter) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(fighter.x - explosion.x(), fighter.y - explosion.y()) - fighter.size / 2.0);
        if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
        double t = Math.max(0.0, Math.min(1.0, nearestBodyDistance / GRENADE_EXPLOSION_RADIUS));
        return (int) Math.max(1, Math.min(5, Math.round(5.0 + (1.0 - 5.0) * t)));
    }

    private List<Obstacle> applyObstacleEffects(List<Fighter> fighters, List<Obstacle> obstacles, Action firstAction, Action secondAction) {
        return obstacles;
    }

    private static Obstacle updateCenterObjectiveCapture(Obstacle obstacle, List<Fighter> fighters) {
        long occupants = fighters.stream().filter(fighter -> overlapsObstacle(fighter, obstacle)).count();
        if (occupants != 1) return obstacle.withCapture(0, 0);
        int slotOneMs = 0;
        int slotTwoMs = 0;
        for (Fighter fighter : fighters) {
            int nextMs = overlapsObstacle(fighter, obstacle)
                    ? Math.min(CENTER_OBJECTIVE_CAPTURE_MS, captureMsForSlot(obstacle, fighter.slot) + STEP_MS)
                    : 0;
            if (fighter.slot == 1) slotOneMs = nextMs;
            if (fighter.slot == 2) slotTwoMs = nextMs;
        }
        return obstacle.withCapture(slotOneMs, slotTwoMs);
    }

    private static int captureMsForSlot(Obstacle obstacle, int slot) {
        return slot == 1 ? obstacle.slotOneCaptureMs : slot == 2 ? obstacle.slotTwoCaptureMs : 0;
    }

    private static Fighter centerObjectiveCollector(Obstacle obstacle, List<Fighter> fighters) {
        if (obstacle.slotOneCaptureMs < CENTER_OBJECTIVE_CAPTURE_MS && obstacle.slotTwoCaptureMs < CENTER_OBJECTIVE_CAPTURE_MS) {
            return null;
        }
        int winningSlot = obstacle.slotOneCaptureMs >= CENTER_OBJECTIVE_CAPTURE_MS
                && obstacle.slotOneCaptureMs >= obstacle.slotTwoCaptureMs ? 1 : 2;
        return fighters.stream()
                .filter(fighter -> fighter.slot == winningSlot)
                .findFirst()
                .orElse(null);
    }

    private static void applyCenterObjective(Fighter collector) {
        collector.vanguardMs = VANGUARD_DURATION_MS;
        collector.shieldHp = Math.max(collector.shieldHp, 25);
    }

    private static void applyBuffPickup(Fighter collector, String type) {
        if (ASSAULT_BOOST_TYPE.equals(type)) collector.assaultBoostStacks += 1;
        else if (TEMPO_BOOST_TYPE.equals(type)) collector.tempoBoostStacks += 1;
        else if (MOBILITY_BOOST_TYPE.equals(type)) collector.mobilityBoostStacks += 1;
    }

    private static boolean isConsumablePickupType(String type) {
        return "healthPack".equals(type);
    }

    private static boolean isBuffPickupType(String type) {
        return isBoostType(type);
    }

    private static boolean isBoostType(String type) {
        return ASSAULT_BOOST_TYPE.equals(type) || TEMPO_BOOST_TYPE.equals(type) || MOBILITY_BOOST_TYPE.equals(type);
    }

    private static boolean isCenterObjectiveType(String type) {
        return VANGUARD_BEACON_TYPE.equals(type);
    }

    private static boolean isPlaceableObstacleType(String type) {
        return "healthPack".equals(type)
                || PROJECTILE_WALL_TYPE.equals(type)
                || isBuffPickupType(type)
                || isCenterObjectiveType(type);
    }

    private static List<Obstacle> createCenterObstacles(SeededRandom random, Arena arena) {
        List<Obstacle> obstacles = new ArrayList<>();
        obstacles.add(new Obstacle(
                "object_center",
                VANGUARD_BEACON_TYPE,
                arena.width() / 2.0,
                arena.height() / 2.0,
                CENTER_OBJECTIVE_SIZE,
                0.0,
                0,
                0));
        return obstacles;
    }

    private static List<Obstacle> normalizeRequestObstacles(List<ObstacleRequest> obstacles, Arena arena) {
        return obstacles.stream()
                .filter(obstacle -> isPlaceableObstacleType(obstacle.type()))
                .limit(MAX_ARENA_OBJECTS)
                .map(obstacle -> {
                    String type = obstacle.type();
                    int defaultSize = defaultObstacleSize(type);
                    int size = (int) clamp(obstacle.size() != null ? obstacle.size() : defaultSize, 16, 240);
                    return new Obstacle(
                            obstacle.id() != null ? obstacle.id() : "object_1",
                            type,
                            clamp(obstacle.x() != null ? obstacle.x() : arena.width() / 2.0, size / 2.0, arena.width() - size / 2.0),
                            clamp(obstacle.y() != null ? obstacle.y() : arena.height() / 2.0, size / 2.0, arena.height() - size / 2.0),
                            size,
                            isWallType(type) ? snapWallRotation(obstacle.rotation()) : 0.0,
                            "healthPack".equals(type) ? HEALTH_PACK_MAX_CLAIMS : isBoostType(type) ? 2 : 0,
                            isBoostType(type) ? BOOST_HP : 0);
                })
                .toList();
    }

    private static int defaultObstacleSize(String type) {
        if ("healthPack".equals(type)) return HEALTH_PACK_SIZE;
        if (isBuffPickupType(type)) return BUFF_PICKUP_SIZE;
        if (isCenterObjectiveType(type)) return CENTER_OBJECTIVE_SIZE;
        return PROJECTILE_WALL_LENGTH;
    }

    private static MatchPlaybackDTO.FighterPlacementDTO toPlacement(Fighter fighter) {
        return new MatchPlaybackDTO.FighterPlacementDTO(
                fighter.userId,
                fighter.username,
                fighter.slot,
                round(fighter.x),
                round(fighter.y),
                round(fighter.rotation),
                fighter.hp,
                fighter.combatClass,
                fighter.attackActiveMs > 0 || fighter.gunShotActive || fighter.fireballActiveMs > 0 || fighter.stunActiveMs > 0,
                fighter.blockActive,
                "mage".equals(fighter.combatClass) ? fighter.fireballCharges : fighter.gunAmmo,
                "mage".equals(fighter.combatClass) ? fighter.fireballReloadMs : fighter.gunReloadMs,
                fighter.shieldHp,
                fighter.slowedMs,
                fighter.stunnedMs,
                Math.max(fighter.silencedMs, fighter.nullZoneSilenced ? STEP_MS : 0),
                fighter.shockRemainingMs,
                fighter.movementLockMs,
                fighter.maxHp,
                fighter.abilities.stream().sorted().toList(),
                fighter.gunActiveMs > 0,
                fighter.attackActiveMs > 0,
                fighter.fireballActiveMs > 0,
                fighter.stunCastActive || fighter.stunActiveMs > 0,
                fighter.dashActiveMs > 0,
                fighter.fireballCharges,
                fighter.fireballReloadMs,
                fighter.attackCooldownMs,
                fighter.blockCharges,
                fighter.blockCooldownMs,
                fighter.blockRechargeMs,
                fighter.dashCooldownMs,
                fighter.gunCooldownMs,
                fighter.grenadeCooldownMs,
                fighter.fireballCooldownMs,
                fighter.stunCooldownMs,
                Map.copyOf(fighter.abilityCooldowns),
                Map.copyOf(fighter.abilityActiveMs),
                fighter.preparingAbility,
                fighter.preparingMs,
                fighter.burnRemainingMs,
                fighter.bleedRemainingMs,
                fighter.temporalRewindMs,
                round(fighter.temporalRewindX),
                round(fighter.temporalRewindY),
                fighter.temporalRewindPulseMs);
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Obstacle obstacle) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                obstacle.id,
                obstacle.type,
                round(obstacle.x),
                round(obstacle.y),
                obstacle.size,
                obstacle.rotation,
                obstacle.hp,
                obstacle.slotOneCaptureMs,
                obstacle.slotTwoCaptureMs);
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Grenade grenade) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                grenade.id(),
                "grenade",
                round(grenade.x()),
                round(grenade.y()),
                grenade.size(),
                0.0, 0, 0, 0, null, null,
                grenade.velocityX(), grenade.velocityY(), null);
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(GrenadeExplosion explosion) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                explosion.id(),
                "grenadeExplosion",
                round(explosion.x()),
                round(explosion.y()),
                explosion.size());
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(ArenaEntity placement) {
        double rotation = "hunterDrone".equals(placement.type()) || "silenceWave".equals(placement.type())
                ? vectorBearing(placement.velocityX(), placement.velocityY()) : 0;
        return new MatchPlaybackDTO.ObstaclePlacementDTO(placement.id(), placement.type(), round(placement.x()), round(placement.y()), placement.size(), rotation, placement.hp(), 0, 0, placement.armed(), placement.timerMs(), placement.velocityX(), placement.velocityY(), placement.shotVisualMs());
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Fireball fireball) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                fireball.id(),
                "fireball",
                round(fireball.x()),
                round(fireball.y()),
                fireball.size(),
                0.0, 0, 0, 0, null, null,
                fireball.velocityX(), fireball.velocityY(), null);
    }

    private static boolean overlapsObstacle(Fighter fighter, Obstacle obstacle) {
        return Math.hypot(fighter.x - obstacle.x, fighter.y - obstacle.y)
                <= ((fighter.size) + obstacle.size) / 2.0;
    }

    private static boolean overlapsShape(Entity first, Entity second, double padding) {
        return Math.hypot(first.x() - second.x(), first.y() - second.y())
                <= ((first.size()) + second.size()) / 2.0 + padding;
    }

    private static List<Obstacle> obstacleSlots(List<Obstacle> obstacles) {
        return obstacles.stream()
                .filter(obstacle -> isPlaceableObstacleType(obstacle.type))
                .sorted(Comparator.comparing(obstacle -> obstacle.id))
                .limit(MAX_ARENA_OBJECTS)
                .toList();
    }

    private static int comparePriorityEntries(PriorityEntry first, PriorityEntry second) {
        int clusterPriority = Integer.compare(first.clusterPriority(), second.clusterPriority());
        if (clusterPriority != 0) return clusterPriority;
        int blockPriority = Integer.compare(first.block().priority, second.block().priority);
        if (blockPriority != 0) return blockPriority;
        int clusterIndex = Integer.compare(first.clusterIndex(), second.clusterIndex());
        if (clusterIndex != 0) return clusterIndex;
        return Integer.compare(first.blockIndex(), second.blockIndex());
    }

    private static String actionHead(String action) {
        if ("variable".equals(action)) return "variable";
        if ("rotate_toward_enemy".equals(action)) return "rotation";
        if ("no_dash".equals(action) || action.startsWith("dash")) return "dash";
        return abilityKind(action).isEmpty() ? "movement" : "ability";
    }

    private static int normalizePriority(double value) {
        return (int) clamp(Math.round(Double.isFinite(value) ? value : 1.0), MIN_PRIORITY, MAX_PRIORITY);
    }

    private static String normalizeTarget(String target, String fallback) {
        if ("opponent".equals(target) || "my_core".equals(target) || "opponent_core".equals(target)
                || "defender_core".equals(target)
                || "orbital_zone".equals(target) || target.startsWith("opponent_")
                || "opponent_grenade".equals(target) || "opponent_fireball".equals(target)
                || OBJECT_TARGET.matcher(target).matches()) return target;
        return fallback;
    }

    private static JsonNode field(JsonNode node, String field) {
        return node != null && node.isObject() ? node.get(field) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber() ? node.asDouble() : fallback;
    }

    private static Operand normalizeOperand(JsonNode node) {
        if (node == null || !node.isObject()) return Operand.number(0.0);
        String type = textValue(node.get("type"), "number");
        if ("variable".equals(type)) {
            return Operand.variable(textValue(node.get("value"), ""));
        }
        if ("boolean".equals(type)) {
            return Operand.bool(booleanValue(node.get("value"), true));
        }
        return Operand.number(numberValue(node.get("value"), 0.0));
    }

    private static boolean booleanValue(JsonNode node, boolean fallback) {
        if (node == null) return fallback;
        if (node.isBoolean()) return node.asBoolean();
        if (node.isNumber()) return node.asInt() != 0;
        if (node.isTextual()) {
            String value = node.asText();
            if ("true".equalsIgnoreCase(value) || "1".equals(value)) return true;
            if ("false".equalsIgnoreCase(value) || "0".equals(value)) return false;
        }
        return fallback;
    }

    private static double edgeDistanceUnits(Entity entity, Arena arena) {
        double radius = entity.size() / 2.0;
        return Math.max(0, Math.min(
                Math.min(entity.x() - radius, arena.width() - radius - entity.x()),
                Math.min(entity.y() - radius, arena.height() - radius - entity.y())));
    }

    private static double turnTowardTarget(Fighter player, Entity target) {
        if (player == null || target == null) return 0;
        double bearing = vectorBearing(target.x() - player.x, target.y() - player.y);
        return clamp(angleDelta(player.rotation, bearing) / TURN_SPEED_DEGREES, -1, 1);
    }

    private static Vector addVectors(Vector first, Vector second) {
        return new Vector(first.dx() + second.dx(), first.dy() + second.dy());
    }

    private static void moveFighter(Fighter fighter, double dx, double dy, double speed, Arena arena) {
        double radius = fighter.size / 2.0;
        fighter.x = clamp(fighter.x + dx * speed, radius, arena.width() - radius);
        fighter.y = clamp(fighter.y + dy * speed, radius, arena.height() - radius);
        fighter.velocityX = dx * speed / (STEP_MS / 1000.0);
        fighter.velocityY = dy * speed / (STEP_MS / 1000.0);
    }

    private static Vector nextMovementVelocity(Fighter fighter, Action action, double actionMagnitude, double maxMoveSpeed) {
        Vector current = new Vector(fighter.movementVelocityX, fighter.movementVelocityY);
        if (!Double.isFinite(actionMagnitude) || actionMagnitude <= 0.001) {
            return new Vector(
                    decelerateVelocityComponent(current.dx(), MOVE_ACCELERATION_PER_TICK),
                    decelerateVelocityComponent(current.dy(), MOVE_ACCELERATION_PER_TICK));
        }

        double inputX = action.dx() / actionMagnitude;
        double inputY = action.dy() / actionMagnitude;
        return clampVelocity(new Vector(
                nextVelocityComponent(current.dx(), inputX),
                nextVelocityComponent(current.dy(), inputY)), maxMoveSpeed);
    }

    private static double nextVelocityComponent(double current, double input) {
        if (!Double.isFinite(current) || !Double.isFinite(input)) return 0.0;
        if (Math.abs(input) <= 0.001) {
            return decelerateVelocityComponent(current, MOVE_ACCELERATION_PER_TICK);
        }
        double acceleration = current * input < -0.001
                ? MOVE_BRAKE_ACCELERATION_PER_TICK
                : MOVE_ACCELERATION_PER_TICK;
        return current + input * acceleration;
    }

    private static double decelerateVelocityComponent(double value, double amount) {
        if (!Double.isFinite(value) || Math.abs(value) <= amount) return 0.0;
        return value > 0 ? value - amount : value + amount;
    }

    private static Vector clampVelocity(Vector velocity, double maxSpeed) {
        double speed = Math.hypot(velocity.dx(), velocity.dy());
        if (!Double.isFinite(speed) || speed <= maxSpeed) return velocity;
        return new Vector(velocity.dx() / speed * maxSpeed, velocity.dy() / speed * maxSpeed);
    }

    private static void moveFighterByVelocity(Fighter fighter, double velocityX, double velocityY, Arena arena) {
        double radius = fighter.size / 2.0;
        fighter.x = clamp(fighter.x + velocityX, radius, arena.width() - radius);
        fighter.y = clamp(fighter.y + velocityY, radius, arena.height() - radius);
        fighter.velocityX = velocityX / (STEP_MS / 1000.0);
        fighter.velocityY = velocityY / (STEP_MS / 1000.0);
    }

    private static double normalizeDegrees(double value) {
        return ((value % 360.0) + 360.0) % 360.0;
    }

    private static boolean rayIntersectsCircle(double originX, double originY, double directionX, double directionY,
                                               double range, double circleX, double circleY, double radius) {
        double offsetX = circleX - originX, offsetY = circleY - originY;
        double projection = offsetX * directionX + offsetY * directionY;
        double perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
        if (projection < -radius || perpendicularSquared > radius * radius) return false;
        double entryDistance = projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared));
        return Math.max(0, entryDistance) <= range;
    }

    private static boolean segmentIntersectsCircle(double startX, double startY, double endX, double endY,
                                                   double circleX, double circleY, double radius) {
        double dx = endX - startX, dy = endY - startY;
        double lengthSquared = dx * dx + dy * dy;
        double t = lengthSquared > 0 ? clamp(((circleX - startX) * dx + (circleY - startY) * dy) / lengthSquared, 0, 1) : 0;
        return Math.hypot(circleX - (startX + dx * t), circleY - (startY + dy * t)) <= radius;
    }

    private static double angleDelta(double from, double to) {
        return ((to - from + 540.0) % 360.0) - 180.0;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T value : values) {
            if (value != null) return value;
        }
        return null;
    }

    public record DuelSimulationRequest(
            UUID matchId,
            String rulesetVersion,
            long seed,
            DuelArenaRequest arena,
            List<DuelFighterRequest> fighters) {
    }

    public record DuelArenaRequest(
            int width,
            int height,
            int durationMs,
            List<ObstacleRequest> obstacles) {
    }

    public record DuelFighterRequest(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            Double rotation,
            int size,
            String selectedClass,
            JsonNode brain) {
    }

    public record ObstacleRequest(String id, String type, Double x, Double y, Integer size, Double rotation) {
        public ObstacleRequest(String id, String type, Double x, Double y, Integer size) {
            this(id, type, x, y, size, 0.0);
        }
    }

    private record Arena(int width, int height, int durationMs) {
    }

    private record Action(double dx, double dy, double dRot, double swing, double block, double gun, double grenade, double fireball, double stun, double dash, String special, double specialTargetX, double specialTargetY) {
    }

    private record Vector(double dx, double dy) {
    }

    private enum ValueType {
        NUMBER,
        BOOLEAN
    }

    private record StateValue(ValueType type, double numberValue, boolean booleanValue) {
        static StateValue number(double value) {
            return new StateValue(ValueType.NUMBER, value, false);
        }

        static StateValue bool(boolean value) {
            return new StateValue(ValueType.BOOLEAN, 0.0, value);
        }
    }

    private record Operand(String type, String valueText, double numberValue, boolean booleanValue) {
        static Operand variable(String value) {
            return new Operand("variable", value, 0.0, false);
        }

        static Operand number(double value) {
            return new Operand("number", "", value, false);
        }

        static Operand bool(boolean value) {
            return new Operand("boolean", "", 0.0, value);
        }

        StateValue toStateValue(ValueType expectedType) {
            return expectedType == ValueType.BOOLEAN
                    ? StateValue.bool(booleanValue)
                    : StateValue.number(numberValue);
        }
    }

    private record Condition(String type, double value, String target, String leftTarget, String rightTarget, String left, String ability, String comparator, Operand right, double rangeMin, double rangeMax, String join) {
    }

    private record StrategyBlock(int index, String action, String actionTarget, double targetOffsetX, double targetOffsetY, String targetMode, double targetX, double targetY, String movementMode, String movementDirection, String phaseFacingMode, JsonNode variableTerms, int priority, List<Condition> conditions) {
    }

    private record TargetPoint(double x, double y, int size) implements Entity {
    }

    private void applyCustomVariableAction(Fighter fighter, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs, Arena arena, StrategyBlock block) {
        String id = block.phaseFacingMode();
        String type = fighter.customVariableTypes.get(id);
        if (type == null || fighter.customVariableConditions.containsKey(id)) return;
        if ("boolean".equals(type)) {
            fighter.customVariables.put(id, block.targetOffsetX() != 0);
            return;
        }
        long current = ((Number) fighter.customVariables.getOrDefault(id, 0L)).longValue();
        JsonNode terms = block.variableTerms();
        if (terms == null || !terms.isArray() || terms.isEmpty()) {
            long amount = Math.round(block.targetOffsetX());
            long next = switch (block.movementDirection()) { case "add" -> current + amount; case "subtract" -> current - amount; default -> amount; };
            fighter.customVariables.put(id, Math.max(-CUSTOM_INTEGER_LIMIT, Math.min(CUSTOM_INTEGER_LIMIT, next)));
            return;
        }
        double next = "set".equals(textValue(field(terms.get(0), "operator"), "add")) ? 0 : current;
        Condition context = new Condition("expression", 0, "opponent", null, null, "", "", "eq", Operand.number(0), 0, 0, "and");
        for (JsonNode term : terms) {
            JsonNode operand = field(term, "operand");
            double amount = "variable".equals(textValue(field(operand, "type"), "number"))
                    ? java.util.Optional.ofNullable(resolveStateVariable(textValue(field(operand, "value"), ""), textValue(field(operand, "target"), "opponent"), context, fighter, opponent, obstacles, grenades, fireballs, arena)).map(StateValue::numberValue).orElse(0.0)
                    : numberValue(field(operand, "value"), 0);
            next += "subtract".equals(textValue(field(term, "operator"), "add")) ? -amount : amount;
        }
        fighter.customVariables.put(id, (long) Math.max(-CUSTOM_INTEGER_LIMIT, Math.min(CUSTOM_INTEGER_LIMIT, next)));
    }

    private record Velocity(double x, double y) {
    }

    private record TreeColumn(int index, double createdOrder, List<TreeBranch> branches) {
    }

    private record TreeBranch(String branchType, double createdOrder, List<StrategyBlock> blocks, List<TreeBranch> children) {
    }

    private record PriorityEntry(
            StrategyBlock block,
            int blockIndex,
            int clusterIndex,
            int clusterPriority,
            List<Condition> clusterConditions) {
    }

    private interface Entity {
        double x();

        double y();

        int size();
    }

    private static final class Fighter implements Entity, AbilityEntityCombatant {
        private UUID userId;
        private String username;
        private int slot;
        private double x;
        private double y;
        private double rotation;
        private int size;
        private String combatClass;
        private JsonNode brain;
        private Set<String> abilities = Set.of();
        private int hp;
        private long matchElapsedMs;
        private int maxHp;
        private double moveSpeed;
        private double attackDamageMultiplier = 1.0;
        private double attackSpeedMultiplier = 1.0;
        private double spawnX;
        private double spawnY;
        private int shieldHp;
        private int overdriveMs;
        private int barrierImmunityMs;
        private int inhibitionCharges;
        private int slowedMs;
        private int jammedMs;
        private int commandLockedMs;
        private Action commandLockAction;
        private int attackCooldownMs;
        private int attackActiveMs;
        private int blockCooldownMs;
        private int blockActiveMs;
        private int blockCharges;
        private int blockRechargeMs;
        private boolean blockActive;
        private int gunCooldownMs;
        private int gunActiveMs;
        private boolean gunShotActive;
        private int gunAmmo;
        private int gunReloadMs;
        private int grenadeCooldownMs;
        private int grenadeSerial = 1;
        private Grenade thrownGrenade;
        private int fireballCooldownMs;
        private int fireballActiveMs;
        private int fireballCharges;
        private int fireballReloadMs;
        private int fireballSerial = 1;
        private Fireball thrownFireball;
        private int burnRemainingMs;
        private int burnTickMs;
        private double burnDamageMultiplier = 1.0;
        private int stunCooldownMs;
        private int stunActiveMs;
        private boolean stunCastActive;
        private int stunnedMs;
        private int dashCooldownMs;
        private int dashActiveMs;
        private double dashDirectionX;
        private double dashDirectionY;
        private int microDashActiveMs;
        private double microDashRemaining;
        private double microDashStepDistance;
        private double microDashDirectionX;
        private double microDashDirectionY;
        private int shockRemainingMs;
        private int shockTickElapsedMs;
        private int movementLockMs;
        private double movementVelocityX;
        private double movementVelocityY;
        private double velocityX;
        private double velocityY;
        private List<String> damageZoneIds = new ArrayList<>();
        private boolean inDamageZone;
        private int defenseZoneEffectMs;
        private int assaultBoostStacks;
        private int tempoBoostStacks;
        private int mobilityBoostStacks;
        private int vanguardMs;
        private int utilityHealAccumulatorMs;
        private Map<String, Integer> abilityCooldowns = new HashMap<>();
        private Map<String, Integer> abilityActiveMs = new HashMap<>();
        private Map<String, Object> customVariables = new HashMap<>();
        private Map<String, String> customVariableTypes = new HashMap<>();
        private Map<String, JsonNode> customVariableConditions = new HashMap<>();
        private Set<String> resolvingCustomVariables = new HashSet<>();
        private String preparingAbility;
        private int preparingMs;
        private double preparingTargetX = Double.NaN;
        private double preparingTargetY = Double.NaN;
        private String prototypeTriggered;
        private final Set<String> entityHitIds = new HashSet<>();
        private ArenaEntity prototypeSpawn;
        private double prototypeTargetX = Double.NaN;
        private double prototypeTargetY = Double.NaN;
        private int silencedMs;
        private boolean nullZoneSilenced;
        private int quickJabComboCount;
        private int quickJabComboMs;
        private int bleedRemainingMs;
        private int bleedTickMs;
        private int pendingHealing;
        private int tickStartHp;
        private int damageTakenThisTick;
        private int damageTakenLastTick;
        private int hpNetChangeLastTick;
        private int temporalRewindMs;
        private double temporalRewindX;
        private double temporalRewindY;
        private int temporalRewindHp;
        private int temporalRewindPulseMs;

        @Override
        public double x() {
            return x;
        }

        @Override
        public double y() {
            return y;
        }

        @Override
        public int size() {
            return size;
        }

        @Override public int entitySlot() { return slot; }
        @Override public double entityX() { return x; }
        @Override public double entityY() { return y; }
        @Override public int entitySize() { return size; }
        @Override public int entityHp() { return hp; }
        private boolean alive() { return hp > 0; }
        private boolean projectileHittable() { return alive(); }
        @Override public boolean ignoresHostileEffects() { return !alive() || abilityActiveMs.getOrDefault("absolute_guard", 0) > 0; }
        @Override public void setEntityPosition(double x, double y) { if (!ignoresHostileEffects()) { this.x = x; this.y = y; } }
        @Override public void applySilence(int durationMs) { if (!ignoresHostileEffects()) silencedMs = Math.max(silencedMs, durationMs); }
        @Override public void setZoneSilenced(boolean silenced) { if (!silenced || !ignoresHostileEffects()) nullZoneSilenced = silenced; }
        @Override public void applyStun(int durationMs) { if (!ignoresHostileEffects()) stunnedMs = Math.max(stunnedMs, durationMs); }
        @Override public void cancelPreparation() { if (!ignoresHostileEffects()) { preparingAbility = null; preparingMs = 0; } }
    }

    private record Obstacle(
            String id,
            String type,
            double x,
            double y,
            int size,
            double rotation,
            int usesRemaining,
            int hp,
            int slotOneCaptureMs,
            int slotTwoCaptureMs,
            double velocityX,
            double velocityY) implements Entity {
        private Obstacle(String id, String type, double x, double y, int size, double rotation, int usesRemaining) {
            this(id, type, x, y, size, rotation, usesRemaining, 0, 0, 0, 0, 0);
        }

        private Obstacle(String id, String type, double x, double y, int size, double rotation, int usesRemaining, int hp) {
            this(id, type, x, y, size, rotation, usesRemaining, hp, 0, 0, 0, 0);
        }

        private Obstacle(String id, String type, double x, double y, int size, double rotation, int usesRemaining, double velocityX, double velocityY) {
            this(id, type, x, y, size, rotation, usesRemaining, 0, 0, 0, velocityX, velocityY);
        }

        private Obstacle withCapture(int slotOneCaptureMs, int slotTwoCaptureMs) {
            return new Obstacle(id, type, x, y, size, rotation, usesRemaining, hp, slotOneCaptureMs, slotTwoCaptureMs, velocityX, velocityY);
        }

        private Obstacle withHp(int hp) {
            return new Obstacle(id, type, x, y, size, rotation, usesRemaining, hp, slotOneCaptureMs, slotTwoCaptureMs, velocityX, velocityY);
        }

        private Obstacle withState(int usesRemaining, int hp) {
            return new Obstacle(id, type, x, y, size, rotation, usesRemaining, hp, slotOneCaptureMs, slotTwoCaptureMs, velocityX, velocityY);
        }
    }

    private record Grenade(
            String id,
            UUID ownerUserId,
            double x,
            double y,
            int size,
            double velocityX,
            double velocityY,
            int stoppedMs,
            boolean reflected,
            double damageMultiplier) implements Entity {
    }

    private record Fireball(
            String id,
            UUID ownerUserId,
            double x,
            double y,
            int size,
            double velocityX,
            double velocityY,
            double traveled,
            boolean reflected,
            double damageMultiplier) implements Entity {
    }

    private record GrenadeExplosion(
            String id,
            double x,
            double y,
            int size,
            int visibleMs,
            UUID ownerUserId,
            double damageMultiplier) implements Entity {
    }

    private record GrenadeUpdate(
            List<Grenade> grenades,
            List<GrenadeExplosion> explosions,
            List<Obstacle> obstacles) {
    }

    private record FireballHit(UUID ownerUserId, UUID targetUserId, double damageMultiplier, double sourceX, double sourceY) {
    }

    private record FireballUpdate(
            List<Fireball> fireballs,
            List<FireballHit> hits,
            List<Obstacle> obstacles) {
    }

    private record WallReflection(
            Obstacle wall,
            double distance,
            double hitX,
            double hitY,
            double outX,
            double outY) {
    }

    private record GunReflection(boolean reflected, Fighter target, List<Obstacle> obstacles) {
    }

    private record FighterRayHit(Fighter fighter, Double distance) {
    }

    private static final class ActionPlan {
        private StrategyBlock primary;
        private StrategyBlock movement;
        private StrategyBlock ability;
        private StrategyBlock dashMovement;
        private StrategyBlock rotation;
        private StrategyBlock swing;
        private StrategyBlock block;
        private StrategyBlock gun;
        private StrategyBlock grenade;
        private StrategyBlock fireball;
        private StrategyBlock stun;
        private StrategyBlock dash;
        private StrategyBlock special;
    }

    private static final class SeededRandom {
        private int state;

        private SeededRandom(String seedValue) {
            state = 0x811C9DC5;
            String seedText = seedValue != null ? seedValue : "";
            for (int index = 0; index < seedText.length(); index += 1) {
                state ^= seedText.charAt(index);
                state *= 16_777_619;
            }
        }

        private double next() {
            state += 0x6D2B79F5;
            int value = state;
            value = (value ^ (value >>> 15)) * (value | 1);
            value ^= value + ((value ^ (value >>> 7)) * (value | 61));
            long unsigned = Integer.toUnsignedLong(value ^ (value >>> 14));
            return unsigned / 4_294_967_296.0;
        }
    }
}
