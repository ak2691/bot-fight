package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import com.example.botfight.service.simulation.WorkerResult;
import com.example.botfight.support.WorkerStub;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

class MatchSimulationServiceTest {

    @Test
    void buildsDuelRequestAndReturnsTheWorkerReplay() {
        SimWorkerClient worker = WorkerStub.answering();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), worker);
        UUID firstUserId = UUID.nameUUIDFromBytes("first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("second".getBytes());
        MatchSession session = session("match", firstUserId, secondUserId);
        BotSubmission firstSubmission = new BotSubmission();
        firstSubmission.setBrainPayload("""
                {"version":"bot-logic-tree-v1","roots":[{"priority":1,"branches":[{"priority":1,"branchType":"if","actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"conditions":[],"children":[]}]}]}
                """);

        MatchReplayDTO replay = service.buildDuelReplay(session, Map.of(firstUserId, firstSubmission));

        ArgumentCaptor<DuelSimulationRequest> captor = ArgumentCaptor.forClass(DuelSimulationRequest.class);
        verify(worker).simulate(captor.capture());
        DuelSimulationRequest request = captor.getValue();
        assertThat(replay.result()).isEqualTo("DRAW");
        assertThat(request.matchId()).isEqualTo(session.matchId());
        assertThat(request.rulesetVersion()).isEqualTo("duel-v1");
        assertThat(request.seed()).isEqualTo(99L);
        assertThat(request.arena().durationMs()).isEqualTo(90_000);
        assertThat(request.bots()).hasSize(2);
        assertThat(request.bots().getFirst().x()).isEqualTo(600.0);
        assertThat(request.bots().getFirst().y()).isEqualTo(150.0);
        assertThat(request.bots().getFirst().brain().get("roots")).hasSize(1);
    }

    @Test
    void workerFailureBecomesTheErrorReplayWithTheExistingMessage() {
        SimWorkerClient worker = mock(SimWorkerClient.class);
        when(worker.simulate(any())).thenThrow(new IllegalStateException("worker down"));
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), worker);
        UUID firstUserId = UUID.nameUUIDFromBytes("failed-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("failed-second".getBytes());

        MatchReplayDTO replay = service.buildDuelReplay(session("failed", firstUserId, secondUserId), Map.of());

        assertThat(replay.result()).isEqualTo("ERROR");
        assertThat(replay.message()).isEqualTo("Bot simulation failed: IllegalStateException");
        assertThat(replay.initialState().bots()).hasSize(2);
        assertThat(replay.frames()).isEmpty();
    }

    @Test
    void workerReplayIsReturnedUnchanged() {
        SimWorkerClient worker = mock(SimWorkerClient.class);
        MatchReplayDTO workerReplay = new MatchReplayDTO(
                new MatchReplayDTO.ReplayInitialStateDTO(List.of()),
                List.of(),
                "BOT_WIN",
                UUID.nameUUIDFromBytes("winner".getBytes()),
                "Blue wins.",
                null,
                null,
                null);
        when(worker.simulate(any())).thenReturn(new WorkerResult("test", workerReplay, null));
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), worker);
        UUID firstUserId = UUID.nameUUIDFromBytes("win-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("win-second".getBytes());

        assertThat(service.buildDuelReplay(session("win", firstUserId, secondUserId), Map.of()))
                .isSameAs(workerReplay);
    }

    private static MatchSession session(String name, UUID firstUserId, UUID secondUserId) {
        return new MatchSession(
                UUID.nameUUIDFromBytes(("match-" + name).getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, true, UUID.randomUUID(), 0, "ranged", true),
                        new MatchPlayer(secondUserId, "Two", "two", 2, true, UUID.randomUUID(), 0, "melee", true)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(),
                Map.of());
    }
}
