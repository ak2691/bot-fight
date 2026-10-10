package com.example.botfight.service.match;

import com.example.botfight.service.match.MatchTimingPolicy;

import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.support.WorkerReplayFixtures;
import java.util.Set;
import org.mockito.ArgumentCaptor;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.MatchSimulationService;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.simulation.SimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.*;
import com.example.botfight.service.simulation.WorkerReplay;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
class MatchSimulationServiceTest {
    @Test void workerWinnerAndFailureUseExistingResultAndRetryEnvelopes() {
        var worker=mock(SimWorkerClient.class);
        var service=new MatchSimulationService(new JsonMapper(),worker);
        var first=UUID.randomUUID(); var second=UUID.randomUUID(); var now=Instant.now();
        var session=new MatchSession(
                UUID.randomUUID(),
                Long.MAX_VALUE,
                List.of(
                new MatchPlayer(first, "One", "one", 1, 1 <= 2 ? 1 : 1, true, UUID.randomUUID(), 0, "custom:s", true, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null),
                new MatchPlayer(second, "Two", "two", 2, 2 <= 2 ? 2 : 1, true, UUID.randomUUID(), 0, "custom:s", true, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null)),
                now,
                now,
                now,
                1,
                null,
                null,
                null,
                null,
                false,
                MatchMode.ONES,
                MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS,
                MatchTimingPolicy.DEFAULT_INCREMENT_SECONDS,
                Set.of(),
                List.of(), com.example.botfight.service.match.state.MatchPhase.BUILDING);
        var raw=WorkerReplayFixtures.replay(session,"BOT_WIN",second,List.of(100)).workerReplay();
        when(worker.simulate(any(),isNull())).thenReturn(raw);
        assertThat(service.buildDuelReplay(session,Map.of()).winnerUserId()).isEqualTo(second);
        var request=ArgumentCaptor.forClass(DuelSimulationRequest.class);
        verify(worker).simulate(request.capture(),isNull());
        assertThat(request.getValue().seed()).isEqualTo(Long.MAX_VALUE);
        assertThat(request.getValue().segments()).hasSize(6);
        assertThat(request.getValue().bots()).extracting(DuelBotRequest::x,DuelBotRequest::y)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(600.0,150.0),org.assertj.core.groups.Tuple.tuple(600.0,1050.0));
        when(worker.simulate(any(),isNull())).thenThrow(new IllegalStateException("unavailable"));
        assertThat(service.buildDuelReplay(session,Map.of()).result()).isEqualTo("ERROR");
        assertThatThrownBy(()->new MatchSimulationService(new JsonMapper(), null)).isInstanceOf(NullPointerException.class);
    }
    private static BotSubmission brainSubmission(String loadout, List<String> variableResets, String marker) {
        BotSubmission submission = new BotSubmission();
        submission.setSelectedLoadout(loadout);
        submission.setBrainPayload("{\"version\":\"bot-logic-tree-v2\",\"marker\":\"" + marker
                + "\",\"loadout\":{\"abilities\":[1]},\"roots\":[]}");
        submission.setVariableResets(variableResets);
        return submission;
    }

    @Test
    void buildsTheSegmentRequestFromEveryRoundsStoredBrainsAndRecordsOnlyTheCurrentSegment() {
        CapturingWorker duelSimulationService = new CapturingWorker();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), duelSimulationService);
        UUID firstUserId = UUID.nameUUIDFromBytes("seg-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("seg-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("seg-match".getBytes()),
                77L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, 1 <= 2 ? 1 : 1, true, UUID.randomUUID(), 0, "custom:s", true, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null),
                        new MatchPlayer(secondUserId, "Two", "two", 2, 2 <= 2 ? 2 : 1, true, UUID.randomUUID(), 0, "custom:s", true, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                3,
                null,
                null,
                null,
                null,
                false,
                MatchMode.ONES,
                MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS,
                MatchTimingPolicy.DEFAULT_INCREMENT_SECONDS,
                Set.of(),
                List.of(), com.example.botfight.service.match.state.MatchPhase.BUILDING);
        Map<Integer, Map<UUID, BotSubmission>> rounds = Map.of(
                1, Map.of(firstUserId, brainSubmission("custom:s", List.of(), "one-r1"),
                        secondUserId, brainSubmission("custom:s", List.of(), "two-r1")),
                2, Map.of(firstUserId, brainSubmission("custom:sr", List.of("custom.a"), "one-r2")),
                3, Map.of(firstUserId, brainSubmission("custom:srg", List.of("Counter", "custom.b"), "one-r3"),
                        secondUserId, brainSubmission("custom:sf", List.of(), "two-r3")));

        MatchReplayDTO replay = service.buildDuelReplay(session, rounds);

        assertThat(replay).isNotNull();
        DuelSimulationRequest request = duelSimulationService.capturedRequest;
        assertThat(request.rulesetVersion()).isEqualTo("duel-v2");
        assertThat(request.seed()).isEqualTo(77L);
        // Only round 3's segment is recorded; the first two are re-simulated from tick 0.
        assertThat(request.recordFromMs()).isEqualTo(40_000);
        assertThat(request.segments()).extracting(SimulationRequest.SegmentRequest::endsAtMs)
                .containsExactly(20_000, 40_000, 60_000, 80_000, 100_000, 120_000);
        // Segment 1 is the request's own bots, from round 1.
        assertThat(request.segments().getFirst().bots()).isEmpty();
        assertThat(request.bots()).extracting(bot -> bot.brain().path("marker").asText())
                .containsExactly("one-r1", "two-r1");
        // Round 2: only the first player submitted a new brain, so the second keeps theirs (no swap needed).
        var second = request.segments().get(1).bots();
        assertThat(second).extracting(SimulationRequest.SegmentBotRequest::slot).containsExactly(1, 2);
        assertThat(second.get(0).brain().path("marker").asText()).isEqualTo("one-r2");
        assertThat(second.get(0).variableResets()).containsExactly("custom.a");
        assertThat(second.get(1).brain().path("marker").asText()).isEqualTo("two-r1");
        assertThat(second.get(1).variableResets()).isEmpty();
        // Round 3 carries each player's own resets.
        var third = request.segments().get(2).bots();
        assertThat(third.get(0).brain().path("marker").asText()).isEqualTo("one-r3");
        assertThat(third.get(0).variableResets()).containsExactly("Counter", "custom.b");
        assertThat(third.get(1).brain().path("marker").asText()).isEqualTo("two-r3");
        assertThat(third.get(0).selectedLoadout()).isEqualTo("custom:srg");
    }

    @Test
    void roundOneRecordsTheFirstSegmentOnly() {
        CapturingWorker duelSimulationService = new CapturingWorker();
        MatchSimulationService service = new MatchSimulationService(new JsonMapper(), duelSimulationService);
        UUID firstUserId = UUID.nameUUIDFromBytes("one-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("one-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("one-match".getBytes()),
                5L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, 1 <= 2 ? 1 : 1, true, UUID.randomUUID(), 0, "custom:s", true, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null),
                        new MatchPlayer(secondUserId, "Two", "two", 2, 2 <= 2 ? 2 : 1, true, UUID.randomUUID(), 0, "custom:s", true, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                null,
                null,
                null,
                null,
                false,
                MatchMode.ONES,
                MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS,
                MatchTimingPolicy.DEFAULT_INCREMENT_SECONDS,
                Set.of(),
                List.of(), com.example.botfight.service.match.state.MatchPhase.BUILDING);

        service.buildDuelReplay(session, Map.of(1, Map.of(
                firstUserId, brainSubmission("custom:s", List.of(), "a"),
                secondUserId, brainSubmission("custom:s", List.of(), "b"))));

        assertThat(duelSimulationService.capturedRequest.recordFromMs()).isZero();
        assertThat(duelSimulationService.capturedRequest.segments()).hasSize(6);
        assertThat(duelSimulationService.capturedRequest.segments().getFirst().endsAtMs()).isEqualTo(20_000);
    }

    private static final class CapturingWorker extends SimWorkerClient {
        private DuelSimulationRequest capturedRequest;
        CapturingWorker() { super(new JsonMapper(),new io.micrometer.core.instrument.simple.SimpleMeterRegistry(),
                "http://127.0.0.1:1","test",Duration.ofSeconds(1),1); }
        @Override public WorkerReplay simulate(DuelSimulationRequest request, JsonNode puzzle) {
            capturedRequest=request;
            return WorkerReplayFixtures.replay("CONTINUES",null,null,"SEGMENT_END",List.of(),List.of(100)).workerReplay();
        }
    }
}
