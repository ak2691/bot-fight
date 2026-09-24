package com.example.botfight.simulation.core.replay;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import java.util.List;
import org.junit.jupiter.api.Test;

class ReplayMappingServiceTest {
    private final ReplayMappingService replayMappingService = new ReplayMappingService();

    @Test
    void compactReplayPreservesZeroFacingAndDashDirection() {
        DuelSimulationService.Bot bot = new DuelSimulationService.Bot();
        bot.slot = 1;
        bot.rotation = 0;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.dashDirectionX = -1;
        bot.dashDirectionY = 0;
        bot.abilityActiveMs.put(19, 300);

        MatchReplayDTO.ReplayBotDTO replayBot = replayMappingService
                .toReplayFrame(100, List.of(bot), List.of())
                .bots()
                .getFirst();

        assertThat(replayBot.rotation()).isEqualTo(0d);
        assertThat(replayBot.dashDirectionX()).isEqualTo(-1d);
        assertThat(replayBot.dashDirectionY()).isEqualTo(0d);
    }

    @Test
    void compactReplayCarriesThePhaseThatDeclaredAnEntityEvent() {
        var snare = AbilityEntityFactory.create(
                "snare-1", 29, 1, 100, 100, 60, 0, 1,
                Double.NaN, Double.NaN, 1_000, 800)
                .withPhase("triggered", true)
                .withEvent("trigger", "armed");

        MatchReplayDTO.ReplayEntityDTO replayEntity = replayMappingService
                .toReplayFrame(100, List.of(), List.of(snare))
                .entities()
                .getFirst();

        assertThat(replayEntity.phaseId()).isEqualTo("triggered");
        assertThat(replayEntity.eventType()).isEqualTo("trigger");
        assertThat(replayEntity.eventPhaseId()).isEqualTo("armed");
    }
}
