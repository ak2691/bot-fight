package com.example.botfight.simulation;

import static com.example.botfight.simulation.geometry.AngleCalculator.vectorBearing;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.simulation.ecs.ArenaEntity;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Maps authoritative mutable simulation state into immutable replay DTOs. */
@Service
public class ReplayMappingService {
    MatchPlaybackDTO.BotStateDTO toBotState(DuelSimulationService.Bot bot) {
        return new MatchPlaybackDTO.BotStateDTO(
                bot.userId, bot.username, bot.slot,
                round(bot.x), round(bot.y), round(bot.rotation),
                bot.hp, bot.maxHp, bot.combatLoadout,
                bot.abilities.stream().sorted().toList(),
                bot.shieldHp, bot.slowedMs, bot.stunnedMs,
                Math.max(bot.silencedMs, bot.nullZoneSilenced ? 100 : 0),
                bot.shockRemainingMs, bot.movementLockMs,
                Map.copyOf(bot.abilityCooldowns), Map.copyOf(bot.abilityActiveMs),
                Map.copyOf(bot.abilityCharges), Map.copyOf(bot.abilityRechargeMs),
                bot.triggeredAbility,
                bot.preparingAbility, bot.preparingMs, bot.burnRemainingMs,
                bot.bleedRemainingMs, bot.temporalRewindMs,
                round(bot.temporalRewindX), round(bot.temporalRewindY),
                bot.temporalRewindPulseMs);
    }

    MatchPlaybackDTO.ArenaEntityDTO toArenaEntity(ArenaEntity entity) {
        double rotation = "hunterDrone".equals(entity.type())
                || "silenceWave".equals(entity.type())
                || "windburstProjectile".equals(entity.type())
                ? vectorBearing(entity.velocityX(), entity.velocityY()) : 0;
        return new MatchPlaybackDTO.ArenaEntityDTO(
                entity.id(), entity.type(), entity.abilityId(),
                round(entity.x()), round(entity.y()), entity.size(), rotation, entity.hp(), entity.armed(),
                entity.timerMs(), entity.velocityX(), entity.velocityY(), entity.shotVisualMs());
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }
}
