package com.example.botfight.service.puzzle;

import com.example.botfight.service.simulation.SimulationRequest;
import org.mockito.ArgumentCaptor;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.simulation.WorkerReplay;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
class PuzzleAttemptServiceTest {
    private final JsonMapper mapper=new JsonMapper();
    private final PuzzleService puzzles=mock(PuzzleService.class);
    private final SimWorkerClient worker=mock(SimWorkerClient.class);
    private final CurrentUserService currentUser=mock(CurrentUserService.class);
    private final TokenBucketRateLimiter<UUID> limiter=mock(TokenBucketRateLimiter.class);
    private final PuzzleSimulationAdmissionControl admission=new PuzzleSimulationAdmissionControl(1);
    private final Authentication auth=mock(Authentication.class);
    private PuzzleAttemptService service() { return new PuzzleAttemptService(puzzles,currentUser,limiter,admission,worker); }
    private void definition() {
        var brain=mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}");
        var rules=mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"customVariables\":[],\"roots\":[{\"kind\":\"win\",\"branches\":[{\"conditions\":[{\"type\":\"always\"}]}]}]}");
        when(puzzles.prepareAttempt(7L,null)).thenReturn(new PuzzleService.PuzzleAttemptDefinition(7,1000,500,rules,
                new PuzzleService.PuzzleBotDefinition("custom",200,400,90,brain),
                new PuzzleService.PuzzleBotDefinition("custom",800,400,270,brain)));
    }
    private WorkerReplay response(String status) {
        return new WorkerReplay(new WorkerReplay.Result("test","DRAW","HP_DECISION",null,List.of(),200,List.of(),status),
                "{\"shapes\":[]}",List.of());
    }
    @Test void sendsPuzzleRulesAndRecordsOnlyAuthenticatedWorkerSolves() {
        definition(); var user=UUID.randomUUID(); when(currentUser.requireCurrentUserId(auth)).thenReturn(user);
        when(worker.simulate(any(),any())).thenReturn(response("solved"));
        var result=service().attempt(auth,7,null);
        assertThat(result.getStatus()).isEqualTo("solved"); assertThat(result.getElapsedMs()).isEqualTo(200);
        verify(puzzles).recordSolved(7,auth); verify(limiter).requireAllowed(user);
        var payload=ArgumentCaptor.forClass(JsonNode.class);
        var request=ArgumentCaptor.forClass(SimulationRequest.DuelSimulationRequest.class);
        verify(worker).simulate(request.capture(),payload.capture());
        assertThat(payload.getValue().path("timeLimitMs").asInt()).isEqualTo(1000);
        assertThat(payload.getValue().at("/logicConfiguration/roots/0/kind").asString()).isEqualTo("win");
        assertThat(request.getValue().arena().initialElapsedMs()).isEqualTo(500);
    }
    @Test void missingOutcomeAndTransportFailureNeverRecordSolveAndReleaseAdmission() {
        definition(); when(currentUser.requireCurrentUserId(auth)).thenReturn(UUID.randomUUID());
        when(worker.simulate(any(),any())).thenReturn(response(null));
        assertThatThrownBy(()->service().attempt(auth,7,null)).hasMessageContaining("missing puzzle outcome");
        when(worker.simulate(any(),any())).thenThrow(new IllegalStateException("unavailable"));
        assertThatThrownBy(()->service().attempt(auth,7,null)).hasMessage("unavailable");
        verify(puzzles,never()).recordSolved(anyLong(),any());
        try(var lease=admission.acquire(null)) { assertThat(lease).isNotNull(); }
    }
    @Test void anonymousAttemptDoesNotRecordSolve() {
        definition(); when(worker.simulate(any(),any())).thenReturn(response("solved"));
        assertThat(service().attempt(7,null).getStatus()).isEqualTo("solved");
        verify(puzzles,never()).recordSolved(anyLong(),any()); verifyNoInteractions(limiter,currentUser);
    }
    @Test void rateLimitStopsBeforePreparationOrSimulation() {
        var user=UUID.randomUUID(); when(currentUser.requireCurrentUserId(auth)).thenReturn(user);
        doThrow(new RateLimitExceededException(Duration.ofSeconds(1))).when(limiter).requireAllowed(user);
        assertThatThrownBy(()->service().attempt(auth,7,null)).isInstanceOf(RateLimitExceededException.class);
        verifyNoInteractions(puzzles,worker);
    }
    @Test void admissionOverloadStopsBeforePreparationOrSimulation() {
        when(currentUser.requireCurrentUserId(auth)).thenReturn(UUID.randomUUID());
        try(var lease=admission.acquire(null)) {
            assertThatThrownBy(()->service().attempt(auth,7,null)).isInstanceOf(RateLimitExceededException.class);
        }
        verifyNoInteractions(puzzles,worker,limiter);
    }
}
