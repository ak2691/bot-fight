package com.example.botfight.service.puzzle;

import com.example.botfight.DTO.PuzzleAttemptRequestDTO;
import com.example.botfight.DTO.PuzzleAttemptResponseDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.geometry.ArenaUnits;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

/** Runs puzzle attempts through the authoritative server duel simulator. */
@Service
public class PuzzleAttemptService {
    private static final int BOT_SIZE = 60;
    private static final int MIN_SIMULATION_STEP_MS = 100;

    private final PuzzleService puzzleService;
    private final DuelSimulationService duelSimulationService;
    private final ConditionResolutionService conditionResolutionService;
    private final ActionExecutionService actionExecutionService;
    private final CurrentUserService currentUserService;
    private final TokenBucketRateLimiter<UUID> puzzleAttemptRateLimiter;

    public PuzzleAttemptService(
            PuzzleService puzzleService,
            DuelSimulationService duelSimulationService,
            ConditionResolutionService conditionResolutionService,
            ActionExecutionService actionExecutionService,
            CurrentUserService currentUserService,
            @Qualifier("puzzleAttemptRateLimiter") TokenBucketRateLimiter<UUID> puzzleAttemptRateLimiter) {
        this.puzzleService = puzzleService;
        this.duelSimulationService = duelSimulationService;
        this.conditionResolutionService = conditionResolutionService;
        this.actionExecutionService = actionExecutionService;
        this.currentUserService = currentUserService;
        this.puzzleAttemptRateLimiter = puzzleAttemptRateLimiter;
    }

    public PuzzleAttemptResponseDTO attempt(long puzzleNumber, PuzzleAttemptRequestDTO request) {
        return attempt(null, puzzleNumber, request);
    }

    public PuzzleAttemptResponseDTO attempt(
            Authentication authentication,
            long puzzleNumber,
            PuzzleAttemptRequestDTO request) {
        if (authentication != null) {
            UUID userId = currentUserService.requireCurrentUserId(authentication);
            puzzleAttemptRateLimiter.requireAllowed(userId);
        }
        PuzzleService.PuzzleAttemptDefinition definition = puzzleService.prepareAttempt(
                puzzleNumber,
                request == null ? null : request.getBrain());
        PuzzleOutcomeEvaluator outcome = new PuzzleOutcomeEvaluator(
                conditionResolutionService,
                actionExecutionService,
                definition.winConditions(),
                definition.loseConditions(),
                definition.logicConfiguration(),
                definition.timeLimitMs(),
                definition.initialElapsedMs());

        DuelSimulationRequest simulationRequest = new DuelSimulationRequest(
                UUID.nameUUIDFromBytes(("puzzle:" + definition.puzzleNumber()).getBytes(StandardCharsets.UTF_8)),
                DuelSimulationService.DUEL_RULESET_VERSION,
                definition.puzzleNumber(),
                new DuelArenaRequest(
                        ArenaUnits.WIDTH,
                        ArenaUnits.HEIGHT,
                        Math.max(MIN_SIMULATION_STEP_MS, definition.timeLimitMs()),
                        definition.initialElapsedMs()),
                List.of(
                        toBotRequest(definition.playerBot(), 1, "Puzzle Player", definition.puzzleNumber(), "player"),
                        toBotRequest(definition.opponentBot(), 2, "Puzzle Opponent", definition.puzzleNumber(), "opponent")));

        duelSimulationService.simulateWithoutReplay(simulationRequest, outcome::afterTick);
        String status = outcome.status();
        if ("solved".equals(status) && authentication != null) {
            puzzleService.recordSolved(puzzleNumber, authentication);
        }
        return new PuzzleAttemptResponseDTO(
                status,
                outcome.elapsedMs(),
                "solved".equals(status)
                        ? "Puzzle solved by authoritative simulation."
                        : "Puzzle failed the authoritative conditions.");
    }

    private DuelBotRequest toBotRequest(
            PuzzleService.PuzzleBotDefinition bot,
            int slot,
            String username,
            long puzzleNumber,
            String role) {
        return new DuelBotRequest(
                UUID.nameUUIDFromBytes(("puzzle:" + puzzleNumber + ":" + role).getBytes(StandardCharsets.UTF_8)),
                username,
                slot,
                bot.startX(),
                bot.startY(),
                bot.rotation(),
                BOT_SIZE,
                bot.loadout(),
                bot.brain(),
                bot.startHp());
    }
}
