package com.example.botfight.service.puzzle;

import java.util.stream.Collectors;

import com.example.botfight.DTO.puzzle.PuzzleAdminResponseDTO;
import com.example.botfight.DTO.puzzle.PuzzleBotRequestDTO;
import com.example.botfight.DTO.puzzle.PuzzleBotResponseDTO;
import com.example.botfight.DTO.puzzle.PuzzleListItemDTO;
import com.example.botfight.DTO.puzzle.PuzzleListPageDTO;
import com.example.botfight.DTO.puzzle.PuzzlePlayResponseDTO;
import com.example.botfight.DTO.puzzle.PuzzleSaveRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.puzzle.Puzzle;
import com.example.botfight.domain.puzzle.PuzzleBot;
import com.example.botfight.domain.puzzle.PuzzleBotRole;
import com.example.botfight.domain.puzzle.PuzzleStatus;
import com.example.botfight.domain.auth.UserRole;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.PuzzleRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzle;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedPuzzleBot;
import com.example.botfight.service.cache.DatabaseLookupCache.PuzzleListKey;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import com.example.botfight.simulation.geometry.ArenaUnits;
import com.example.botfight.simulation.geometry.ArenaCoordinates;
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
    private static final int MAX_JSON_BYTES = 750_000;
    private static final int MAX_ACTION_NODES = 100;
    private static final int MAX_CONDITION_NODES = 300;
    private static final int MAX_CUSTOM_VARIABLES = 100;
    private static final int MIN_PUZZLE_TEAM_SIZE = 1;
    private static final int MAX_PUZZLE_TEAM_SIZE = 2;
    private static final double ARENA_HEIGHT = ArenaUnits.HEIGHT;
    private static final double BOT_SIZE = 60;
    private static final double BOT_RADIUS = BOT_SIZE / 2;
    private static final double BASE_BOT_HP = 300;
    public static final String PUZZLE_COORDINATE_SYSTEM_VERSION = "centered-y-up-v1";

    private final PuzzleRepository puzzleRepository;
    private final PuzzleCompletionRepository puzzleCompletionRepository;
    private final CurrentUserService currentUserService;
    private final BotSubmissionValidationService botValidationService;
    private final JsonMapper jsonMapper;
    private final TokenBucketRateLimiter<UUID> adminPuzzleCreationRateLimiter;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;
    private final DatabaseLookupCache databaseLookupCache;

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
    public PuzzleListPageDTO listPublished(
            int requestedPage,
            int requestedSize,
            String requestedQuery,
            Authentication authentication) {
        int page = Math.min(Math.max(0, requestedPage), 10_000);
        int size = Math.min(Math.max(1, requestedSize), PAGE_SIZE);
        String query = normalizeSearchQuery(requestedQuery);
        UUID userId = authentication == null
                ? null
                : requireAuthenticatedGetAllowed(authentication, "puzzle-list");
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
        if (user.isGuest()) {
            return;
        }
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
        UUID userId = requireAuthenticatedGetAllowed(authentication, "puzzle-detail");
        return getPublishedInternal(puzzleNumber, userId);
    }

    private PuzzlePlayResponseDTO getPublishedInternal(long puzzleNumber) {
        return getPublishedInternal(puzzleNumber, null);
    }

    private PuzzlePlayResponseDTO getPublishedInternal(long puzzleNumber, UUID userId) {
        CachedPuzzle puzzle = publishedPuzzle(puzzleNumber);
        boolean solved = userId != null
                && !puzzleCompletionRepository.findByUserIdAndPuzzleIdIn(userId, List.of(puzzle.id())).isEmpty();
        return toPlayResponse(puzzle, solved);
    }

    private UUID requireAuthenticatedGetAllowed(Authentication authentication, String category) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        authenticatedGetRateLimiter.requireAllowed(category + ":" + userId);
        return userId;
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
                puzzle.logicConfiguration().deepCopy(),
                List.copyOf(definitions));
    }

    private Set<UUID> solvedPuzzleIds(UUID userId, List<Puzzle> puzzles) {
        if (userId == null || puzzles.isEmpty()) return Set.of();
        List<UUID> puzzleIds = puzzles.stream().map(Puzzle::getId).toList();
        return puzzleCompletionRepository.findByUserIdAndPuzzleIdIn(userId, puzzleIds).stream()
                .map(completion -> completion.getPuzzle().getId())
                .collect(Collectors.toSet());
    }

    private PuzzleBotRequestDTO botRequest(CachedPuzzleBot bot, JsonNode brain) {
        PuzzleBotRequestDTO request = new PuzzleBotRequestDTO();
        request.setRole(bot.role() == null ? null : bot.role().name());
        request.setTeamNumber(bot.teamNumber());
        request.setSlot(bot.slot());
        request.setLoadout(bot.loadout());
        ArenaCoordinates.Point publicStart = ArenaCoordinates.toPublic(bot.startX(), bot.startY());
        request.setStartX(publicStart.x());
        request.setStartY(publicStart.y());
        request.setRotation(bot.rotation());
        request.setStartHp(bot.startHp());
        request.setBrain(brain == null ? null : brain.deepCopy());
        return request;
    }

    private ValidatedPuzzle validate(PuzzleSaveRequestDTO request) {
        List<String> errors = new ArrayList<>();
        if (request == null || !PUZZLE_COORDINATE_SYSTEM_VERSION.equals(request.getCoordinateSystemVersion())) {
            errors.add("coordinateSystemVersion must be " + PUZZLE_COORDINATE_SYSTEM_VERSION);
        }
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

        JsonNode logicConfiguration = request == null ? null : request.getLogicConfiguration();
        errors.addAll(botValidationService.validateConditionRulesForSimulation(logicConfiguration).stream()
                .map(error -> "logicConfiguration: " + error).toList());

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


        double defaultX = 0;
        double defaultY = role == PuzzleBotRole.PLAYER ? -450 : 450;
        double defaultRotation = role == PuzzleBotRole.PLAYER ? 0 : 180;
        double defaultHp = BASE_BOT_HP;
        double startX = valueOrDefault(request == null ? null : request.getStartX(), defaultX);
        double startY = valueOrDefault(request == null ? null : request.getStartY(), defaultY);
        double rotation = valueOrDefault(request == null ? null : request.getRotation(), defaultRotation);
        double startHp = valueOrDefault(request == null ? null : request.getStartHp(), defaultHp);
        if (!ArenaCoordinates.isPublicBotCenterCoordinate(startX)) {
            errors.add(path + ".startX must be a finite coordinate from "
                    + (int) ArenaCoordinates.PUBLIC_BOT_CENTER_MIN + " to "
                    + (int) ArenaCoordinates.PUBLIC_BOT_CENTER_MAX);
        }
        if (!ArenaCoordinates.isPublicBotCenterCoordinate(startY)) {
            errors.add(path + ".startY must be a finite coordinate from "
                    + (int) ArenaCoordinates.PUBLIC_BOT_CENTER_MIN + " to "
                    + (int) ArenaCoordinates.PUBLIC_BOT_CENTER_MAX);
        }
        if (!Double.isFinite(rotation) || rotation < -360 || rotation > 360) errors.add(path + ".rotation must be from -360 to 360");
        if (!Double.isFinite(startHp) || startHp < 1 || startHp > BASE_BOT_HP) errors.add(path + ".startHp must be from 1 to " + (int) BASE_BOT_HP);
        if (!hasAtMostOneDecimal(startX)) errors.add(path + ".startX must have at most one decimal place");
        if (!hasAtMostOneDecimal(startY)) errors.add(path + ".startY must have at most one decimal place");
        if (!hasAtMostOneDecimal(rotation)) errors.add(path + ".rotation must have at most one decimal place");
        if (!hasAtMostOneDecimal(startHp)) errors.add(path + ".startHp must have at most one decimal place");

        JsonNode brain = brainWithLoadout(request == null ? null : request.getBrain(), loadout, path, errors);
        if (brain != null) {
            errors.addAll(botValidationService.validatePuzzleBrainForSimulation(brain, maxActionNodes, maxConditionNodes, maxCustomVariables, role == PuzzleBotRole.PLAYER).stream()
                    .map(error -> path + ".brain: " + error)
                    .toList());

        }
        ArenaCoordinates.Point internalStart = ArenaCoordinates.toInternal(startX, startY);
        return new ValidatedBot(0, 0, role, loadout, internalStart.x(), internalStart.y(), rotation, startHp, brain);
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
        for (Integer ability : puzzleLoadoutAbilities(loadout, path, errors)) abilities.add(ability);
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
        response.setCoordinateSystemVersion(PUZZLE_COORDINATE_SYSTEM_VERSION);
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

    private PuzzlePlayResponseDTO toPlayResponse(CachedPuzzle puzzle, boolean solved) {
        PuzzlePlayResponseDTO response = new PuzzlePlayResponseDTO();
        response.setCoordinateSystemVersion(PUZZLE_COORDINATE_SYSTEM_VERSION);
        response.setPuzzleNumber(puzzle.puzzleNumber());
        response.setSolved(solved);
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
        ArenaCoordinates.Point publicStart = ArenaCoordinates.toPublic(bot.startX(), bot.startY());
        response.setStartX(publicStart.x());
        response.setStartY(publicStart.y());
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
        ArenaCoordinates.Point publicStart = ArenaCoordinates.toPublic(bot.getStartX(), bot.getStartY());
        response.setStartX(publicStart.x());
        response.setStartY(publicStart.y());
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

    /** Decode the non-brain loadout field using Spring's ability catalog; the brain schema checks totals and uniqueness. */
    private List<Integer> puzzleLoadoutAbilities(String loadout, String path, List<String> errors) {
        List<Integer> ids = new ArrayList<>();
        try {
            if (loadout.startsWith("sandbox:")) {
                String body = loadout.substring("sandbox:".length());
                if (!body.isBlank()) {
                    for (String value : body.split(",", -1)) {
                        int id = Integer.parseInt(value);
                        if (!AbilityCatalog.exists(id) || AbilityCatalog.isStandard(id)) throw new IllegalArgumentException();
                        ids.add(id);
                    }
                }
            } else if (loadout.startsWith("custom:")) {
                for (char code : loadout.substring("custom:".length()).toCharArray()) {
                    Integer id = AbilityCatalog.idForCode(String.valueOf(code));
                    if (id == null) throw new IllegalArgumentException();
                    ids.add(id);
                }
            } else throw new IllegalArgumentException();
        } catch (IllegalArgumentException invalid) {
            errors.add(path + ".loadout is not a supported loadout encoding");
        }
        return ids;
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
            JsonNode logicConfiguration,
            List<PuzzleBotDefinition> bots) {
        public PuzzleAttemptDefinition {
            bots = List.copyOf(bots == null ? List.of() : bots);
        }

        public PuzzleAttemptDefinition(
                long puzzleNumber,
                int timeLimitMs,
                int initialElapsedMs,
                JsonNode logicConfiguration,
                PuzzleBotDefinition playerBot,
                PuzzleBotDefinition opponentBot) {
            this(
                    puzzleNumber,
                    timeLimitMs,
                    initialElapsedMs,
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
