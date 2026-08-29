package com.example.botfight.service.puzzle;

import com.example.botfight.DTO.PuzzleAdminResponseDTO;
import com.example.botfight.DTO.PuzzleBotRequestDTO;
import com.example.botfight.DTO.PuzzleBotResponseDTO;
import com.example.botfight.DTO.PuzzleListItemDTO;
import com.example.botfight.DTO.PuzzleListPageDTO;
import com.example.botfight.DTO.PuzzlePlayResponseDTO;
import com.example.botfight.DTO.PuzzleSaveRequestDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Puzzle;
import com.example.botfight.domain.PuzzleBot;
import com.example.botfight.domain.PuzzleBotRole;
import com.example.botfight.domain.PuzzleStatus;
import com.example.botfight.domain.UserRole;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.PuzzleRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzle;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzleBot;
import com.example.botfight.service.cache.DatabaseLookupCache.PuzzleListKey;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.gameconfig.AbilityContracts;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class PuzzleService {

    public static final int MAX_TIME_LIMIT_MS = 90_000;
    public static final int DEFAULT_TIME_LIMIT_MS = 90_000;
    public static final int MAX_INITIAL_ELAPSED_MS = 60_000;
    public static final int PAGE_SIZE = 20;
    private static final int MAX_NAME_LENGTH = 120;
    private static final int MAX_DESCRIPTION_LENGTH = 2_000;
    private static final int MAX_SEARCH_QUERY_LENGTH = 100;
    private static final Pattern SEARCH_PUZZLE_NUMBER_PREFIX = Pattern.compile("^(\\d+)(?:\\.|\\s|$).*");
    private static final int MAX_CONDITION_COUNT = 300;
    private static final int MAX_JSON_BYTES = 750_000;
    private static final int MAX_ACTION_NODES = 100;
    private static final int MAX_ROOT_NODES = 100;
    private static final int MAX_CONDITION_NODES = 300;
    private static final int MAX_CUSTOM_VARIABLES = 100;
    private static final int MIN_PUZZLE_TEAM_SIZE = 1;
    private static final int MAX_PUZZLE_TEAM_SIZE = 2;
    private static final int MAX_CONDITION_JSON_BYTES = 100_000;
    private static final int MAX_PUZZLE_LOGIC_JSON_BYTES = 250_000;
    private static final double MAX_CONDITION_NUMBER = 1_000_000_000d;
    private static final double ARENA_WIDTH = 1000;
    private static final double ARENA_HEIGHT = 1000;
    private static final double BOT_SIZE = 60;
    private static final double BOT_RADIUS = BOT_SIZE / 2;
    private static final double BASE_BOT_HP = 150;
    private static final String PUZZLE_LOGIC_VERSION = "bot-logic-tree-v1";
    private static final String PUZZLE_VARIABLE_PREFIX = "custom.puzzle.";

    private final PuzzleRepository puzzleRepository;
    private final PuzzleCompletionRepository puzzleCompletionRepository;
    private final CurrentUserService currentUserService;
    private final BotSubmissionValidationService botValidationService;
    private final JsonMapper jsonMapper;
    private final TokenBucketRateLimiter<UUID> adminPuzzleCreationRateLimiter;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;
    private final DatabaseLookupCache databaseLookupCache;

    public PuzzleService(
            PuzzleRepository puzzleRepository,
            PuzzleCompletionRepository puzzleCompletionRepository,
            CurrentUserService currentUserService,
            BotSubmissionValidationService botValidationService,
            JsonMapper jsonMapper,
            @Qualifier("adminPuzzleCreationRateLimiter")
            TokenBucketRateLimiter<UUID> adminPuzzleCreationRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this(
                puzzleRepository,
                puzzleCompletionRepository,
                currentUserService,
                botValidationService,
                jsonMapper,
                adminPuzzleCreationRateLimiter,
                authenticatedGetRateLimiter,
                new DatabaseLookupCache());
    }

    @Autowired
    public PuzzleService(
            PuzzleRepository puzzleRepository,
            PuzzleCompletionRepository puzzleCompletionRepository,
            CurrentUserService currentUserService,
            BotSubmissionValidationService botValidationService,
            JsonMapper jsonMapper,
            @Qualifier("adminPuzzleCreationRateLimiter")
            TokenBucketRateLimiter<UUID> adminPuzzleCreationRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter,
            DatabaseLookupCache databaseLookupCache) {
        this.puzzleRepository = puzzleRepository;
        this.puzzleCompletionRepository = puzzleCompletionRepository;
        this.currentUserService = currentUserService;
        this.botValidationService = botValidationService;
        this.jsonMapper = jsonMapper;
        this.adminPuzzleCreationRateLimiter = adminPuzzleCreationRateLimiter;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
        this.databaseLookupCache = databaseLookupCache;
    }

    @Transactional
    public PuzzleAdminResponseDTO create(PuzzleSaveRequestDTO request, Authentication authentication) {
        AppUser author = requireAdmin(authentication);
        adminPuzzleCreationRateLimiter.requireAllowed(author.getId());
        ValidatedPuzzle validated = validate(request);

        Puzzle puzzle = new Puzzle();
        puzzle.setPuzzleNumber(nextPuzzleNumber());
        applyValidatedPuzzle(puzzle, validated);
        puzzle.setCreatedBy(author);
        validated.bots().forEach(bot -> puzzle.addBot(toPuzzleBot(bot)));

        Puzzle saved = puzzleRepository.save(puzzle);
        if (saved.getStatus() == PuzzleStatus.PUBLISHED) {
            databaseLookupCache.logDatabaseWrite(
                    "puzzle-catalog",
                    saved.getPuzzleNumber(),
                    "create-published-puzzle");
            databaseLookupCache.invalidatePuzzleCatalog("published-puzzle-created");
        }
        return toAdminResponse(saved);
    }

    @Transactional(readOnly = true)
    public PuzzleAdminResponseDTO getForAdmin(long puzzleNumber, Authentication authentication) {
        requireAdmin(authentication);
        return puzzleRepository.findByPuzzleNumber(puzzleNumber)
                .map(this::toAdminResponse)
                .orElseThrow(() -> new PuzzleNotFoundException(puzzleNumber));
    }

    @Transactional
    public PuzzleAdminResponseDTO update(
            long puzzleNumber,
            PuzzleSaveRequestDTO request,
            Authentication authentication) {
        AppUser author = requireAdmin(authentication);
        adminPuzzleCreationRateLimiter.requireAllowed(author.getId());
        ValidatedPuzzle validated = validate(request);
        Puzzle puzzle = puzzleRepository.findByPuzzleNumber(puzzleNumber)
                .orElseThrow(() -> new PuzzleNotFoundException(puzzleNumber));

        // The path number selects the existing row. Neither the puzzle UUID nor
        // the puzzle number is copied from the request, so both remain stable.
        applyValidatedPuzzle(puzzle, validated);
        updatePuzzleBots(puzzle, validated.bots());

        Puzzle saved = puzzleRepository.saveAndFlush(puzzle);
        databaseLookupCache.logDatabaseWrite(
                "puzzle-catalog",
                saved.getPuzzleNumber(),
                "update-puzzle");
        databaseLookupCache.invalidatePuzzleCatalog("puzzle-updated");
        return toAdminResponse(saved);
    }

    @Transactional(readOnly = true)
    public PuzzleListPageDTO listPublished(int requestedPage, int requestedSize) {
        return listPublished(requestedPage, requestedSize, null);
    }

    @Transactional(readOnly = true)
    public PuzzleListPageDTO listPublished(
            int requestedPage,
            int requestedSize,
            Authentication authentication) {
        return listPublished(requestedPage, requestedSize, "", authentication);
    }

    @Transactional(readOnly = true)
    public PuzzleListPageDTO listPublished(
            int requestedPage,
            int requestedSize,
            String requestedQuery,
            Authentication authentication) {
        if (authentication != null) {
            requireAuthenticatedGetAllowed(authentication, "puzzle-list");
        }
        int page = Math.min(Math.max(0, requestedPage), 10_000);
        int size = Math.min(Math.max(1, requestedSize), PAGE_SIZE);
        String query = normalizeSearchQuery(requestedQuery);
        UUID userId = authentication == null
                ? null
                : currentUserService.requireCurrentUserId(authentication);
        PuzzleListKey cacheKey = new PuzzleListKey(page, size, userId, query);
        return databaseLookupCache.puzzleList(
                cacheKey,
                () -> loadPublishedList(page, size, query, userId));
    }

    private PuzzleListPageDTO loadPublishedList(int page, int size, String query, UUID userId) {
        PageRequest pageRequest = PageRequest.of(
                page,
                size,
                Sort.by(Sort.Direction.ASC, "puzzleNumber"));
        Page<Puzzle> puzzles = query.isBlank()
                ? puzzleRepository.findByStatusOrderByPuzzleNumberAsc(PuzzleStatus.PUBLISHED, pageRequest)
                : puzzleRepository.searchPublished(
                        PuzzleStatus.PUBLISHED,
                        query,
                        puzzleNumberFromSearch(query),
                        pageRequest);
        Set<UUID> solvedPuzzleIds = solvedPuzzleIds(userId, puzzles.getContent());
        List<PuzzleListItemDTO> items = puzzles.getContent().stream()
                .map(puzzle -> new PuzzleListItemDTO(
                        puzzle.getPuzzleNumber(),
                        puzzle.getName(),
                        puzzle.getDescription(),
                        solvedPuzzleIds.contains(puzzle.getId())))
                .toList();
        return new PuzzleListPageDTO(items, page, size, puzzles.hasNext(), puzzles.getTotalElements());
    }

    private String normalizeSearchQuery(String requestedQuery) {
        String query = requestedQuery == null ? "" : requestedQuery.trim();
        return query.length() <= MAX_SEARCH_QUERY_LENGTH
                ? query
                : query.substring(0, MAX_SEARCH_QUERY_LENGTH);
    }

    private Long puzzleNumberFromSearch(String query) {
        Matcher matcher = SEARCH_PUZZLE_NUMBER_PREFIX.matcher(query);
        if (!matcher.matches()) return null;
        try {
            return Long.valueOf(matcher.group(1));
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    @Transactional
    public void recordSolved(long puzzleNumber, Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        CachedPuzzle puzzle = publishedPuzzle(puzzleNumber);
        databaseLookupCache.logDatabaseWrite(
                "puzzle-completions",
                user.getId() + ":" + puzzleNumber,
                "record-solved");
        int inserted = puzzleCompletionRepository.insertIfAbsent(user.getId(), puzzle.id());
        databaseLookupCache.invalidateAfterPuzzleCompletion(
                user.getId(),
                "puzzle-completion-written inserted=" + inserted);
    }

    @Transactional(readOnly = true)
    public PuzzlePlayResponseDTO getPublished(long puzzleNumber) {
        return getPublishedInternal(puzzleNumber);
    }

    @Transactional(readOnly = true)
    public PuzzlePlayResponseDTO getPublished(long puzzleNumber, Authentication authentication) {
        requireAuthenticatedGetAllowed(authentication, "puzzle-detail");
        return getPublishedInternal(puzzleNumber);
    }

    private PuzzlePlayResponseDTO getPublishedInternal(long puzzleNumber) {
        return toPlayResponse(publishedPuzzle(puzzleNumber));
    }

    private void requireAuthenticatedGetAllowed(Authentication authentication, String category) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        authenticatedGetRateLimiter.requireAllowed(category + ":" + userId);
    }

    private AppUser requireAdmin(Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        if (user.getRole() != UserRole.ADMIN) {
            throw new AccessDeniedException("admin role is required");
        }
        return user;
    }

    private CachedPuzzle publishedPuzzle(long puzzleNumber) {
        return databaseLookupCache.publishedPuzzle(
                puzzleNumber,
                () -> puzzleRepository.findByPuzzleNumberAndStatus(puzzleNumber, PuzzleStatus.PUBLISHED)
                        .map(this::toCachedPuzzle)
                        .orElseThrow(() -> new PuzzleNotFoundException(puzzleNumber)));
    }

    /**
     * Loads the server-owned puzzle setup and validates the player's submitted
     * brain against the limits stored with that puzzle.  The submitted loadout
     * and spawn values are intentionally ignored; both come from the saved
     * puzzle definition.
     */
    @Transactional(readOnly = true)
    public PuzzleAttemptDefinition prepareAttempt(long puzzleNumber, JsonNode submittedBrain) {
        CachedPuzzle puzzle = publishedPuzzle(puzzleNumber);
        CachedPuzzleBot playerBot = puzzle.bots().stream()
                .filter(bot -> bot.teamNumber() == 1 && bot.slot() == 1)
                .findFirst()
                .orElseGet(() -> puzzle.bots().stream()
                        .filter(bot -> bot.role() == PuzzleBotRole.PLAYER)
                        .findFirst()
                        .orElse(null));
        CachedPuzzleBot opponentBot = puzzle.bots().stream()
                .filter(bot -> bot.teamNumber() == 2)
                .findFirst()
                .orElseGet(() -> puzzle.bots().stream()
                        .filter(bot -> bot.role() == PuzzleBotRole.OPPONENT)
                        .findFirst()
                        .orElse(null));
        if (playerBot == null || opponentBot == null || puzzle.bots().size() < 2) {
            throw new PuzzleValidationException(List.of("Puzzle must contain both player and opponent bots"));
        }

        List<String> errors = new ArrayList<>();
        List<PuzzleBotDefinition> definitions = new ArrayList<>();
        for (CachedPuzzleBot bot : puzzle.bots()) {
            boolean submittedPlayer = bot.teamNumber() == 1 && bot.slot() == 1;
            PuzzleBotRole role = bot.teamNumber() == 1 ? PuzzleBotRole.PLAYER : PuzzleBotRole.OPPONENT;
            ValidatedBot validated = validateBot(
                    botRequest(bot, submittedPlayer ? submittedBrain : bot.brain()),
                    role,
                    submittedPlayer || role == PuzzleBotRole.PLAYER ? puzzle.maxActionNodes() : MAX_ACTION_NODES,
                    submittedPlayer || role == PuzzleBotRole.PLAYER ? puzzle.maxConditionNodes() : MAX_CONDITION_NODES,
                    submittedPlayer || role == PuzzleBotRole.PLAYER ? puzzle.maxCustomVariables() : MAX_CUSTOM_VARIABLES,
                    "bots[" + definitions.size() + "]",
                    errors);
            definitions.add(new PuzzleBotDefinition(
                    bot.teamNumber(),
                    bot.slot(),
                    role,
                    validated.loadout(),
                    validated.startX(),
                    validated.startY(),
                    validated.rotation(),
                    validated.startHp(),
                    validated.brain()));
        }
        if (!errors.isEmpty()) throw new PuzzleValidationException(errors);

        return new PuzzleAttemptDefinition(
                puzzle.puzzleNumber(),
                puzzle.timeLimitMs(),
                puzzle.initialElapsedMs(),
                puzzle.winConditions().deepCopy(),
                puzzle.loseConditions().deepCopy(),
                puzzle.logicConfiguration().deepCopy(),
                List.copyOf(definitions));
    }

    private Set<UUID> solvedPuzzleIds(UUID userId, List<Puzzle> puzzles) {
        if (userId == null || puzzles.isEmpty()) return Set.of();
        List<UUID> puzzleIds = puzzles.stream().map(Puzzle::getId).toList();
        return puzzleCompletionRepository.findByUserIdAndPuzzleIdIn(userId, puzzleIds).stream()
                .map(completion -> completion.getPuzzle().getId())
                .collect(java.util.stream.Collectors.toSet());
    }

    private PuzzleBotRequestDTO botRequest(CachedPuzzleBot bot, JsonNode brain) {
        PuzzleBotRequestDTO request = new PuzzleBotRequestDTO();
        request.setRole(bot.role() == null ? null : bot.role().name());
        request.setTeamNumber(bot.teamNumber());
        request.setSlot(bot.slot());
        request.setLoadout(bot.loadout());
        request.setStartX(bot.startX());
        request.setStartY(bot.startY());
        request.setRotation(bot.rotation());
        request.setStartHp(bot.startHp());
        request.setBrain(brain == null ? null : brain.deepCopy());
        return request;
    }

    private ValidatedPuzzle validate(PuzzleSaveRequestDTO request) {
        List<String> errors = new ArrayList<>();
        String name = request == null || request.getName() == null ? "" : request.getName().trim();
        if (name.isBlank()) errors.add("name is required");
        if (name.length() > MAX_NAME_LENGTH) errors.add("name cannot exceed " + MAX_NAME_LENGTH + " characters");
        String description = request == null || request.getDescription() == null ? "" : request.getDescription().trim();
        if (description.length() > MAX_DESCRIPTION_LENGTH) errors.add("description cannot exceed " + MAX_DESCRIPTION_LENGTH + " characters");

        int initialElapsedMs = valueOrDefault(request == null ? null : request.getInitialElapsedMs(), 0);
        if (initialElapsedMs < 0 || initialElapsedMs > MAX_INITIAL_ELAPSED_MS) {
            errors.add("initialElapsedMs must be between 0 and " + MAX_INITIAL_ELAPSED_MS);
        }
        int timeLimitMs = valueOrDefault(request == null ? null : request.getTimeLimitMs(), DEFAULT_TIME_LIMIT_MS);
        if (timeLimitMs < 0 || timeLimitMs > MAX_TIME_LIMIT_MS) {
            errors.add("timeLimitMs must be between 0 and " + MAX_TIME_LIMIT_MS);
        } else if (timeLimitMs > MAX_TIME_LIMIT_MS - Math.max(0, initialElapsedMs)) {
            errors.add("timeLimitMs cannot exceed "
                    + (MAX_TIME_LIMIT_MS - Math.max(0, initialElapsedMs))
                    + " when initialElapsedMs is set");
        }
        int maxActionNodes = valueOrDefault(request == null ? null : request.getMaxActionNodes(), MAX_ACTION_NODES);
        int maxConditionNodes = valueOrDefault(request == null ? null : request.getMaxConditionNodes(), MAX_CONDITION_NODES);
        int maxCustomVariables = valueOrDefault(request == null ? null : request.getMaxCustomVariables(), MAX_CUSTOM_VARIABLES);
        if (maxActionNodes < 0 || maxActionNodes > MAX_ACTION_NODES) errors.add("maxActionNodes must be between 0 and 100");
        if (maxConditionNodes < 0 || maxConditionNodes > MAX_CONDITION_NODES) errors.add("maxConditionNodes must be between 0 and 300");
        if (maxCustomVariables < 0 || maxCustomVariables > MAX_CUSTOM_VARIABLES) errors.add("maxCustomVariables must be between 0 and 100");

        int playerTeamSize = valueOrDefault(request == null ? null : request.getPlayerTeamSize(), MIN_PUZZLE_TEAM_SIZE);
        int opponentTeamSize = valueOrDefault(request == null ? null : request.getOpponentTeamSize(), MIN_PUZZLE_TEAM_SIZE);
        if (playerTeamSize < MIN_PUZZLE_TEAM_SIZE || playerTeamSize > MAX_PUZZLE_TEAM_SIZE) {
            errors.add("playerTeamSize must be between 1 and 2");
        }
        if (opponentTeamSize < MIN_PUZZLE_TEAM_SIZE || opponentTeamSize > MAX_PUZZLE_TEAM_SIZE) {
            errors.add("opponentTeamSize must be between 1 and 2");
        }
        int boundedPlayerTeamSize = boundedTeamSize(playerTeamSize);
        int boundedOpponentTeamSize = boundedTeamSize(opponentTeamSize);

        JsonNode winConditions = arrayOrEmpty(request == null ? null : request.getWinConditions(), "winConditions", errors);
        JsonNode loseConditions = arrayOrEmpty(request == null ? null : request.getLoseConditions(), "loseConditions", errors);
        if (winConditions.isArray() && winConditions.isEmpty()) errors.add("winConditions must contain at least one condition");
        validateConditionArray(winConditions, "winConditions", errors);
        validateConditionArray(loseConditions, "loseConditions", errors);
        JsonNode logicConfiguration = request == null ? null : request.getLogicConfiguration();
        if (logicConfiguration == null || logicConfiguration.isNull()) {
            errors.add("logicConfiguration must be an object");
        } else {
            validatePuzzleLogicConfiguration(logicConfiguration, errors);
        }

        List<ValidatedBot> bots = validatePuzzleBots(
                request,
                boundedPlayerTeamSize,
                boundedOpponentTeamSize,
                maxActionNodes,
                maxConditionNodes,
                maxCustomVariables,
                errors);

        if (!errors.isEmpty()) throw new PuzzleValidationException(errors);
        return new ValidatedPuzzle(
                name,
                description,
                initialElapsedMs,
                Boolean.TRUE.equals(request != null ? request.getPublished() : null),
                request == null || request.getHideOpponentCode() == null || request.getHideOpponentCode(),
                timeLimitMs,
                maxActionNodes,
                maxConditionNodes,
                maxCustomVariables,
                boundedPlayerTeamSize,
                boundedOpponentTeamSize,
                winConditions,
                loseConditions,
                logicConfiguration,
                List.copyOf(bots));
    }

    private List<ValidatedBot> validatePuzzleBots(
            PuzzleSaveRequestDTO request,
            int playerTeamSize,
            int opponentTeamSize,
            int maxActionNodes,
            int maxConditionNodes,
            int maxCustomVariables,
            List<String> errors) {
        if (request == null || request.getBots() == null) {
            ValidatedBot player = validateBot(
                    request == null ? null : request.getPlayerBot(),
                    PuzzleBotRole.PLAYER,
                    maxActionNodes,
                    maxConditionNodes,
                    maxCustomVariables,
                    "playerBot",
                    errors);
            ValidatedBot opponent = validateBot(
                    request == null ? null : request.getOpponentBot(),
                    PuzzleBotRole.OPPONENT,
                    MAX_ACTION_NODES,
                    MAX_CONDITION_NODES,
                    MAX_CUSTOM_VARIABLES,
                    "opponentBot",
                    errors);
            for (int slot = 2; slot <= playerTeamSize; slot += 1) {
                errors.add("bots is missing team 1 slot " + slot);
            }
            for (int slot = 2; slot <= opponentTeamSize; slot += 1) {
                errors.add("bots is missing team 2 slot " + slot);
            }
            return List.of(
                    player.withIdentity(PuzzleBotRole.PLAYER, 1, 1),
                    opponent.withIdentity(PuzzleBotRole.OPPONENT, 2, 1));
        }

        List<ValidatedBot> validated = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        List<PuzzleBotRequestDTO> requestedBots = request.getBots();
        for (int index = 0; index < requestedBots.size(); index += 1) {
            PuzzleBotRequestDTO bot = requestedBots.get(index);
            String path = "bots[" + index + "]";
            if (bot == null) {
                errors.add(path + " must be an object");
                continue;
            }
            int teamNumber = requestedTeamNumber(bot);
            int slot = valueOrDefault(bot.getSlot(), 1);
            if (teamNumber < 1 || teamNumber > 2) {
                errors.add(path + ".teamNumber must be 1 or 2");
                continue;
            }
            if (slot < 1 || slot > MAX_PUZZLE_TEAM_SIZE) {
                errors.add(path + ".slot must be between 1 and 2");
                continue;
            }
            int expectedTeamSize = teamNumber == 1 ? playerTeamSize : opponentTeamSize;
            if (slot > expectedTeamSize) {
                errors.add(path + " is outside the configured team size");
                continue;
            }
            PuzzleBotRole role = teamNumber == 1 ? PuzzleBotRole.PLAYER : PuzzleBotRole.OPPONENT;
            if (bot.getRole() != null && !role.name().equalsIgnoreCase(bot.getRole().trim())) {
                errors.add(path + ".role does not match teamNumber");
            }
            String key = teamNumber + ":" + slot;
            if (!seen.add(key)) {
                errors.add(path + " duplicates team " + teamNumber + " slot " + slot);
                continue;
            }
            ValidatedBot next = validateBot(
                    bot,
                    role,
                    role == PuzzleBotRole.PLAYER ? maxActionNodes : MAX_ACTION_NODES,
                    role == PuzzleBotRole.PLAYER ? maxConditionNodes : MAX_CONDITION_NODES,
                    role == PuzzleBotRole.PLAYER ? maxCustomVariables : MAX_CUSTOM_VARIABLES,
                    path,
                    errors);
            validated.add(next.withIdentity(role, teamNumber, slot));
        }

        for (int teamNumber = 1; teamNumber <= 2; teamNumber += 1) {
            int teamSize = teamNumber == 1 ? playerTeamSize : opponentTeamSize;
            for (int slot = 1; slot <= teamSize; slot += 1) {
                if (!seen.contains(teamNumber + ":" + slot)) {
                    errors.add("bots is missing team " + teamNumber + " slot " + slot);
                }
            }
        }
        validated.sort(Comparator.comparingInt(ValidatedBot::teamNumber).thenComparingInt(ValidatedBot::slot));
        return validated;
    }

    private int requestedTeamNumber(PuzzleBotRequestDTO bot) {
        if (bot.getTeamNumber() != null) return bot.getTeamNumber();
        if (bot.getRole() != null && "OPPONENT".equalsIgnoreCase(bot.getRole().trim())) return 2;
        if (bot.getRole() != null && "PLAYER".equalsIgnoreCase(bot.getRole().trim())) return 1;
        return 0;
    }

    private int boundedTeamSize(int value) {
        return Math.max(MIN_PUZZLE_TEAM_SIZE, Math.min(MAX_PUZZLE_TEAM_SIZE, value));
    }

    private void validatePuzzleLogicConfiguration(JsonNode configuration, List<String> errors) {
        if (configuration == null || !configuration.isObject()) {
            errors.add("logicConfiguration must be an object");
            return;
        }
        if (!PUZZLE_LOGIC_VERSION.equals(configuration.path("version").asText(""))) {
            errors.add("logicConfiguration.version must be " + PUZZLE_LOGIC_VERSION);
        }
        try {
            if (jsonMapper.writeValueAsString(configuration).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_PUZZLE_LOGIC_JSON_BYTES) {
                errors.add("logicConfiguration is too large");
            }
        } catch (Exception exception) {
            errors.add("logicConfiguration could not be serialized");
        }

        JsonNode variables = configuration.get("customVariables");
        if (variables == null || !variables.isArray()) {
            errors.add("logicConfiguration.customVariables must be an array");
        } else {
            if (variables.size() > MAX_CUSTOM_VARIABLES) {
                errors.add("logicConfiguration uses " + variables.size()
                        + " custom variables; maximum is " + MAX_CUSTOM_VARIABLES);
            }
            for (int index = 0; index < variables.size(); index += 1) {
                JsonNode variable = variables.get(index);
                String id = variable == null ? "" : variable.path("id").asText("");
                if (!id.startsWith(PUZZLE_VARIABLE_PREFIX)) {
                    errors.add("logicConfiguration.customVariables[" + index + "].id must use the puzzle namespace");
                }
            }
        }

        JsonNode roots = configuration.get("roots");
        if (roots == null || !roots.isArray()) {
            errors.add("logicConfiguration.roots must be an array");
            return;
        }
        if (roots.size() > MAX_ROOT_NODES) errors.add("logicConfiguration cannot contain more than " + MAX_ROOT_NODES + " roots");
        int actionCount = countActionNodes(roots);
        int conditionCount = countConditionNodes(roots);
        if (actionCount > MAX_ACTION_NODES) errors.add("logicConfiguration exceeds the total action limit");
        if (conditionCount > MAX_CONDITION_NODES) errors.add("logicConfiguration exceeds the total condition limit");

        boolean hasWinRoot = false;
        for (int rootIndex = 0; rootIndex < roots.size(); rootIndex += 1) {
            JsonNode root = roots.get(rootIndex);
            String path = "logicConfiguration.roots[" + rootIndex + "]";
            String kind = root == null ? "" : root.path("kind").asText("");
            if (!Set.of("win", "lose", "modify").contains(kind)) {
                errors.add(path + ".kind must be win, lose, or modify");
                continue;
            }
            if ("win".equals(kind)) hasWinRoot = true;
            JsonNode branches = root.get("branches");
            if (branches == null || !branches.isArray() || branches.isEmpty()) {
                errors.add(path + ".branches must contain at least one conditional");
                continue;
            }
            for (int branchIndex = 0; branchIndex < branches.size(); branchIndex += 1) {
                JsonNode branch = branches.get(branchIndex);
                String branchPath = path + ".branches[" + branchIndex + "]";
                JsonNode conditions = branch == null ? null : branch.get("conditions");
                if (conditions == null || !conditions.isArray() || conditions.isEmpty()) {
                    errors.add(branchPath + ".conditions must contain at least one condition");
                }
                JsonNode children = branch == null ? null : branch.get("children");
                if (children != null && children.isArray() && !children.isEmpty()) {
                    errors.add(branchPath + ".children are not supported in puzzle rules");
                }
                JsonNode actions = branch == null ? null : branch.get("actions");
                int actionSize = actions != null && actions.isArray() ? actions.size() : 0;
                boolean hasLegacyAction = branch != null
                        && branch.hasNonNull("action")
                        && !"none".equals(branch.path("action").asText(""));
                if (hasLegacyAction) {
                    errors.add(branchPath + ".action is not supported; use the fixed modify custom variable action");
                }
                if ("modify".equals(kind)) {
                    if (actionSize != 1 || !"variable".equals(actions.get(0).path("action").asText(""))) {
                        errors.add(branchPath + " must contain exactly one modify custom variable action");
                    }
                } else if (actionSize > 0) {
                    errors.add(branchPath + " cannot contain actions for a win or lose condition");
                }
            }
        }
        if (!hasWinRoot) errors.add("logicConfiguration must contain at least one win condition");

        errors.addAll(botValidationService.validateForSimulation(configuration).stream()
                .map(error -> "logicConfiguration: " + error)
                .toList());
    }

    private ValidatedBot validateBot(
            PuzzleBotRequestDTO request,
            PuzzleBotRole role,
            int maxActionNodes,
            int maxConditionNodes,
            int maxCustomVariables,
            String validationPath,
            List<String> errors) {
        String path = validationPath == null || validationPath.isBlank()
                ? role == PuzzleBotRole.PLAYER ? "playerBot" : "opponentBot"
                : validationPath;
        String loadout = request == null || request.getLoadout() == null ? "custom:" : request.getLoadout().trim();
        if (loadout.isBlank() || loadout.length() > 40) errors.add(path + ".loadout must be between 1 and 40 characters");
        if (!validLoadoutEncoding(loadout)) errors.add(path + ".loadout is not a supported loadout encoding");

        double defaultX = 500;
        double defaultY = role == PuzzleBotRole.PLAYER ? 850 : 150;
        double defaultRotation = role == PuzzleBotRole.PLAYER ? 0 : 180;
        double defaultHp = BASE_BOT_HP;
        double startX = valueOrDefault(request == null ? null : request.getStartX(), defaultX);
        double startY = valueOrDefault(request == null ? null : request.getStartY(), defaultY);
        double rotation = valueOrDefault(request == null ? null : request.getRotation(), defaultRotation);
        double startHp = valueOrDefault(request == null ? null : request.getStartHp(), defaultHp);
        if (!Double.isFinite(startX) || startX < BOT_RADIUS || startX > ARENA_WIDTH - BOT_RADIUS) errors.add(path + ".startX must be from 30 to 970");
        if (!Double.isFinite(startY) || startY < BOT_RADIUS || startY > ARENA_HEIGHT - BOT_RADIUS) errors.add(path + ".startY must be from 30 to 970");
        if (!Double.isFinite(rotation) || rotation < -360 || rotation > 360) errors.add(path + ".rotation must be from -360 to 360");
        if (!Double.isFinite(startHp) || startHp < 1 || startHp > BASE_BOT_HP) errors.add(path + ".startHp must be from 1 to " + (int) BASE_BOT_HP);
        if (!hasAtMostOneDecimal(startX)) errors.add(path + ".startX must have at most one decimal place");
        if (!hasAtMostOneDecimal(startY)) errors.add(path + ".startY must have at most one decimal place");
        if (!hasAtMostOneDecimal(rotation)) errors.add(path + ".rotation must have at most one decimal place");
        if (!hasAtMostOneDecimal(startHp)) errors.add(path + ".startHp must have at most one decimal place");

        JsonNode brain = brainWithLoadout(request == null ? null : request.getBrain(), loadout, path, errors);
        if (brain != null) {
            errors.addAll(botValidationService.validateForSimulation(brain).stream()
                    .map(error -> path + ".brain: " + error)
                    .toList());
            int actions = countActionNodes(brain.path("roots"));
            int conditions = countConditionNodes(brain.path("roots"));
            int variables = brain.path("customVariables").isArray() ? brain.path("customVariables").size() : 0;
            if (actions > maxActionNodes) errors.add(path + ".brain uses " + actions + " action nodes; puzzle allows " + maxActionNodes);
            if (conditions > maxConditionNodes) errors.add(path + ".brain uses " + conditions + " condition nodes; puzzle allows " + maxConditionNodes);
            if (variables > maxCustomVariables) errors.add(path + ".brain uses " + variables + " custom variables; puzzle allows " + maxCustomVariables);
            if (role == PuzzleBotRole.PLAYER) rejectPuzzleVariableNamespace(brain, path, errors);
        }
        return new ValidatedBot(0, 0, role, loadout, startX, startY, rotation, startHp, brain);
    }

    private void rejectPuzzleVariableNamespace(JsonNode brain, String path, List<String> errors) {
        JsonNode variables = brain == null ? null : brain.get("customVariables");
        if (variables == null || !variables.isArray()) return;
        for (int index = 0; index < variables.size(); index += 1) {
            String id = variables.get(index).path("id").asText("");
            if (id.startsWith(PUZZLE_VARIABLE_PREFIX)) {
                errors.add(path + ".brain.customVariables[" + index + "] uses a reserved puzzle variable namespace");
            }
        }
    }

    private JsonNode brainWithLoadout(JsonNode source, String loadout, String path, List<String> errors) {
        if (source == null || !source.isObject()) {
            errors.add(path + ".brain must be an object");
            return null;
        }
        if (!(source.deepCopy() instanceof ObjectNode object)) {
            errors.add(path + ".brain must be an object");
            return null;
        }
        ObjectNode loadoutNode = jsonMapper.createObjectNode();
        ArrayNode abilities = loadoutNode.putArray("abilities");
        for (Integer ability : abilityIds(loadout)) abilities.add(ability);
        object.set("loadout", loadoutNode);
        try {
            if (jsonMapper.writeValueAsString(object).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_JSON_BYTES) {
                errors.add(path + ".brain is too large");
            }
        } catch (Exception exception) {
            errors.add(path + ".brain could not be serialized");
        }
        return object;
    }

    private PuzzleBot toPuzzleBot(ValidatedBot source) {
        PuzzleBot bot = new PuzzleBot();
        bot.setRole(source.role());
        bot.setTeamNumber(source.teamNumber());
        bot.setSlot(source.slot());
        applyValidatedBot(bot, source);
        return bot;
    }

    private void applyValidatedPuzzle(Puzzle puzzle, ValidatedPuzzle validated) {
        puzzle.setName(validated.name());
        puzzle.setDescription(validated.description());
        puzzle.setInitialElapsedMs(validated.initialElapsedMs());
        puzzle.setStatus(validated.published() ? PuzzleStatus.PUBLISHED : PuzzleStatus.DRAFT);
        puzzle.setHideOpponentCode(validated.hideOpponentCode());
        puzzle.setTimeLimitMs(validated.timeLimitMs());
        puzzle.setMaxActionNodes(validated.maxActionNodes());
        puzzle.setMaxConditionNodes(validated.maxConditionNodes());
        puzzle.setMaxCustomVariables(validated.maxCustomVariables());
        puzzle.setPlayerTeamSize(validated.playerTeamSize());
        puzzle.setOpponentTeamSize(validated.opponentTeamSize());
        puzzle.setWinConditions(toJson(validated.winConditions()));
        puzzle.setLoseConditions(toJson(validated.loseConditions()));
        puzzle.setLogicConfiguration(toJson(validated.logicConfiguration()));
    }

    private void updatePuzzleBots(Puzzle puzzle, List<ValidatedBot> sources) {
        Set<String> retainedKeys = new HashSet<>();
        for (ValidatedBot source : sources) {
            String key = puzzleBotKey(source.teamNumber(), source.slot());
            PuzzleBot bot = puzzle.getBots().stream()
                    .filter(candidate -> key.equals(puzzleBotKey(candidate.getTeamNumber(), candidate.getSlot())))
                    .findFirst()
                    .orElseGet(() -> puzzle.getBots().stream()
                            .filter(candidate -> candidate.getRole() == source.role()
                                    && (source.slot() == 1 || candidate.getSlot() == source.slot()))
                            .findFirst()
                            .orElse(null));
            if (bot == null) {
                bot = new PuzzleBot();
                puzzle.addBot(bot);
            }
            bot.setRole(source.role());
            bot.setTeamNumber(source.teamNumber());
            bot.setSlot(source.slot());
            applyValidatedBot(bot, source);
            retainedKeys.add(key);
        }
        puzzle.getBots().removeIf(bot -> !retainedKeys.contains(puzzleBotKey(bot.getTeamNumber(), bot.getSlot())));
    }

    private String puzzleBotKey(int teamNumber, int slot) {
        return teamNumber + ":" + slot;
    }

    private void applyValidatedBot(PuzzleBot bot, ValidatedBot source) {
        bot.setLoadout(source.loadout());
        bot.setStartX(source.startX());
        bot.setStartY(source.startY());
        bot.setRotation(source.rotation());
        bot.setStartHp(source.startHp());
        bot.setBrainPayload(toJson(source.brain()));
    }

    private List<PuzzleBot> orderedBots(List<PuzzleBot> bots) {
        return (bots == null ? List.<PuzzleBot>of() : bots).stream()
                .sorted(Comparator.comparingInt(PuzzleBot::getTeamNumber).thenComparingInt(PuzzleBot::getSlot))
                .toList();
    }

    private Comparator<CachedPuzzleBot> cachedBotOrder() {
        return Comparator.comparingInt(CachedPuzzleBot::teamNumber).thenComparingInt(CachedPuzzleBot::slot);
    }

    private PuzzleAdminResponseDTO toAdminResponse(Puzzle puzzle) {
        PuzzleAdminResponseDTO response = new PuzzleAdminResponseDTO();
        response.setId(puzzle.getId());
        response.setPuzzleNumber(puzzle.getPuzzleNumber());
        response.setName(puzzle.getName());
        response.setDescription(puzzle.getDescription());
        response.setInitialElapsedMs(puzzle.getInitialElapsedMs());
        response.setStatus(puzzle.getStatus().name());
        response.setHideOpponentCode(puzzle.isHideOpponentCode());
        response.setTimeLimitMs(puzzle.getTimeLimitMs());
        response.setMaxActionNodes(puzzle.getMaxActionNodes());
        response.setMaxConditionNodes(puzzle.getMaxConditionNodes());
        response.setMaxCustomVariables(puzzle.getMaxCustomVariables());
        response.setPlayerTeamSize(puzzle.getPlayerTeamSize());
        response.setOpponentTeamSize(puzzle.getOpponentTeamSize());
        response.setLogicConfiguration(readJson(puzzle.getLogicConfiguration(), jsonMapper.createObjectNode()));
        response.setWinConditions(readJson(puzzle.getWinConditions(), jsonMapper.createArrayNode()));
        response.setLoseConditions(readJson(puzzle.getLoseConditions(), jsonMapper.createArrayNode()));
        response.setBots(orderedBots(puzzle.getBots()).stream().map(this::toBotResponse).toList());
        return response;
    }

    private CachedPuzzle toCachedPuzzle(Puzzle puzzle) {
        return new CachedPuzzle(
                puzzle.getId(),
                puzzle.getPuzzleNumber(),
                puzzle.getName(),
                puzzle.getDescription(),
                puzzle.getInitialElapsedMs(),
                puzzle.isHideOpponentCode(),
                puzzle.getTimeLimitMs(),
                puzzle.getMaxActionNodes(),
                puzzle.getMaxConditionNodes(),
                puzzle.getMaxCustomVariables(),
                puzzle.getPlayerTeamSize(),
                puzzle.getOpponentTeamSize(),
                readJson(puzzle.getLogicConfiguration(), jsonMapper.createObjectNode()),
                readJson(puzzle.getWinConditions(), jsonMapper.createArrayNode()),
                readJson(puzzle.getLoseConditions(), jsonMapper.createArrayNode()),
                orderedBots(puzzle.getBots()).stream().map(this::toCachedPuzzleBot).toList());
    }

    private CachedPuzzleBot toCachedPuzzleBot(PuzzleBot bot) {
        return new CachedPuzzleBot(
                bot.getId(),
                bot.getRole(),
                bot.getTeamNumber(),
                bot.getSlot(),
                bot.getLoadout(),
                bot.getStartX(),
                bot.getStartY(),
                bot.getRotation(),
                bot.getStartHp(),
                readJson(bot.getBrainPayload(), jsonMapper.createObjectNode()));
    }

    private PuzzlePlayResponseDTO toPlayResponse(CachedPuzzle puzzle) {
        PuzzlePlayResponseDTO response = new PuzzlePlayResponseDTO();
        response.setPuzzleNumber(puzzle.puzzleNumber());
        response.setName(puzzle.name());
        response.setDescription(puzzle.description());
        response.setInitialElapsedMs(puzzle.initialElapsedMs());
        response.setHideOpponentCode(puzzle.hideOpponentCode());
        response.setTimeLimitMs(puzzle.timeLimitMs());
        response.setMaxActionNodes(puzzle.maxActionNodes());
        response.setMaxConditionNodes(puzzle.maxConditionNodes());
        response.setMaxCustomVariables(puzzle.maxCustomVariables());
        response.setPlayerTeamSize(puzzle.playerTeamSize());
        response.setOpponentTeamSize(puzzle.opponentTeamSize());
        response.setLogicConfiguration(puzzle.logicConfiguration().deepCopy());
        response.setWinConditions(puzzle.winConditions().deepCopy());
        response.setLoseConditions(puzzle.loseConditions().deepCopy());
        response.setBots(puzzle.bots().stream().sorted(cachedBotOrder()).map(this::toBotResponse).toList());
        return response;
    }

    private PuzzleBotResponseDTO toBotResponse(CachedPuzzleBot bot) {
        PuzzleBotResponseDTO response = new PuzzleBotResponseDTO();
        response.setId(bot.id());
        response.setRole(bot.role().name());
        response.setTeamNumber(bot.teamNumber());
        response.setSlot(bot.slot());
        response.setLoadout(bot.loadout());
        response.setStartX(bot.startX());
        response.setStartY(bot.startY());
        response.setRotation(bot.rotation());
        response.setStartHp(bot.startHp());
        response.setBrain(bot.brain() == null ? null : bot.brain().deepCopy());
        return response;
    }

    private PuzzleBotResponseDTO toBotResponse(PuzzleBot bot) {
        PuzzleBotResponseDTO response = new PuzzleBotResponseDTO();
        response.setId(bot.getId());
        response.setRole(bot.getRole().name());
        response.setTeamNumber(bot.getTeamNumber());
        response.setSlot(bot.getSlot());
        response.setLoadout(bot.getLoadout());
        response.setStartX(bot.getStartX());
        response.setStartY(bot.getStartY());
        response.setRotation(bot.getRotation());
        response.setStartHp(bot.getStartHp());
        response.setBrain(readJson(bot.getBrainPayload(), jsonMapper.createObjectNode()));
        return response;
    }

    private long nextPuzzleNumber() {
        return puzzleRepository.findTopByOrderByPuzzleNumberDesc()
                .map(Puzzle::getPuzzleNumber)
                .map(number -> number + 1)
                .orElse(1L);
    }

    private String toJson(JsonNode node) {
        try {
            return jsonMapper.writeValueAsString(node == null ? jsonMapper.createArrayNode() : node);
        } catch (Exception exception) {
            throw new PuzzleValidationException(List.of("puzzle JSON could not be saved"));
        }
    }

    private JsonNode readJson(String value, JsonNode fallback) {
        try {
            return value == null || value.isBlank() ? fallback : jsonMapper.readTree(value);
        } catch (Exception exception) {
            return fallback;
        }
    }

    private JsonNode arrayOrEmpty(JsonNode value, String field, List<String> errors) {
        if (value == null || value.isNull()) return jsonMapper.createArrayNode();
        if (!value.isArray()) {
            errors.add(field + " must be an array");
            return jsonMapper.createArrayNode();
        }
        return value;
    }

    private void validateConditionArray(JsonNode value, String field, List<String> errors) {
        if (value == null || !value.isArray()) return;
        if (value.size() > MAX_CONDITION_COUNT) errors.add(field + " cannot contain more than " + MAX_CONDITION_COUNT + " conditions");
        try {
            if (jsonMapper.writeValueAsString(value).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_CONDITION_JSON_BYTES) {
                errors.add(field + " is too large");
            }
        } catch (Exception exception) {
            errors.add(field + " could not be serialized");
        }
        for (int index = 0; index < value.size(); index += 1) {
            JsonNode condition = value.get(index);
            if (condition == null || !condition.isObject()) errors.add(field + "[" + index + "] must be an object");
            else validateCondition(condition, field + "[" + index + "]", errors);
        }
    }

    private void validateCondition(JsonNode condition, String path, List<String> errors) {
        validateBotCondition(condition, path, errors);
    }

    private void validateBotCondition(JsonNode condition, String path, List<String> errors) {
        JsonNode typeNode = condition.get("type");
        if (typeNode == null || !typeNode.isTextual()
                || !Set.of(BotLogicContracts.CONDITION_ALWAYS, BotLogicContracts.CONDITION_EXPRESSION).contains(typeNode.asText())) {
            errors.add(path + ".type must be always or expression");
            return;
        }

        validateConditionId(condition, path, errors);
        JsonNode join = condition.get("join");
        if (join != null && (!join.isTextual() || !Set.of("and", "or").contains(join.asText()))) {
            errors.add(path + ".join must be and or or");
        }
        if (BotLogicContracts.CONDITION_ALWAYS.equals(typeNode.asText())) return;

        String left = condition.path("left").asText("");
        BotLogicContracts.VariableContract leftContract = BotLogicContracts.variableContract(left);
        boolean customLeft = isCustomVariableId(left);
        if (leftContract == null && !customLeft) {
            errors.add(path + ".left is not a supported state variable");
        }

        String leftValueType = leftContract == null ? null : BotLogicContracts.variableValueType(left);
        JsonNode comparator = condition.get("comparator");
        Set<String> comparators = "boolean".equals(leftValueType)
                ? BotLogicContracts.booleanComparators()
                : BotLogicContracts.numericComparators();
        if (comparator == null || !comparator.isTextual() || !comparators.contains(comparator.asText())) {
            errors.add(path + ".comparator is not supported for this variable");
        }

        String targetMode = validateConditionTarget(condition, path, leftContract, errors);
        validateConditionSelectable(condition.get("selectable"), path + ".selectable", null, null, errors);
        validateConditionSelectable(condition.get("selectable1"), path + ".selectable1", null, null, errors);
        validateConditionSelectable(condition.get("selectable2"), path + ".selectable2", null, null, errors);
        if (leftContract != null && leftContract.isPairVariable()) {
            JsonNode selectable1 = condition.has("selectable1")
                    ? condition.get("selectable1") : textNode(BotLogicContracts.defaultSelectable1ForVariable(leftContract));
            JsonNode selectable2 = condition.has("selectable2")
                    ? condition.get("selectable2")
                    : condition.has("selectable") ? condition.get("selectable")
                        : textNode(BotLogicContracts.defaultSelectable2ForVariable(leftContract));
            validateConditionSelectable(selectable1, path + ".selectable1", leftContract.pairSelectableIdentities(0), leftContract, errors);
            if (BotLogicContracts.TARGET_MODE_TARGET.equals(targetMode)) {
                validateConditionSelectable(selectable2, path + ".selectable2", leftContract.pairSelectableIdentities(1), leftContract, errors);
            }
        } else {
            validateConditionSelectable(condition.get("leftSelectable"), path + ".leftSelectable",
                    leftContract == null ? null : leftContract.selectableIdentities(),
                    leftContract, errors);
        }

        validateConditionSelection(condition, path, leftContract, errors);

        JsonNode right = condition.get("right");
        if (right == null || !right.isObject()) {
            errors.add(path + ".right must be an operand object");
            return;
        }
        String rightType = right.path("type").asText("");
        if ("variable".equals(rightType)) {
            String rightId = right.path("value").asText("");
            BotLogicContracts.VariableContract rightContract = BotLogicContracts.variableContract(rightId);
            if (rightContract == null && !isCustomVariableId(rightId)) {
                errors.add(path + ".right.value is not a supported state variable");
            }
            if (rightContract != null && !"number".equals(BotLogicContracts.variableValueType(rightId))) {
                errors.add(path + ".right.value must reference a numeric variable");
            }
            validateConditionSelectable(right.get("rightSelectable"), path + ".rightSelectable",
                    rightContract == null ? null : rightContract.selectableIdentities(),
                    rightContract, errors);
            return;
        }
        if ("boolean".equals(rightType)) {
            if (leftContract != null && !"boolean".equals(leftValueType)) {
                errors.add(path + ".right boolean operand requires a boolean left variable");
            }
            if (!right.has("value") || !right.get("value").isBoolean()) {
                errors.add(path + ".right.value must be boolean");
            }
            return;
        }
        if ("number".equals(rightType)) {
            if ("boolean".equals(leftValueType)) errors.add(path + ".right number operand requires a numeric left variable");
            JsonNode value = right.get("value");
            if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble())
                    || Math.abs(value.asDouble()) > MAX_CONDITION_NUMBER) {
                errors.add(path + ".right.value must be a finite number");
            }
            return;
        }
        errors.add(path + ".right.type must be number, boolean, or variable");
    }

    private String validateConditionTarget(
            JsonNode condition,
            String path,
            BotLogicContracts.VariableContract variableContract,
            List<String> errors) {
        boolean hasTargetFields = condition.has("targetMode") || condition.has("targetX")
                || condition.has("targetY") || condition.has("targetAngle");
        if (variableContract == null || variableContract.targetModes().isEmpty()) {
            if (hasTargetFields) errors.add(path + ".targetMode is not supported for this variable");
            return BotLogicContracts.TARGET_MODE_TARGET;
        }
        JsonNode modeNode = condition.get("targetMode");
        String mode;
        if (modeNode == null) {
            mode = condition.has("targetX") || condition.has("targetY")
                    ? BotLogicContracts.TARGET_MODE_COORDINATES
                    : condition.has("targetAngle") ? BotLogicContracts.TARGET_MODE_ANGLE : BotLogicContracts.TARGET_MODE_TARGET;
        } else if (!modeNode.isTextual()) {
            errors.add(path + ".targetMode must be target, coordinates, or angle");
            return BotLogicContracts.TARGET_MODE_TARGET;
        } else {
            mode = modeNode.asText();
        }
        if (!variableContract.targetModes().contains(mode)) {
            errors.add(path + ".targetMode is not supported for this variable");
            return BotLogicContracts.TARGET_MODE_TARGET;
        }
        if (BotLogicContracts.TARGET_MODE_COORDINATES.equals(mode)) {
            validateConditionCoordinate(condition.get("targetX"), path + ".targetX", errors);
            validateConditionCoordinate(condition.get("targetY"), path + ".targetY", errors);
        } else if (BotLogicContracts.TARGET_MODE_ANGLE.equals(mode)) {
            JsonNode angle = condition.get("targetAngle");
            if (angle == null || !angle.isNumber() || !Double.isFinite(angle.asDouble())
                    || angle.asDouble() < BotLogicContracts.ANGLE_MIN || angle.asDouble() > BotLogicContracts.ANGLE_MAX) {
                errors.add(path + ".targetAngle must be an angle from -360 to 360 degrees");
            }
        }
        return mode;
    }

    private void validateConditionCoordinate(JsonNode value, String path, List<String> errors) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble())
                || value.asDouble() < 0 || value.asDouble() > 1000) {
            errors.add(path + " must be a number from 0 to 1000");
        }
    }

    private void validateConditionId(JsonNode condition, String path, List<String> errors) {
        JsonNode id = condition.get("id");
        if (id != null && (!id.isTextual() || id.asText().length() > 100)) {
            errors.add(path + ".id must be a string of at most 100 characters");
        }
    }

    private void validateConditionSelection(
            JsonNode condition,
            String path,
            BotLogicContracts.VariableContract variable,
            List<String> errors) {
        JsonNode ability = condition.get("ability");
        if (ability != null && (!ability.isIntegralNumber() || !ability.canConvertToInt()
                || !AbilityContracts.actions().contains(ability.intValue()))) {
            errors.add(path + ".ability is not supported");
        }
        if (variable != null && variable.requiresAbility() && ability == null) {
            errors.add(path + ".ability is required for this variable");
        }

        JsonNode statusEffect = condition.get("statusEffect");
        if (statusEffect != null && (!statusEffect.isTextual()
                || !BotLogicContracts.statusEffects().contains(statusEffect.asText().toLowerCase(java.util.Locale.ROOT)))) {
            errors.add(path + ".statusEffect is not supported");
        }
        if (variable != null && variable.requiresStatusEffect()
                && (statusEffect == null || !statusEffect.isTextual() || statusEffect.asText().isBlank())) {
            errors.add(path + ".statusEffect is required for this variable");
        }
    }

    private void validateConditionSelectable(
            JsonNode selectable,
            String path,
            Set<BotLogicContracts.SelectableIdentity> requiredSelectableIdentities,
            BotLogicContracts.VariableContract variable,
            List<String> errors) {
        if (selectable == null) return;
        if (!selectable.isTextual() || selectable.asText().length() > 100 || !BotLogicContracts.isAllowedSelectable(selectable.asText())) {
            errors.add(path + " is not a supported selectable");
            return;
        }
        if (variable != null && variable.requiresHealthSelectable()
                && !BotLogicContracts.selectableSupportsCapability(selectable.asText(), BotLogicContracts.SELECTABLE_CAPABILITY_HEALTH)) {
            errors.add(path + " must reference a health-bearing selectable");
        }
        String base = selectable.asText().split(":", -1)[0];
        if (variable != null && !variable.selectableOrderable() && selectable.asText().contains(":")) {
            errors.add(path + " does not support selectable ordering");
        }
        if (!BotLogicContracts.selectableMatchesIdentities(base, requiredSelectableIdentities)) {
            errors.add(path + " does not provide the selectable identities required by this variable");
        }
    }

    private JsonNode textNode(String value) {
        return jsonMapper.getNodeFactory().textNode(value);
    }

    private boolean isCustomVariableId(String value) {
        return value != null && value.matches("custom\\.[A-Za-z0-9_.-]{1,52}");
    }

    private boolean validLoadoutEncoding(String loadout) {
        if (loadout == null) return false;
        if (loadout.startsWith("sandbox:")) {
            String body = loadout.substring("sandbox:".length());
            if (body.isBlank()) return true;
            String[] values = body.split(",", -1);
            if (values.length > 6) return false;
            Set<Integer> ids = new HashSet<>();
            for (String value : values) {
                try {
                    int id = Integer.parseInt(value);
                    if (!ids.add(id)
                            || !AbilityContracts.actions().contains(id)
                            || GameConfigCatalog.STANDARD_ABILITIES.contains(id)) return false;
                } catch (NumberFormatException exception) {
                    return false;
                }
            }
            return true;
        }
        if (loadout.startsWith("custom:")) {
            String body = loadout.substring("custom:".length());
            return body.length() <= 6
                    && body.chars().distinct().count() == body.length()
                    && body.chars().allMatch(code -> CompactAbilityCode.idForCode(String.valueOf((char) code)) != null);
        }
        return false;
    }

    private Set<Integer> abilityIds(String loadout) {
        Set<Integer> result = new HashSet<>();
        if (loadout == null) return result;
        if (loadout.startsWith("sandbox:")) {
            for (String value : loadout.substring("sandbox:".length()).split(",")) {
                try { result.add(Integer.parseInt(value)); } catch (NumberFormatException ignored) { }
            }
        } else if (loadout.startsWith("custom:")) {
            loadout.substring("custom:".length()).chars()
                    .mapToObj(code -> CompactAbilityCode.idForCode(String.valueOf((char) code)))
                    .filter(java.util.Objects::nonNull)
                    .forEach(result::add);
        }
        return result;
    }

    private int countActionNodes(JsonNode node) {
        if (node == null) return 0;
        if (node.isArray()) { int total = 0; for (JsonNode child : node) total += countActionNodes(child); return total; }
        if (!node.isObject()) return 0;
        int total = 0;
        if (node.path("actions").isArray()) total += node.path("actions").size();
        else if (node.has("action") && !"none".equals(node.path("action").asText())) total += 1;
        for (var entry : node.properties()) {
            if (!Set.of("actions", "action").contains(entry.getKey())) total += countActionNodes(entry.getValue());
        }
        return total;
    }

    private int countConditionNodes(JsonNode node) {
        if (node == null) return 0;
        if (node.isArray()) { int total = 0; for (JsonNode child : node) total += countConditionNodes(child); return total; }
        if (!node.isObject()) return 0;
        int total = node.path("conditions").isArray() ? node.path("conditions").size() : 0;
        for (var entry : node.properties()) {
            if (!"conditions".equals(entry.getKey())) total += countConditionNodes(entry.getValue());
        }
        return total;
    }

    private int valueOrDefault(Integer value, int fallback) { return value == null ? fallback : value; }
    private double valueOrDefault(Double value, double fallback) { return value == null ? fallback : value; }

    private boolean hasAtMostOneDecimal(double value) {
        if (!Double.isFinite(value)) return false;
        double scaled = value * 10;
        return Math.abs(scaled - Math.rint(scaled)) < 0.000000001d;
    }

    private record ValidatedPuzzle(
            String name,
            String description,
            int initialElapsedMs,
            boolean published,
            boolean hideOpponentCode,
            int timeLimitMs,
            int maxActionNodes,
            int maxConditionNodes,
            int maxCustomVariables,
            int playerTeamSize,
            int opponentTeamSize,
            JsonNode winConditions,
            JsonNode loseConditions,
            JsonNode logicConfiguration,
            List<ValidatedBot> bots) { }

    private record ValidatedBot(
            int teamNumber,
            int slot,
            PuzzleBotRole role,
            String loadout,
            double startX,
            double startY,
            double rotation,
            double startHp,
            JsonNode brain) {
        private ValidatedBot withIdentity(PuzzleBotRole nextRole, int nextTeamNumber, int nextSlot) {
            return new ValidatedBot(nextTeamNumber, nextSlot, nextRole, loadout, startX, startY, rotation, startHp, brain);
        }
    }

    public record PuzzleAttemptDefinition(
            long puzzleNumber,
            int timeLimitMs,
            int initialElapsedMs,
            JsonNode winConditions,
            JsonNode loseConditions,
            JsonNode logicConfiguration,
            List<PuzzleBotDefinition> bots) {
        public PuzzleAttemptDefinition {
            bots = List.copyOf(bots == null ? List.of() : bots);
        }

        public PuzzleAttemptDefinition(
                long puzzleNumber,
                int timeLimitMs,
                int initialElapsedMs,
                JsonNode winConditions,
                JsonNode loseConditions,
                JsonNode logicConfiguration,
                PuzzleBotDefinition playerBot,
                PuzzleBotDefinition opponentBot) {
            this(
                    puzzleNumber,
                    timeLimitMs,
                    initialElapsedMs,
                    winConditions,
                    loseConditions,
                    logicConfiguration,
                    List.of(
                            playerBot.withIdentity(PuzzleBotRole.PLAYER, 1, 1),
                            opponentBot.withIdentity(PuzzleBotRole.OPPONENT, 2, 1)));
        }

        public PuzzleBotDefinition playerBot() {
            return bots.stream()
                    .filter(bot -> bot.teamNumber() == 1 && bot.slot() == 1)
                    .findFirst()
                    .orElse(null);
        }

        public PuzzleBotDefinition opponentBot() {
            return bots.stream()
                    .filter(bot -> bot.teamNumber() == 2)
                    .findFirst()
                    .orElse(null);
        }
    }

    public record PuzzleBotDefinition(
            int teamNumber,
            int slot,
            PuzzleBotRole role,
            String loadout,
            double startX,
            double startY,
            double rotation,
            double startHp,
            JsonNode brain) {
        public PuzzleBotDefinition withIdentity(PuzzleBotRole nextRole, int nextTeamNumber, int nextSlot) {
            return new PuzzleBotDefinition(nextTeamNumber, nextSlot, nextRole, loadout, startX, startY, rotation, startHp, brain);
        }

        public PuzzleBotDefinition(
                String loadout,
                double startX,
                double startY,
                double rotation,
                double startHp,
                JsonNode brain) {
            this(1, 1, PuzzleBotRole.PLAYER, loadout, startX, startY, rotation, startHp, brain);
        }

        public PuzzleBotDefinition(
                String loadout,
                double startX,
                double startY,
                double rotation,
                JsonNode brain) {
            this(1, 1, PuzzleBotRole.PLAYER, loadout, startX, startY, rotation, BASE_BOT_HP, brain);
        }
    }
}
