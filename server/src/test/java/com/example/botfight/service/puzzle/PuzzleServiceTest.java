package com.example.botfight.service.puzzle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.PuzzleBotRequestDTO;
import com.example.botfight.DTO.PuzzleSaveRequestDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Puzzle;
import com.example.botfight.domain.PuzzleBot;
import com.example.botfight.domain.PuzzleBotRole;
import com.example.botfight.domain.PuzzleCompletion;
import com.example.botfight.domain.PuzzleStatus;
import com.example.botfight.domain.UserRole;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.PuzzleRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzle;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.geometry.ArenaUnits;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.json.JsonMapper;

class PuzzleServiceTest {

    private final PuzzleRepository puzzleRepository = mock(PuzzleRepository.class);
    private final PuzzleCompletionRepository puzzleCompletionRepository = mock(PuzzleCompletionRepository.class);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final BotSubmissionValidationService botValidationService = mock(BotSubmissionValidationService.class);
    private final TokenBucketRateLimiter<UUID> rateLimiter = mock(TokenBucketRateLimiter.class);
    private final Authentication authentication = mock(Authentication.class);
    private final DatabaseLookupCache databaseLookupCache = mock(DatabaseLookupCache.class);
    private final JsonMapper jsonMapper = new JsonMapper();
    private final PuzzleService service = new PuzzleService(
            puzzleRepository,
            puzzleCompletionRepository,
            currentUserService,
            botValidationService,
            jsonMapper,
            rateLimiter,
            mock(TokenBucketRateLimiter.class),
            databaseLookupCache);

    @Test
    void updateEditsExistingPuzzleAndPreservesPuzzleAndBotIds() throws Exception {
        UUID puzzleId = UUID.randomUUID();
        UUID playerBotId = UUID.randomUUID();
        UUID opponentBotId = UUID.randomUUID();
        AppUser admin = new AppUser();
        admin.setId(UUID.randomUUID());
        admin.setRole(UserRole.ADMIN);

        Puzzle puzzle = new Puzzle();
        puzzle.setId(puzzleId);
        puzzle.setPuzzleNumber(7L);
        puzzle.setName("Before");
        puzzle.setDescription("Old description");
        puzzle.setStatus(PuzzleStatus.PUBLISHED);
        puzzle.setWinConditions("[]");
        puzzle.setLoseConditions("[]");
        puzzle.setLogicConfiguration("{}");
        PuzzleBot player = bot(playerBotId, PuzzleBotRole.PLAYER, "custom:");
        PuzzleBot opponent = bot(opponentBotId, PuzzleBotRole.OPPONENT, "custom:");
        puzzle.addBot(player);
        puzzle.addBot(opponent);

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(admin);
        when(puzzleRepository.findByPuzzleNumber(7L)).thenReturn(Optional.of(puzzle));
        when(puzzleRepository.saveAndFlush(puzzle)).thenReturn(puzzle);
        when(botValidationService.validateForSimulation(any())).thenReturn(List.of());

        PuzzleSaveRequestDTO request = validUpdateRequest();
        var response = service.update(7L, request, authentication);

        assertThat(response.getId()).isEqualTo(puzzleId);
        assertThat(response.getPuzzleNumber()).isEqualTo(7L);
        assertThat(puzzle.getId()).isEqualTo(puzzleId);
        assertThat(puzzle.getPuzzleNumber()).isEqualTo(7L);
        assertThat(puzzle.getName()).isEqualTo("After");
        assertThat(puzzle.getDescription()).isEqualTo("New description");
        assertThat(puzzle.getStatus()).isEqualTo(PuzzleStatus.DRAFT);
        assertThat(puzzle.getBots()).containsExactly(player, opponent);
        assertThat(player.getId()).isEqualTo(playerBotId);
        assertThat(opponent.getId()).isEqualTo(opponentBotId);
        assertThat(opponent.getStartX()).isEqualTo(30.0);
        assertThat(opponent.getBrainPayload()).contains("loadout");
        verify(puzzleRepository).saveAndFlush(puzzle);
        verify(databaseLookupCache).invalidatePuzzleCatalog("puzzle-updated");
    }

    @Test
    void playResponseIncludesTheAuthenticatedUsersPuzzleCompletion() {
        UUID puzzleId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        CachedPuzzle cachedPuzzle = new CachedPuzzle(
                puzzleId,
                7L,
                "Puzzle",
                "Description",
                0,
                true,
                90_000,
                10,
                10,
                10,
                1,
                1,
                jsonMapper.createObjectNode(),
                jsonMapper.createArrayNode(),
                jsonMapper.createArrayNode(),
                List.of());

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(userId);
        when(databaseLookupCache.publishedPuzzle(eq(7L), any())).thenReturn(cachedPuzzle);
        when(puzzleCompletionRepository.findByUserIdAndPuzzleIdIn(userId, List.of(puzzleId)))
                .thenReturn(List.of(new PuzzleCompletion()));

        var response = service.getPublished(7L, authentication);

        assertThat(response.isSolved()).isTrue();
    }

    private PuzzleSaveRequestDTO validUpdateRequest() throws Exception {
        PuzzleSaveRequestDTO request = new PuzzleSaveRequestDTO();
        request.setName("After");
        request.setDescription("New description");
        request.setPublished(false);
        request.setHideOpponentCode(false);
        request.setInitialElapsedMs(1_000);
        request.setTimeLimitMs(80_000);
        request.setMaxActionNodes(80);
        request.setMaxConditionNodes(200);
        request.setMaxCustomVariables(20);
        request.setLogicConfiguration(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[],
                  "roots":[{
                    "id":"win",
                    "name":"Win",
                    "kind":"win",
                    "branches":[{
                      "id":"win-branch",
                      "conditions":[{"type":"always"}],
                      "actions":[],
                      "children":[]
                    }]
                  }]
                }
                """));
        request.setWinConditions(jsonMapper.readTree("[{\"type\":\"always\"}]"));
        request.setLoseConditions(jsonMapper.createArrayNode());
        request.setPlayerBot(botRequest(1170, 1050, 90, 140));
        request.setOpponentBot(botRequest(30, 150, -90, 120));
        return request;
    }

    private PuzzleBotRequestDTO botRequest(double startX, double startY, double rotation, double startHp) {
        PuzzleBotRequestDTO request = new PuzzleBotRequestDTO();
        request.setLoadout("custom:");
        request.setStartX(startX);
        request.setStartY(startY);
        request.setRotation(rotation);
        request.setStartHp(startHp);
        request.setBrain(jsonMapper.createObjectNode());
        return request;
    }

    private static PuzzleBot bot(UUID id, PuzzleBotRole role, String loadout) {
        PuzzleBot bot = new PuzzleBot();
        bot.setId(id);
        bot.setRole(role);
        bot.setLoadout(loadout);
        bot.setStartX(ArenaUnits.WIDTH / 2.0);
        bot.setStartY(role == PuzzleBotRole.PLAYER
                ? ArenaUnits.HEIGHT - ArenaUnits.SPAWN_EDGE_MARGIN
                : ArenaUnits.SPAWN_EDGE_MARGIN);
        bot.setRotation(role == PuzzleBotRole.PLAYER ? 0 : 180);
        bot.setStartHp(150);
        bot.setBrainPayload("{}");
        return bot;
    }
}
