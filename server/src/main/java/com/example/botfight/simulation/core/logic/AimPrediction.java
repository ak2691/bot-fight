package com.example.botfight.simulation.core.logic;

import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Aim;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Entity;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.SelectableSnapshot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.StrategyBlock;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.TargetPoint;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.gameconfig.Abilities;

/**
 * Lead aim for Face Target and targeted ability actions. Mirrors the browser
 * {@code botlogic/planner/aimPrediction.js}: predicted point = target position + the target's
 * last-tick velocity x lead time, clamped to the arena. The default {@code current} aim
 * returns the target untouched, so brains without the setting behave exactly as before.
 */
public final class AimPrediction {
    /** One simulation step in seconds; displacement divided by this is a velocity per second. */
    public static final double TICK_SECONDS = 0.1;

    private AimPrediction() {}

    public static Entity leadTarget(Entity target, StrategyBlock block, Bot player, Arena arena) {
        if (target == null || block == null || block.aim() == null) return target;
        Aim aim = block.aim();
        if (!BotLogicContracts.AIM_LEAD.equals(aim.mode()) && !BotLogicContracts.AIM_AUTO.equals(aim.mode())) return target;
        double seconds = leadSeconds(aim, player, target);
        if (!(seconds > 0)) return target;
        double[] velocity = velocityPerSecond(target);
        double x = clamp(target.x() + velocity[0] * seconds, 0, arena.width());
        double y = clamp(target.y() + velocity[1] * seconds, 0, arena.height());
        return new TargetPoint(x, y, target.size());
    }

    /** Last-tick displacement of the target, per second. Bots use position change; entities their per-tick velocity. */
    static double[] velocityPerSecond(Entity target) {
        if (target instanceof Bot bot) {
            return new double[] {(bot.x - bot.movementStartX) / TICK_SECONDS, (bot.y - bot.movementStartY) / TICK_SECONDS};
        }
        if (target instanceof SelectableSnapshot snapshot) {
            return new double[] {snapshot.velocityX() / TICK_SECONDS, snapshot.velocityY() / TICK_SECONDS};
        }
        return new double[] {0.0, 0.0};
    }

    static double leadSeconds(Aim aim, Bot player, Entity target) {
        if (BotLogicContracts.AIM_LEAD.equals(aim.mode())) {
            return Math.max(0, Math.min(BotLogicContracts.MAX_LEAD_SECONDS, aim.leadSeconds()));
        }
        Integer abilityId = aim.leadAbilityId();
        if (abilityId == null || player == null) return 0;
        double speed = projectileSpeedPerSecond(abilityId);
        double distance = Math.hypot(target.x() - player.x, target.y() - player.y);
        double travel = speed > 0 && Double.isFinite(distance) ? distance / speed : 0;
        return windupRemainingSeconds(player, abilityId) + travel;
    }

    /** Remaining wind-up if the ability already started, otherwise its full wind-up. */
    static double windupRemainingSeconds(Bot player, int abilityId) {
        int preparingMs = AbilityState.windupRemainingMs(player, abilityId);
        double windupMs = preparingMs > 0 ? preparingMs : Abilities.windupMs(abilityId);
        return windupMs / 1000.0;
    }

    /** Projectile travel speed in units per second; 0 for hitscan, melee and non-projectile abilities. */
    static double projectileSpeedPerSecond(int abilityId) {
        AbilityContracts.EntityContract contract = AbilityContracts.entityAll().get(abilityId);
        if (contract == null || contract.category() != AbilityContracts.Category.PROJECTILE
                || contract.phases().isEmpty() || contract.phases().getFirst().movement() == null) return 0;
        double speedPerTick = contract.phases().getFirst().movement().speed();
        return speedPerTick > 0 ? speedPerTick / TICK_SECONDS : 0;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
