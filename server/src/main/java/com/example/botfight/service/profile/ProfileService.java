package com.example.botfight.service.profile;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.UsernamePolicy;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedUser;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedMatchStats;
import com.example.botfight.service.cache.DatabaseLookupCache.CachedRatings;
import com.example.botfight.service.cache.DatabaseLookupCache.ProfileHistoryKey;
import com.example.botfight.service.cache.DatabaseLookupCache.ProfileSearchKey;
import com.example.botfight.service.cache.DatabaseLookupCache.SolvedPuzzleHistoryKey;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.DTO.AboutMeRequestDTO;
import com.example.botfight.DTO.ProfileDTO;
import com.example.botfight.DTO.MatchHistoryPageDTO;
import com.example.botfight.DTO.ProfileSearchPageDTO;
import com.example.botfight.DTO.SolvedPuzzlePageDTO;
import com.example.botfight.DTO.ProfileDTO.RecentMatchDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.Profile;
import com.example.botfight.domain.PuzzleCompletion;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchParticipantRepository.RecentMatchProjection;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileService {

    private static final int MATCH_PAGE_SIZE = 20;
    private static final int MAX_HISTORY_PAGE = 10_000;
    private static final int MAX_OPPONENT_QUERY_LENGTH = 50;
    private static final int MAX_ABOUT_ME_LENGTH = 500;
    private static final int SEARCH_PAGE_SIZE = 20;
    private static final int MAX_SEARCH_PAGE = 10_000;
    private static final int MAX_USERNAME_QUERY_LENGTH = 50;
    private static final int PUZZLE_PAGE_SIZE = 20;
    private static final int MAX_PUZZLE_PAGE = 10_000;
    private final SlidingWindowRateLimiter<UUID> profileUpdateRateLimiter;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;
    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final PuzzleCompletionRepository puzzleCompletionRepository;
    private final ProfileRepository profileRepository;
    private final DatabaseLookupCache databaseLookupCache;
    private final EloRatingService eloRatingService;

    public ProfileService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            MatchParticipantRepository matchParticipantRepository,
            PuzzleCompletionRepository puzzleCompletionRepository,
            ProfileRepository profileRepository,
            @Qualifier("profileUpdateRateLimiter") SlidingWindowRateLimiter<UUID> profileUpdateRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this(
                currentUserService,
                userRepository,
                matchParticipantRepository,
                puzzleCompletionRepository,
                profileRepository,
                profileUpdateRateLimiter,
                authenticatedGetRateLimiter,
                new DatabaseLookupCache(),
                null);
    }

    public ProfileService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            MatchParticipantRepository matchParticipantRepository,
            PuzzleCompletionRepository puzzleCompletionRepository,
            ProfileRepository profileRepository,
            @Qualifier("profileUpdateRateLimiter") SlidingWindowRateLimiter<UUID> profileUpdateRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter,
            DatabaseLookupCache databaseLookupCache) {
        this(
                currentUserService,
                userRepository,
                matchParticipantRepository,
                puzzleCompletionRepository,
                profileRepository,
                profileUpdateRateLimiter,
                authenticatedGetRateLimiter,
                databaseLookupCache,
                null);
    }

    @Autowired
    public ProfileService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            MatchParticipantRepository matchParticipantRepository,
            PuzzleCompletionRepository puzzleCompletionRepository,
            ProfileRepository profileRepository,
            @Qualifier("profileUpdateRateLimiter") SlidingWindowRateLimiter<UUID> profileUpdateRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter,
            DatabaseLookupCache databaseLookupCache,
            EloRatingService eloRatingService) {
        this.profileUpdateRateLimiter = profileUpdateRateLimiter;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.puzzleCompletionRepository = puzzleCompletionRepository;
        this.profileRepository = profileRepository;
        this.databaseLookupCache = databaseLookupCache;
        this.eloRatingService = eloRatingService;
    }

    @Transactional(readOnly = true)
    public ProfileDTO currentProfile(Authentication authentication) {
        requireAuthenticatedGetAllowed(authentication, "profile");
        CachedUser user = currentUser(authentication);
        return profileForUser(user);
    }

    @Transactional(readOnly = true)
    public ProfileDTO publicProfile(Authentication authentication, String username) {
        requireAuthenticatedGetAllowed(authentication, "profile");
        currentUser(authentication);
        return profileForUser(publicUser(username));
    }

    @Transactional
    public ProfileDTO updateUsername(Authentication authentication, UsernameRequestDTO request) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        profileUpdateRateLimiter.requireAllowed(userId);
        AppUser user = currentUserService.requireCurrentUser(authentication);
        String username = UsernamePolicy.clean(request == null ? null : request.getUsername());
        UsernamePolicy.validate(username);
        if (userRepository.existsByUsernameIgnoreCaseAndIdNot(username, user.getId())) {
            throw new AuthException("username is already taken");
        }

        user.setUsername(username);
        try {
            databaseLookupCache.logDatabaseWrite(
                    "profile-summary",
                    user.getId(),
                    "update-username");
            userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException exception) {
            throw new AuthException("username is already taken");
        }
        databaseLookupCache.invalidateAfterUsernameChange(user.getId(), "username-updated");
        return profileForUser(user);
    }

    @Transactional
    public ProfileDTO updateAboutMe(Authentication authentication, AboutMeRequestDTO request) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        profileUpdateRateLimiter.requireAllowed(userId);
        AppUser user = currentUserService.requireCurrentUser(authentication);
        String aboutMe = normalizeAboutMe(request == null ? null : request.getAboutMe());
        databaseLookupCache.logDatabaseWrite(
                "profile-summary",
                user.getId(),
                "update-about-me-profile-lookup");
        Profile profile = profileRepository.findByUserId(user.getId())
                .orElseGet(() -> {
                    Profile created = new Profile();
                    created.setUser(user);
                    return created;
        });
        profile.setAboutMe(aboutMe);
        profileRepository.saveAndFlush(profile);
        databaseLookupCache.invalidateAfterAboutMeChange(user.getId(), "about-me-updated");
        return profileForUser(user);
    }

    private CachedUser currentUser(Authentication authentication) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        return databaseLookupCache.currentUser(
                userId,
                () -> {
                    AppUser user = currentUserService.requireCurrentUser(authentication);
                    return new CachedUser(user.getId(), user.getUsername(), user.getCreatedAt());
                });
    }

    private ProfileDTO profileForUser(AppUser user) {
        return profileForUser(new CachedUser(user.getId(), user.getUsername(), user.getCreatedAt()));
    }

    private ProfileDTO profileForUser(CachedUser user) {
        return databaseLookupCache.profileSummary(user.id(), () -> loadProfileSummary(user));
    }

    private ProfileDTO loadProfileSummary(CachedUser user) {
        String aboutMe = profileRepository.findByUserId(user.id())
                .map(Profile::getAboutMe)
                .orElse("");
        CachedMatchStats matchStats = databaseLookupCache.profileMatchStats(
                user.id(),
                () -> loadMatchStats(user.id()));
        CachedRatings ratings = databaseLookupCache.profileRatings(
                user.id(),
                () -> loadRatings(user.id()));
        long wins = matchStats.wins();
        long losses = matchStats.losses();
        long draws = matchStats.draws();
        long puzzlesSolved = puzzleCompletionRepository.countByUserId(user.id());
        ProfileDTO.QueueStats queueStats = new ProfileDTO.QueueStats(
                new ProfileDTO.ModeStats(
                        matchStats.onesWins(),
                        matchStats.onesLosses(),
                        matchStats.onesDraws(),
                        ratings.ones()),
                new ProfileDTO.ModeStats(
                        matchStats.twosWins(),
                        matchStats.twosLosses(),
                        matchStats.twosDraws(),
                        ratings.twos()));

        return new ProfileDTO(
                user.username(),
                user.createdAt(),
                aboutMe,
                wins + losses + draws,
                wins,
                losses,
                draws,
                puzzlesSolved,
                queueStats);
    }

    private CachedRatings loadRatings(UUID userId) {
        if (eloRatingService == null) {
            return new CachedRatings(
                    EloRatingService.DEFAULT_RATING,
                    EloRatingService.DEFAULT_RATING);
        }
        return new CachedRatings(
                eloRatingService.ratingFor(userId, MatchMode.ONES),
                eloRatingService.ratingFor(userId, MatchMode.TWOS));
    }

    private CachedMatchStats loadMatchStats(UUID userId) {
        Instant visibleAt = Instant.now();
        long wins = matchParticipantRepository.countByUserIdAndResultAndMatchResultVisibleAtLessThanEqual(
                userId, MatchResult.WIN, visibleAt);
        long losses = matchParticipantRepository.countByUserIdAndResultInAndMatchResultVisibleAtLessThanEqual(
                userId,
                List.of(MatchResult.LOSS, MatchResult.FORFEIT),
                visibleAt);
        long draws = matchParticipantRepository.countByUserIdAndResultAndMatchResultVisibleAtLessThanEqual(
                userId, MatchResult.DRAW, visibleAt);
        long onesWins = matchParticipantRepository
                .countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                        userId, MatchMode.ONES, MatchResult.WIN, visibleAt);
        long onesLosses = matchParticipantRepository
                .countByUserIdAndModeAndResultInAndMatchResultVisibleAtLessThanEqual(
                        userId,
                        MatchMode.ONES,
                        List.of(MatchResult.LOSS, MatchResult.FORFEIT),
                        visibleAt);
        long onesDraws = matchParticipantRepository
                .countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                        userId, MatchMode.ONES, MatchResult.DRAW, visibleAt);
        long twosWins = matchParticipantRepository
                .countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                        userId, MatchMode.TWOS, MatchResult.WIN, visibleAt);
        long twosLosses = matchParticipantRepository
                .countByUserIdAndModeAndResultInAndMatchResultVisibleAtLessThanEqual(
                        userId,
                        MatchMode.TWOS,
                        List.of(MatchResult.LOSS, MatchResult.FORFEIT),
                        visibleAt);
        long twosDraws = matchParticipantRepository
                .countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                        userId, MatchMode.TWOS, MatchResult.DRAW, visibleAt);
        return new CachedMatchStats(
                wins,
                losses,
                draws,
                onesWins,
                onesLosses,
                onesDraws,
                twosWins,
                twosLosses,
                twosDraws);
    }

    private String normalizeAboutMe(String value) {
        String normalized = value == null
                ? ""
                : value.replace("\r\n", "\n").replace('\r', '\n');
        if (normalized.length() > MAX_ABOUT_ME_LENGTH) {
            throw new AuthException("About Me must be 500 characters or fewer");
        }
        if (normalized.codePoints().anyMatch(codePoint -> Character.isISOControl(codePoint)
                && codePoint != '\n'
                && codePoint != '\t')) {
            throw new AuthException("About Me contains an unsupported control character");
        }
        return normalized;
    }

    @Transactional(readOnly = true)
    public MatchHistoryPageDTO matchHistory(
            Authentication authentication,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        requireAuthenticatedGetAllowed(authentication, "match-history");
        CachedUser user = currentUser(authentication);
        return matchHistoryForUser(user, page, query, fromInclusive, toExclusive);
    }

    @Transactional(readOnly = true)
    public MatchHistoryPageDTO publicMatchHistory(
            Authentication authentication,
            String username,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        requireAuthenticatedGetAllowed(authentication, "match-history");
        currentUser(authentication);
        return matchHistoryForUser(publicUser(username), page, query, fromInclusive, toExclusive);
    }

    @Transactional(readOnly = true)
    public SolvedPuzzlePageDTO solvedPuzzles(Authentication authentication, int page) {
        requireAuthenticatedGetAllowed(authentication, "solved-puzzles");
        CachedUser user = currentUser(authentication);
        return solvedPuzzlesForUser(user, page);
    }

    @Transactional(readOnly = true)
    public SolvedPuzzlePageDTO publicSolvedPuzzles(
            Authentication authentication,
            String username,
            int page) {
        requireAuthenticatedGetAllowed(authentication, "solved-puzzles");
        currentUser(authentication);
        return solvedPuzzlesForUser(publicUser(username), page);
    }

    @Transactional(readOnly = true)
    public ProfileSearchPageDTO searchProfiles(Authentication authentication, int page, String query) {
        requireAuthenticatedGetAllowed(authentication, "profile-search");
        currentUser(authentication);
        int normalizedPage = Math.min(Math.max(0, page), MAX_SEARCH_PAGE);
        String normalizedQuery = query == null ? "" : query.trim();
        if (normalizedQuery.length() > MAX_USERNAME_QUERY_LENGTH) {
            normalizedQuery = normalizedQuery.substring(0, MAX_USERNAME_QUERY_LENGTH);
        }
        String searchQuery = normalizedQuery;
        ProfileSearchKey cacheKey = new ProfileSearchKey(normalizedPage, searchQuery);
        return databaseLookupCache.profileSearch(cacheKey, () -> {
            PageRequest pageRequest = PageRequest.of(
                    Math.min(normalizedPage, MAX_SEARCH_PAGE),
                    SEARCH_PAGE_SIZE,
                    Sort.by(Sort.Direction.ASC, "username", "id"));
            Page<AppUser> profiles = searchQuery.isBlank()
                    ? Page.empty(pageRequest)
                    : userRepository.findByEmailVerifiedTrueAndUsernameContainingIgnoreCaseOrderByUsernameAscIdAsc(
                            searchQuery,
                            pageRequest);
            List<ProfileSearchPageDTO.ProfileSearchResultDTO> results = profiles.getContent().stream()
                    .map(profile -> new ProfileSearchPageDTO.ProfileSearchResultDTO(profile.getUsername()))
                    .toList();
            return new ProfileSearchPageDTO(
                    results,
                    pageRequest.getPageNumber(),
                    SEARCH_PAGE_SIZE,
                    profiles.hasNext(),
                    profiles.getTotalElements());
        });
    }

    private MatchHistoryPageDTO matchHistoryForUser(
            AppUser user,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        return matchHistoryForUser(
                new CachedUser(user.getId(), user.getUsername(), user.getCreatedAt()),
                page,
                query,
                fromInclusive,
                toExclusive);
    }

    private MatchHistoryPageDTO matchHistoryForUser(
            CachedUser user,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        int normalizedPage = Math.min(Math.max(0, page), MAX_HISTORY_PAGE);
        String normalizedQuery = query == null ? "" : query.trim();
        if (normalizedQuery.length() > MAX_OPPONENT_QUERY_LENGTH) {
            normalizedQuery = normalizedQuery.substring(0, MAX_OPPONENT_QUERY_LENGTH);
        }
        String opponentQuery = normalizedQuery;

        ProfileHistoryKey cacheKey = new ProfileHistoryKey(
                user.id(),
                normalizedPage,
                opponentQuery,
                fromInclusive,
                toExclusive);
        return databaseLookupCache.matchHistory(cacheKey, () -> {
            PageRequest pageRequest = PageRequest.of(
                    normalizedPage,
                    MATCH_PAGE_SIZE);
            Page<RecentMatchProjection> matches =
                    matchParticipantRepository.findRecentMatches(
                            user.id(),
                            Instant.now(),
                            opponentQuery,
                            fromInclusive,
                            toExclusive,
                            pageRequest);
            List<UUID> matchIds = matches.getContent().stream()
                    .map(RecentMatchProjection::getMatchId)
                    .toList();
            Map<UUID, List<MatchParticipant>> participantsByMatch = matchIds.isEmpty()
                    ? Map.of()
                    : matchParticipantRepository.findByMatchIdIn(matchIds).stream()
                            .collect(Collectors.groupingBy(participant -> participant.getMatch().getId()));
            List<RecentMatchDTO> recentMatches = matches.getContent().stream()
                    .map(match -> toRecentMatch(match, participantsByMatch, user.id()))
                    .toList();
            return new MatchHistoryPageDTO(
                    recentMatches,
                    normalizedPage,
                    MATCH_PAGE_SIZE,
                    matches.hasNext(),
                    matches.getTotalElements());
        });
    }

    private SolvedPuzzlePageDTO solvedPuzzlesForUser(AppUser user, int page) {
        return solvedPuzzlesForUser(
                new CachedUser(user.getId(), user.getUsername(), user.getCreatedAt()),
                page);
    }

    private SolvedPuzzlePageDTO solvedPuzzlesForUser(CachedUser user, int page) {
        int normalizedPage = Math.min(Math.max(0, page), MAX_PUZZLE_PAGE);
        SolvedPuzzleHistoryKey cacheKey = new SolvedPuzzleHistoryKey(user.id(), normalizedPage);
        return databaseLookupCache.solvedPuzzleHistory(cacheKey, () -> {
            PageRequest pageRequest = PageRequest.of(
                    normalizedPage,
                    PUZZLE_PAGE_SIZE,
                    Sort.by(Sort.Direction.DESC, "solvedAt", "id"));
            Page<PuzzleCompletion> completions = puzzleCompletionRepository.findByUserId(
                    user.id(),
                    pageRequest);
            List<SolvedPuzzlePageDTO.SolvedPuzzleDTO> puzzles = completions.getContent().stream()
                    .map(completion -> new SolvedPuzzlePageDTO.SolvedPuzzleDTO(
                            completion.getPuzzle().getPuzzleNumber(),
                            completion.getPuzzle().getName(),
                            completion.getSolvedAt()))
                    .toList();
            return new SolvedPuzzlePageDTO(
                    puzzles,
                    normalizedPage,
                    PUZZLE_PAGE_SIZE,
                    completions.hasNext(),
                    completions.getTotalElements());
        });
    }

    private CachedUser publicUser(String username) {
        String normalizedUsername = UsernamePolicy.clean(username);
        if (!UsernamePolicy.isValid(normalizedUsername)) {
            throw new AuthException("profile not found");
        }
        String cacheKey = normalizedUsername.toLowerCase(Locale.ROOT);
        return databaseLookupCache.publicUser(
                cacheKey,
                () -> userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(normalizedUsername)
                        .map(user -> new CachedUser(user.getId(), user.getUsername(), user.getCreatedAt()))
                        .orElseThrow(() -> new AuthException("profile not found")));
    }

    private void requireAuthenticatedGetAllowed(Authentication authentication, String category) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        authenticatedGetRateLimiter.requireAllowed(category + ":" + userId);
    }

    private RecentMatchDTO toRecentMatch(
            RecentMatchProjection match,
            Map<UUID, List<MatchParticipant>> participantsByMatch,
            UUID viewedUserId) {
        String result = match.getResult() == MatchResult.FORFEIT
                ? MatchResult.LOSS.name()
                : match.getResult().name();
        short viewedTeamNumber = match.getTeamNumber();
        List<String> participantUsernames = participantsByMatch
                .getOrDefault(match.getMatchId(), List.of())
                .stream()
                .filter(participant -> participant.getUser() != null
                        && !viewedUserId.equals(participant.getUser().getId()))
                .sorted(Comparator
                        .comparingInt((MatchParticipant participant) -> participant.getTeamNumber() == viewedTeamNumber ? 0 : 1)
                        .thenComparingInt(MatchParticipant::getSlot)
                        .thenComparing(participant -> participant.getUser().getUsername(), String.CASE_INSENSITIVE_ORDER))
                .map(participant -> participant.getUser().getUsername())
                .toList();

        return new RecentMatchDTO(
                match.getMatchId(),
                participantUsernames,
                result,
                match.getCompletedAt(),
                match.getCompletionReason(),
                match.getMode());
    }
}
