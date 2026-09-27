package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.auth.UserRole;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.GuestLifecycleService;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.show-sql=false"
})
class GuestLifecyclePersistenceTest {

    private static final Instant NOW = Instant.parse("2026-09-27T12:00:00Z");

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private MatchRepository matchRepository;

    @Autowired
    private MatchParticipantRepository matchParticipantRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private TransactionTemplate transactionTemplate;

    @BeforeEach
    void prepareDatabaseDefaults() {
        transactionTemplate = new TransactionTemplate(transactionManager);
        transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        // Production Flyway migrations supply these defaults; Hibernate's test schema does not.
        jdbcTemplate.execute("alter table users alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table users alter column updated_at set default current_timestamp");
        jdbcTemplate.execute("alter table matches alter column created_at set default current_timestamp");
        jdbcTemplate.execute("alter table matches alter column updated_at set default current_timestamp");
        jdbcTemplate.execute("alter table match_participants alter column created_at set default current_timestamp");
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void scheduledCleanupTransactionDeletesOnlyInactiveTerminalGuestOnlyHistory() {
        Fixture fixture = transactionTemplate.execute(status -> persistFixture());
        assertThat(fixture).isNotNull();

        MatchmakingService matchmakingService = mock(MatchmakingService.class);
        when(matchmakingService.hasTransientActivity(any(UUID.class))).thenAnswer(invocation ->
                fixture.queuedGuestIds().contains(invocation.getArgument(0)));
        MatchService matchService = mock(MatchService.class);
        when(matchService.activeMatchStatus(any(UUID.class))).thenAnswer(invocation -> {
            UUID userId = invocation.getArgument(0);
            return fixture.activeGuestIds().contains(userId)
                    ? new ActiveMatchStatusDTO(true, false, UUID.randomUUID(), null)
                    : ActiveMatchStatusDTO.none();
        });
        SingleUserWebSocketSessionRegistry socketRegistry =
                mock(SingleUserWebSocketSessionRegistry.class);
        when(socketRegistry.currentSessionIdForPrincipal(any(String.class))).thenReturn(null);

        GuestLifecycleService service = new GuestLifecycleService(
                userRepository,
                matchRepository,
                matchParticipantRepository,
                matchmakingService,
                matchService,
                socketRegistry,
                Clock.fixed(NOW, ZoneOffset.UTC),
                mock(TaskScheduler.class),
                transactionManager);

        int deletedGuests = service.cleanupInactiveGuests();

        assertThat(deletedGuests).isEqualTo(fixture.deletableGuestIds().size());
        assertThat(fixture.deletableGuestIds())
                .allSatisfy(userId -> assertThat(userRepository.existsById(userId)).isFalse());
        assertThat(matchRepository.existsById(fixture.deletableMatchId())).isFalse();
        assertThat(matchParticipantRepository.findByMatchId(fixture.deletableMatchId())).isEmpty();

        assertThat(fixture.preservedGuestIds())
                .allSatisfy(userId -> assertThat(userRepository.existsById(userId)).isTrue());
        assertThat(fixture.preservedMatchIds())
                .allSatisfy(matchId -> assertThat(matchRepository.existsById(matchId)).isTrue());
        assertThat(fixture.preservedMatchIds())
                .allSatisfy(matchId -> assertThat(matchParticipantRepository.findByMatchId(matchId))
                        .hasSize(2));
        assertThat(userRepository.existsById(fixture.mixedRegisteredUserId())).isTrue();
    }

    private Fixture persistFixture() {
        Instant expiredAt = NOW.minusSeconds(1);
        List<AppUser> deletableGuests = List.of(
                persistUser("cleanup-terminal-a", true, expiredAt),
                persistUser("cleanup-terminal-b", true, expiredAt));
        Match deletableMatch = persistMatch(MatchStatus.COMPLETED, deletableGuests);

        List<AppUser> runningGuests = List.of(
                persistUser("cleanup-running-a", true, expiredAt),
                persistUser("cleanup-running-b", true, expiredAt));
        Match runningMatch = persistMatch(MatchStatus.RUNNING, runningGuests);

        List<AppUser> pendingGuests = List.of(
                persistUser("cleanup-pending-a", true, expiredAt),
                persistUser("cleanup-pending-b", true, expiredAt));
        Match pendingMatch = persistMatch(MatchStatus.PENDING, pendingGuests);

        List<AppUser> activeGuests = List.of(
                persistUser("cleanup-active-a", true, expiredAt),
                persistUser("cleanup-active-b", true, expiredAt));
        Match activeMatch = persistMatch(MatchStatus.COMPLETED, activeGuests);

        List<AppUser> queuedGuests = List.of(
                persistUser("cleanup-queued-a", true, expiredAt),
                persistUser("cleanup-queued-b", true, expiredAt));
        Match queuedMatch = persistMatch(MatchStatus.COMPLETED, queuedGuests);

        AppUser mixedGuest = persistUser("cleanup-mixed-guest", true, expiredAt);
        AppUser registeredUser = persistUser("cleanup-reg-mix", false, null);
        Match mixedMatch = persistMatch(MatchStatus.COMPLETED, List.of(mixedGuest, registeredUser));

        return new Fixture(
                deletableGuests.stream().map(AppUser::getId).collect(java.util.stream.Collectors.toSet()),
                deletableMatch.getId(),
                Set.of(
                        runningGuests.get(0).getId(), runningGuests.get(1).getId(),
                        pendingGuests.get(0).getId(), pendingGuests.get(1).getId(),
                        activeGuests.get(0).getId(), activeGuests.get(1).getId(),
                        queuedGuests.get(0).getId(), queuedGuests.get(1).getId(),
                        mixedGuest.getId()),
                Set.of(activeGuests.get(0).getId()),
                Set.of(queuedGuests.get(0).getId()),
                Set.of(runningMatch.getId(), pendingMatch.getId(), activeMatch.getId(),
                        queuedMatch.getId(), mixedMatch.getId()),
                registeredUser.getId());
    }

    private AppUser persistUser(String username, boolean guest, Instant expiresAt) {
        AppUser user = new AppUser();
        user.setUsername(username);
        String email = username + "@example.test";
        user.setEmail(email);
        user.setNormalizedEmail(email.toLowerCase(Locale.ROOT));
        user.setEmailVerified(true);
        user.setGuest(guest);
        user.setRole(guest ? UserRole.GUEST : UserRole.USER);
        user.setGuestExpiresAt(expiresAt);
        return userRepository.save(user);
    }

    private Match persistMatch(MatchStatus matchStatus, List<AppUser> users) {
        Match match = new Match();
        match.setStatus(matchStatus);
        match.setMode(MatchMode.ONES);
        match.setRanked(false);
        match.setRulesetVersion("guest-cleanup-test-v1");
        match.setCompletedAt(matchStatus == MatchStatus.COMPLETED ? NOW.minusSeconds(30) : null);
        match = matchRepository.save(match);

        List<MatchParticipant> participants = new ArrayList<>();
        for (int index = 0; index < users.size(); index++) {
            MatchParticipant participant = new MatchParticipant();
            participant.setMatch(match);
            participant.setUser(users.get(index));
            participant.setSlot((short) (index + 1));
            participant.setTeamNumber((short) (index + 1));
            if (matchStatus == MatchStatus.COMPLETED) {
                participant.setResult(index == 0 ? MatchResult.WIN : MatchResult.LOSS);
            }
            participants.add(participant);
        }
        matchParticipantRepository.saveAll(participants);
        matchParticipantRepository.flush();
        return match;
    }

    private record Fixture(
            Set<UUID> deletableGuestIds,
            UUID deletableMatchId,
            Set<UUID> preservedGuestIds,
            Set<UUID> activeGuestIds,
            Set<UUID> queuedGuestIds,
            Set<UUID> preservedMatchIds,
            UUID mixedRegisteredUserId) {
    }
}
