package com.example.botfight.service.puzzle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.puzzle.PuzzleBotRequestDTO;
import com.example.botfight.DTO.puzzle.PuzzleSaveRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.puzzle.Puzzle;
import com.example.botfight.domain.puzzle.PuzzleBot;
import com.example.botfight.domain.puzzle.PuzzleBotRole;
import com.example.botfight.domain.puzzle.PuzzleCompletion;
import com.example.botfight.domain.puzzle.PuzzleStatus;
import com.example.botfight.domain.auth.UserRole;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.PuzzleRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzle;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzleBot;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
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
        when(botValidationService.validateConditionRulesForSimulation(any())).thenReturn(List.of());

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
        verify(botValidationService).validateConditionRulesForSimulation(request.getLogicConfiguration());
        verify(databaseLookupCache).invalidatePuzzleCatalog("puzzle-updated");
    }

    @Test
    void updateAcceptsNegativeCenteredCoordinatesInPuzzleConditions() throws Exception {
        UUID puzzleId = UUID.randomUUID();
        AppUser admin = new AppUser();
        admin.setId(UUID.randomUUID());
        admin.setRole(UserRole.ADMIN);
        Puzzle puzzle = new Puzzle();
        puzzle.setId(puzzleId);
        puzzle.setPuzzleNumber(7L);
        puzzle.setName("Before");
        puzzle.setDescription("Old description");
        puzzle.setStatus(PuzzleStatus.DRAFT);
        puzzle.addBot(bot(UUID.randomUUID(), PuzzleBotRole.PLAYER, "custom:"));
        puzzle.addBot(bot(UUID.randomUUID(), PuzzleBotRole.OPPONENT, "custom:"));

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(admin);
        when(puzzleRepository.findByPuzzleNumber(7L)).thenReturn(Optional.of(puzzle));
        when(puzzleRepository.saveAndFlush(puzzle)).thenReturn(puzzle);

        BotSubmissionValidationService validationService = new BotSubmissionValidationService(
                jsonMapper, new GameConfigCatalog());
        PuzzleService validatingService = new PuzzleService(
                puzzleRepository,
                puzzleCompletionRepository,
                currentUserService,
                validationService,
                jsonMapper,
                rateLimiter,
                mock(TokenBucketRateLimiter.class),
                databaseLookupCache);
        PuzzleSaveRequestDTO request = validUpdateRequest();
        request.setLogicConfiguration(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v2","customVariables":[],"roots":[
                  {"id":"win","kind":"win","branches":[{"conditions":[
                    {"type":"expression","left":"selectable.x","leftSelectable":"my_bot","comparator":"lt",
                      "right":{"type":"number","value":-100}},
                    {"type":"expression","left":"selectable.y","leftSelectable":"my_bot","comparator":"gte",
                      "right":{"type":"number","value":-450}}],"actions":[],"children":[]}]}
                ]}
                """));
        request.getPlayerBot().setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}"));
        request.getOpponentBot().setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}"));

        var response = validatingService.update(7L, request, authentication);

        assertThat(response.getLogicConfiguration().at("/roots/0/branches/0/conditions/0/right/value").doubleValue())
                .isEqualTo(-100);
        assertThat(response.getLogicConfiguration().at("/roots/0/branches/0/conditions/1/right/value").doubleValue())
                .isEqualTo(-450);
        assertThat(puzzle.getLogicConfiguration()).contains("-100", "-450");

        request.setWinConditions(jsonMapper.readTree("""
                [{"type":"expression","left":"selectable.hp","leftSelectable":"my_bot","comparator":"lt",
                  "right":{"type":"number","value":-1}}]
                """));
        assertThatThrownBy(() -> validatingService.update(7L, request, authentication))
                .isInstanceOf(PuzzleValidationException.class)
                .hasMessageContaining("winConditions[0].right.value must be between 0 and 300");
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
                List.of(
                        new CachedPuzzleBot(UUID.randomUUID(), PuzzleBotRole.PLAYER, 1, 1, "custom:",
                                600, 1050, 0, 150, jsonMapper.createObjectNode()),
                        new CachedPuzzleBot(UUID.randomUUID(), PuzzleBotRole.OPPONENT, 2, 1, "custom:",
                                600, 150, 180, 150, jsonMapper.createObjectNode())));

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(userId);
        when(databaseLookupCache.publishedPuzzle(eq(7L), any())).thenReturn(cachedPuzzle);
        when(puzzleCompletionRepository.findByUserIdAndPuzzleIdIn(userId, List.of(puzzleId)))
                .thenReturn(List.of(new PuzzleCompletion()));

        var response = service.getPublished(7L, authentication);

        assertThat(response.isSolved()).isTrue();
        assertThat(response.getCoordinateSystemVersion()).isEqualTo("centered-y-up-v1");
        assertThat(response.getBots()).hasSize(2);
        assertThat(response.getBots().get(0).getStartX()).isEqualTo(0.0);
        assertThat(response.getBots().get(0).getStartY()).isEqualTo(-450.0);
        assertThat(response.getBots().get(1).getStartX()).isEqualTo(0.0);
        assertThat(response.getBots().get(1).getStartY()).isEqualTo(450.0);
    }

    private PuzzleSaveRequestDTO validUpdateRequest() throws Exception {
        PuzzleSaveRequestDTO request = new PuzzleSaveRequestDTO();
        request.setCoordinateSystemVersion("centered-y-up-v1");
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
        request.setPlayerBot(botRequest(570, -450, 90, 140));
        request.setOpponentBot(botRequest(-570, 450, -90, 120));
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
