package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.domain.puzzle.Puzzle;
import com.example.botfight.domain.puzzle.PuzzleCompletion;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.profile.ProfileService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.PersistenceContext;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.show-sql=false",
        "spring.jpa.properties.hibernate.generate_statistics=true"
})
class ProfileHistoryQueryCountTest {

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private MatchParticipantRepository matchParticipantRepository;

    @Autowired
    private PuzzleCompletionRepository puzzleCompletionRepository;

    @Autowired
    private ProfileRepository profileRepository;

    @Autowired
    private UserRepository userRepository;

    private Statistics statistics;

    @BeforeEach
    void setDatabaseGeneratedTimestampDefaults() {
        statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        // The production Flyway schema supplies these defaults; Hibernate's test schema does not.
        jdbcTemplate.execute("alter table users alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table users alter column updated_at set default current_timestamp");
        jdbcTemplate.execute("alter table matches alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table matches alter column updated_at set default current_timestamp");
        jdbcTemplate.execute("alter table match_participants alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table puzzles alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table puzzles alter column updated_at set default current_timestamp");
        jdbcTemplate.execute("alter table puzzle_completions alter column solved_at set default current_timestamp");
    }

    @Test
    void fullMatchHistoryPageUsesTheSameNumberOfQueriesAsTheDatasetGrows() {
        AppUser viewer = persistUser("history-viewer");
        persistMatches(viewer, 0, 20);
        flushAndClear();

        long twentyMatchQueries = countMatchHistoryQueries(viewer);

        persistMatches(viewer, 20, 20);
        flushAndClear();

        long fortyMatchQueries = countMatchHistoryQueries(viewer);

        assertThat(twentyMatchQueries).isEqualTo(3);
        assertThat(fortyMatchQueries).isEqualTo(twentyMatchQueries);
    }

    @Test
    void fullSolvedPuzzlePageUsesTheSameNumberOfQueriesAsTheDatasetGrows() {
        AppUser viewer = persistUser("puzzle-viewer");
        AppUser creator = persistUser("puzzle-creator");
        persistPuzzleCompletions(viewer, creator, 0, 20);
        flushAndClear();

        long twentyPuzzleQueries = countSolvedPuzzleQueries(viewer);

        persistPuzzleCompletions(viewer, creator, 20, 20);
        flushAndClear();

        long fortyPuzzleQueries = countSolvedPuzzleQueries(viewer);

        assertThat(twentyPuzzleQueries).isEqualTo(2);
        assertThat(fortyPuzzleQueries).isEqualTo(twentyPuzzleQueries);
    }

    @Test
    void profileUsernameSubstringSearchRemainsCaseInsensitiveAndExcludesPrivateAccounts() {
        AppUser first = persistUser("ByteBrawler");
        AppUser second = persistUser("ByteSmith");
        persistUser("OtherPlayer");
        persistUser("GuestByte", true, true);
        persistUser("UnverifiedByte", false, false);

        var page = userRepository.searchVerifiedNonGuestByUsernameSubstring(
                "BYTE",
                PageRequest.of(0, 20, Sort.by(Sort.Direction.ASC, "username", "id")));

        assertThat(page.getContent()).extracting(AppUser::getUsername)
                .containsExactly(first.getUsername(), second.getUsername());
        assertThat(page.getTotalElements()).isEqualTo(2);
    }

    private long countMatchHistoryQueries(AppUser viewer) {
        Authentication authentication = mock(Authentication.class);
        CurrentUserService currentUserService = currentUserService(viewer, authentication);
        ProfileService service = profileService(currentUserService);
        statistics.clear();

        var page = service.matchHistory(authentication, 0, "", null, null);

        assertThat(page.matches()).hasSize(20);
        return statistics.getPrepareStatementCount();
    }

    private long countSolvedPuzzleQueries(AppUser viewer) {
        Authentication authentication = mock(Authentication.class);
        CurrentUserService currentUserService = currentUserService(viewer, authentication);
        ProfileService service = profileService(currentUserService);
        statistics.clear();

        var page = service.solvedPuzzles(authentication, 0);

        assertThat(page.puzzles()).hasSize(20);
        return statistics.getPrepareStatementCount();
    }

    private CurrentUserService currentUserService(AppUser viewer, Authentication authentication) {
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(viewer.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(viewer);
        when(currentUserService.isGuest(authentication)).thenReturn(false);
        return currentUserService;
    }

    private ProfileService profileService(CurrentUserService currentUserService) {
        return new ProfileService(
                currentUserService,
                userRepository,
                matchParticipantRepository,
                puzzleCompletionRepository,
                profileRepository,
                new SlidingWindowRateLimiter<>(Clock.systemUTC(), 20, Duration.ofMinutes(1)),
                new TokenBucketRateLimiter<String>(Clock.systemUTC(), 20, Duration.ofSeconds(1)),
                new DatabaseLookupCache());
    }

    private AppUser persistUser(String username) {
        return persistUser(username, false, true);
    }

    private AppUser persistUser(String username, boolean guest, boolean emailVerified) {
        AppUser user = new AppUser();
        user.setUsername(username);
        String email = username + "@example.test";
        user.setEmail(email);
        user.setNormalizedEmail(email.toLowerCase(Locale.ROOT));
        user.setGuest(guest);
        user.setEmailVerified(emailVerified);
        return userRepository.saveAndFlush(user);
    }

    private void persistMatches(AppUser viewer, int firstIndex, int count) {
        Instant visibleAt = Instant.now().minusSeconds(1);
        for (int index = firstIndex; index < firstIndex + count; index++) {
            AppUser opponent = persistUser("opponent-" + index);
            Match match = new Match();
            match.setStatus(MatchStatus.COMPLETED);
            match.setMode(MatchMode.ONES);
            match.setRulesetVersion("profile-query-test-v1");
            match.setCompletedAt(visibleAt.minusSeconds(index));
            match.setResultVisibleAt(visibleAt);
            match.setCompletionReason("SIMULATION");
            entityManager.persist(match);

            MatchParticipant ownParticipant = participant(match, viewer, (short) 1, MatchResult.WIN);
            MatchParticipant opposingParticipant = participant(match, opponent, (short) 2, MatchResult.LOSS);
            entityManager.persist(ownParticipant);
            entityManager.persist(opposingParticipant);
        }
    }

    private void persistPuzzleCompletions(AppUser viewer, AppUser creator, int firstIndex, int count) {
        for (int index = firstIndex; index < firstIndex + count; index++) {
            Puzzle puzzle = new Puzzle();
            puzzle.setPuzzleNumber(10_000L + index);
            puzzle.setName("Puzzle " + index);
            puzzle.setCreatedBy(creator);
            entityManager.persist(puzzle);

            PuzzleCompletion completion = new PuzzleCompletion();
            completion.setUser(viewer);
            completion.setPuzzle(puzzle);
            entityManager.persist(completion);
        }
    }

    private static MatchParticipant participant(
            Match match,
            AppUser user,
            short slot,
            MatchResult result) {
        MatchParticipant participant = new MatchParticipant();
        participant.setMatch(match);
        participant.setUser(user);
        participant.setSlot(slot);
        participant.setTeamNumber(slot);
        participant.setResult(result);
        return participant;
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
