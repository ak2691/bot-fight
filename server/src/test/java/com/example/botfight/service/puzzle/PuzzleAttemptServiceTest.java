package com.example.botfight.service.puzzle;

import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class PuzzleAttemptServiceTest {

    @Test
    void rateLimitStopsPuzzlePreparationBeforeSimulationWork() {
        PuzzleService puzzleService = mock(PuzzleService.class);
        DuelSimulationService duelSimulationService = mock(DuelSimulationService.class);
        ConditionResolutionService conditionResolutionService = mock(ConditionResolutionService.class);
        ActionExecutionService actionExecutionService = mock(ActionExecutionService.class);
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
                duelSimulationService,
                conditionResolutionService,
                actionExecutionService,
                currentUserService,
                rateLimiter);

        assertThatThrownBy(() -> service.attempt(authentication, 7L, null))
                .isInstanceOf(RateLimitExceededException.class)
                .hasMessage(RateLimitExceededException.GENERIC_MESSAGE);

        verify(puzzleService, never()).prepareAttempt(any(Long.class), any());
        verify(duelSimulationService, never()).simulateWithoutReplay(any(), any());
    }
}
