package com.example.botfight.service.puzzle;

import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.DTO.puzzle.PuzzleAttemptResponseDTO;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.PuzzleRequest;
import com.example.botfight.service.simulation.WorkerResult;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class PuzzleAttemptServiceTest {

    @Test
    void rateLimitStopsPuzzlePreparationBeforeSimulationWork() {
        PuzzleService puzzleService = mock(PuzzleService.class);
        SimWorkerClient simWorkerClient = mock(SimWorkerClient.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TokenBucketRateLimiter<UUID> rateLimiter = mock(TokenBucketRateLimiter.class);
        Authentication authentication = mock(Authentication.class);
        UUID userId = UUID.randomUUID();

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(userId);
        doThrow(new RateLimitExceededException(Duration.ofSeconds(1)))
                .when(rateLimiter)
                .requireAllowed(userId);

        PuzzleAttemptService service = new PuzzleAttemptService(
                puzzleService,
                simWorkerClient,
                currentUserService,
                rateLimiter,
                new PuzzleSimulationAdmissionControl(1));

        assertThatThrownBy(() -> service.attempt(authentication, 7L, null))
                .isInstanceOf(RateLimitExceededException.class)
                .hasMessage(RateLimitExceededException.GENERIC_MESSAGE);

        verify(puzzleService, never()).prepareAttempt(any(Long.class), any());
        verify(simWorkerClient, never()).simulatePuzzle(any(), any());
    }

    @Test
    void admissionOverloadIsRetryableAndStopsBeforePuzzlePreparation() {
        PuzzleService puzzleService = mock(PuzzleService.class);
        SimWorkerClient simWorkerClient = mock(SimWorkerClient.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TokenBucketRateLimiter<UUID> rateLimiter = mock(TokenBucketRateLimiter.class);
        Authentication authentication = mock(Authentication.class);
        UUID userId = UUID.randomUUID();
        PuzzleSimulationAdmissionControl admissionControl = new PuzzleSimulationAdmissionControl(1);

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(userId);
        PuzzleAttemptService service = new PuzzleAttemptService(
                puzzleService,
                simWorkerClient,
                currentUserService,
                rateLimiter,
                admissionControl);

        try (PuzzleSimulationAdmissionControl.Lease ignored = admissionControl.acquire(null)) {
            assertThatThrownBy(() -> service.attempt(authentication, 7L, null))
                    .isInstanceOf(RateLimitExceededException.class)
                    .satisfies(exception -> assertThat(
                            ((RateLimitExceededException) exception).getRetryAfter())
                            .isEqualTo(Duration.ofSeconds(1)));
        }

        verify(puzzleService, never()).prepareAttempt(any(Long.class), any());
        verify(simWorkerClient, never()).simulatePuzzle(any(), any());
    }

    @Test
    void attemptSendsPuzzleRulesToTheWorkerAndMapsItsOutcome() {
        PuzzleService puzzleService = mock(PuzzleService.class);
        SimWorkerClient simWorkerClient = mock(SimWorkerClient.class);
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        TokenBucketRateLimiter<UUID> rateLimiter = mock(TokenBucketRateLimiter.class);
        JsonMapper mapper = new JsonMapper();
        JsonNode logic = mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}");
        JsonNode win = mapper.readTree("[{\"type\":\"hp\"}]");
        JsonNode lose = mapper.readTree("[]");
        when(puzzleService.prepareAttempt(any(Long.class), any())).thenReturn(
                new PuzzleService.PuzzleAttemptDefinition(7L, 30_000, 5_000, win, lose, logic, List.of()));
        when(simWorkerClient.simulatePuzzle(any(), any())).thenReturn(
                new WorkerResult("test", null, new WorkerResult.PuzzleResult("solved", 1400)));
        PuzzleAttemptService service = new PuzzleAttemptService(
                puzzleService,
                simWorkerClient,
                currentUserService,
                rateLimiter,
                new PuzzleSimulationAdmissionControl(1));

        PuzzleAttemptResponseDTO response = service.attempt(7L, null);

        assertThat(response.getStatus()).isEqualTo("solved");
        assertThat(response.getElapsedMs()).isEqualTo(1400);
        ArgumentCaptor<PuzzleRequest> puzzle = ArgumentCaptor.forClass(PuzzleRequest.class);
        verify(simWorkerClient).simulatePuzzle(any(DuelSimulationRequest.class), puzzle.capture());
        assertThat(puzzle.getValue().timeLimitMs()).isEqualTo(30_000);
        assertThat(puzzle.getValue().initialElapsedMs()).isEqualTo(5_000);
        assertThat(puzzle.getValue().logicConfiguration()).isEqualTo(logic);
        assertThat(puzzle.getValue().winConditions()).isEqualTo(win);
        assertThat(puzzle.getValue().loseConditions()).isEqualTo(lose);
    }
}

