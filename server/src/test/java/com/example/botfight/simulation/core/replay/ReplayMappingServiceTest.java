package com.example.botfight.simulation.core.replay;

import com.example.botfight.simulation.core.orchestration.Bot;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.logic.ChainRuntime;
import com.example.botfight.DTO.match.MatchPlaybackDTO;
import java.util.ArrayList;
import tools.jackson.databind.json.JsonMapper;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import java.util.List;
import org.junit.jupiter.api.Test;
import com.example.botfight.simulation.core.state.LegacyAbility;

class ReplayMappingServiceTest {
    private final ReplayMappingService replayMappingService = new ReplayMappingService();

    @Test
    void chainSnapshotCarriesOnlyTheTopFrameAndClearsWhenTheStackEnds() {
        var bot = new Bot();
        bot.chainStack.add(new ChainRuntime.Frame("chain.punish"));
        var child = new ChainRuntime.Frame("chain.followup");
        child.path = new ArrayList<>(List.of(1, "then", 0, "body", 2));
        bot.chainStack.add(child);
        var snapshot = replayMappingService.toReplayFrame(100, List.of(bot), List.of()).bots().getFirst();
        assertThat(snapshot.runningChain().chainId()).isEqualTo("chain.followup");
        assertThat(snapshot.runningChain().path()).containsExactly(1, "then", 0, "body", 2);
        assertThat(snapshot.runningChain().callDepth()).isEqualTo(2);
        assertThat(snapshot.runningChain().name()).isEqualTo("chain.followup");

        var playback = new MatchPlaybackDTO(null, "duel-v1", "READY", null,
                List.of(new MatchPlaybackDTO.ReplayFrameDTO(1, 100,
                        List.of(replayMappingService.toBotState(bot)), List.of())), null, null, null);
        assertThat(MatchReplayDTO.from(playback).frames().getFirst().bots().getFirst().runningChain())
                .isEqualTo(snapshot.runningChain());
        child.path.set(0, 9);
        bot.chainStack.clear();
        assertThat(snapshot.runningChain().path()).containsExactly(1, "then", 0, "body", 2);
        var empty = replayMappingService.toReplayFrame(200, List.of(bot), List.of()).bots().getFirst();
        assertThat(empty.runningChain()).isNull();
        assertThat(JsonMapper.builder().build().writeValueAsString(empty)).doesNotContain("runningChain");
    }

    @Test
    void compactReplayPreservesZeroFacingAndDashDirection() {
        Bot bot = new Bot();
        bot.slot = 1;
        bot.rotation = 0;
        bot.hp = 100;
        bot.maxHp = 100;
        bot.dashDirectionX = -1;
        bot.dashDirectionY = 0;
        LegacyAbility.setActive(bot, 19, 300);

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
