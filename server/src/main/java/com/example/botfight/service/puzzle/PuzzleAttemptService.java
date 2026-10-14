package com.example.botfight.service.puzzle;

import com.example.botfight.DTO.puzzle.PuzzleAttemptRequestDTO;
import com.example.botfight.DTO.puzzle.PuzzleAttemptResponseDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.simulation.SimWorkerClient;
import com.example.botfight.service.simulation.SimulationRequest.DuelArenaRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelBotRequest;
import com.example.botfight.service.simulation.SimulationRequest.DuelSimulationRequest;
import com.example.botfight.service.simulation.SimulationRequest.PuzzleRequest;
import com.example.botfight.service.simulation.SimulationRequest;
import com.example.botfight.service.simulation.WorkerResult;
import com.example.botfight.simulation.geometry.ArenaUnits;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

/** Runs puzzle attempts through the authoritative simulation worker. */
@Service
public class PuzzleAttemptService {
    private static final int BOT_SIZE = 60;
    private static final int MIN_SIMULATION_STEP_MS = 100;

    private final PuzzleService puzzleService;
    private final SimWorkerClient simWorkerClient;
    private final CurrentUserService currentUserService;
    private final TokenBucketRateLimiter<UUID> puzzleAttemptRateLimiter;
    private final PuzzleSimulationAdmissionControl simulationAdmissionControl;

    public PuzzleAttemptService(
            PuzzleService puzzleService,
            SimWorkerClient simWorkerClient,
            CurrentUserService currentUserService,
            @Qualifier("puzzleAttemptRateLimiter") TokenBucketRateLimiter<UUID> puzzleAttemptRateLimiter,
            PuzzleSimulationAdmissionControl simulationAdmissionControl) {
        this.puzzleService = puzzleService;
        this.simWorkerClient = simWorkerClient;
        this.currentUserService = currentUserService;
        this.puzzleAttemptRateLimiter = puzzleAttemptRateLimiter;
        this.simulationAdmissionControl = simulationAdmissionControl;
    }

    public PuzzleAttemptResponseDTO attempt(long puzzleNumber, PuzzleAttemptRequestDTO request) {
        return attempt(null, puzzleNumber, request);
    }

    public PuzzleAttemptResponseDTO attempt(
            Authentication authentication,
            long puzzleNumber,
            PuzzleAttemptRequestDTO request) {
        UUID userId = null;
        if (authentication != null) {
            userId = currentUserService.requireCurrentUserId(authentication);
        }
        WorkerResult.PuzzleResult outcome;
        try (PuzzleSimulationAdmissionControl.Lease ignored = simulationAdmissionControl.acquire(userId)) {
            if (authentication != null) {
                puzzleAttemptRateLimiter.requireAllowed(userId);
            }
            outcome = runAuthoritativeSimulation(puzzleNumber, request);
        }
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

    private WorkerResult.PuzzleResult runAuthoritativeSimulation(
            long puzzleNumber,
            PuzzleAttemptRequestDTO request) {
        PuzzleService.PuzzleAttemptDefinition definition = puzzleService.prepareAttempt(
                puzzleNumber,
                request == null ? null : request.getBrain());
        PuzzleRequest puzzle = new PuzzleRequest(
                definition.logicConfiguration(),
                definition.winConditions(),
                definition.loseConditions(),
                definition.timeLimitMs(),
                definition.initialElapsedMs());

        int playerTeamSize = definition.bots().stream()
                .filter(bot -> bot.teamNumber() == 1)
                .mapToInt(PuzzleService.PuzzleBotDefinition::slot)
                .max()
                .orElse(1);
        List<DuelBotRequest> simulationBots = definition.bots().stream()
                .map(bot -> toBotRequest(bot, playerTeamSize, definition.puzzleNumber()))
                .toList();

        DuelSimulationRequest simulationRequest = new DuelSimulationRequest(
                UUID.nameUUIDFromBytes(("puzzle:" + definition.puzzleNumber()).getBytes(StandardCharsets.UTF_8)),
                SimulationRequest.DUEL_RULESET_VERSION,
                definition.puzzleNumber(),
                new DuelArenaRequest(
                        ArenaUnits.WIDTH,
                        ArenaUnits.HEIGHT,
                        Math.max(MIN_SIMULATION_STEP_MS, definition.timeLimitMs()),
                        definition.initialElapsedMs()),
                simulationBots);

        WorkerResult result = simWorkerClient.simulatePuzzle(simulationRequest, puzzle);
        return result.puzzle();
    }

    private DuelBotRequest toBotRequest(
            PuzzleService.PuzzleBotDefinition bot,
            int playerTeamSize,
            long puzzleNumber) {
        int simulationSlot = bot.teamNumber() == 1
                ? bot.slot()
                : playerTeamSize + bot.slot();
        String teamLabel = bot.teamNumber() == 1 ? "Blue" : "Red";
        String username = "Puzzle " + teamLabel + " " + bot.slot();
        return new DuelBotRequest(
                UUID.nameUUIDFromBytes(("puzzle:" + puzzleNumber + ":team:" + bot.teamNumber() + ":slot:" + bot.slot())
                        .getBytes(StandardCharsets.UTF_8)),
                username,
                simulationSlot,
                bot.startX(),
                bot.startY(),
                bot.rotation(),
                BOT_SIZE,
                bot.loadout(),
                bot.brain(),
                bot.startHp(),
                bot.teamNumber());
    }
}
