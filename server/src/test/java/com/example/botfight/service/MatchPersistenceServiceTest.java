package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchStatus;
import com.example.botfight.domain.rating.PlayerRating;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.PlayerRatingRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchPersistenceServiceTest {

    private static final Instant RESTARTED_AT = Instant.parse("2026-07-31T12:00:00Z");

    private final MatchRepository matchRepository = mock(MatchRepository.class);
    private final MatchParticipantRepository matchParticipantRepository = mock(MatchParticipantRepository.class);
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final MatchPersistenceService service = new MatchPersistenceService(
            matchRepository,
            matchParticipantRepository,
            profileRepository,
            userRepository,
            Clock.fixed(RESTARTED_AT, ZoneOffset.UTC),
            new JsonMapper());

    @Test
    void cancelsPersistedRunningMatchesWithoutAssigningAnOutcome() {
        Match runningMatch = new Match();
        runningMatch.setStatus(MatchStatus.RUNNING);
        AppUser staleWinner = new AppUser();
        runningMatch.setWinnerUser(staleWinner);
        when(matchRepository.findByStatusOrderByCreatedAtAsc(MatchStatus.RUNNING))
                .thenReturn(List.of(runningMatch));

        int cancelledMatches = service.cancelMatchesInterruptedByServerRestart();

        assertThat(cancelledMatches).isEqualTo(1);
        assertThat(runningMatch.getStatus()).isEqualTo(MatchStatus.CANCELLED);
        assertThat(runningMatch.getCompletionReason())
                .isEqualTo(MatchPersistenceService.COMPLETION_REASON_SERVER_RESTART);
        assertThat(runningMatch.getCompletedAt()).isEqualTo(RESTARTED_AT);
        assertThat(runningMatch.getWinnerUser()).isNull();
        verify(matchRepository).saveAll(List.of(runningMatch));
        verifyNoInteractions(
                matchParticipantRepository,
                profileRepository,
                userRepository);
    }

    @Test
    void doesNothingWhenNoPersistedMatchWasRunning() {
        when(matchRepository.findByStatusOrderByCreatedAtAsc(MatchStatus.RUNNING))
                .thenReturn(List.of());

        assertThat(service.cancelMatchesInterruptedByServerRestart()).isZero();

        org.mockito.Mockito.verify(matchRepository, org.mockito.Mockito.never())
                .saveAll(any());
    }

    @Test
    void cancelsSimulationFailureWithoutAssigningParticipantResultsOrChangingRatings() {
        UUID matchId = UUID.randomUUID();
        Match match = new Match();
        match.setId(matchId);
        match.setStatus(MatchStatus.RUNNING);
        match.setSimulationSeed(987654321L);
        match.setWinnerUser(new AppUser());
        AppUser firstUser = new AppUser();
        firstUser.setId(UUID.randomUUID());
        AppUser secondUser = new AppUser();
        secondUser.setId(UUID.randomUUID());
        MatchParticipant first = participant(firstUser, 1100, null);
        MatchParticipant second = participant(secondUser, 1200, null);
        first.setResult(com.example.botfight.domain.match.MatchResult.WIN);
        second.setResult(com.example.botfight.domain.match.MatchResult.LOSS);
        when(matchRepository.findById(matchId)).thenReturn(java.util.Optional.of(match));
        when(matchParticipantRepository.findByMatchId(matchId)).thenReturn(List.of(first, second));

        assertThat(service.cancelMatchAfterSimulationFailure(matchId)).isTrue();

        assertThat(match.getStatus()).isEqualTo(MatchStatus.CANCELLED);
        assertThat(match.getCompletionReason())
                .isEqualTo(MatchPersistenceService.COMPLETION_REASON_SIMULATION_FAILURE);
        assertThat(match.getCompletedAt()).isEqualTo(RESTARTED_AT);
        assertThat(match.getResultVisibleAt()).isEqualTo(RESTARTED_AT);
        assertThat(match.getWinnerUser()).isNull();
        assertThat(match.getSimulationSeed()).isEqualTo(987654321L);
        assertThat(first.getResult()).isNull();
        assertThat(second.getResult()).isNull();
        assertThat(first.getRatingBefore()).isEqualTo(1100);
        assertThat(first.getRatingAfter()).isNull();
        assertThat(second.getRatingBefore()).isEqualTo(1200);
        assertThat(second.getRatingAfter()).isNull();
        verify(matchRepository).save(match);
        verify(matchParticipantRepository).saveAll(List.of(first, second));
        verifyNoInteractions(profileRepository, userRepository);
    }

    @Test
    void returnsOnlyTheCurrentPlayersPersistedRatingChange() {
        UUID matchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AppUser user = new AppUser();
        user.setId(userId);
        MatchParticipant participant = new MatchParticipant();
        participant.setUser(user);
        participant.setRatingBefore(1035);
        participant.setRatingAfter(1053);
        when(matchParticipantRepository.findByMatchId(matchId)).thenReturn(List.of(participant));

        assertThat(service.ratingChangeForPlayer(matchId, userId))
                .isEqualTo(new MatchPersistenceService.RatingChange(1035, 1053));
        assertThat(service.ratingChangeForPlayer(matchId, UUID.randomUUID())).isNull();
    }

    @Test
    void returnsAllPersistedRatingChangesByUser() {
        UUID matchId = UUID.randomUUID();
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        MatchParticipant first = participant(firstUserId, 1100, 1120);
        MatchParticipant second = participant(secondUserId, 1200, 1180);
        when(matchParticipantRepository.findByMatchId(matchId)).thenReturn(List.of(first, second));

        assertThat(service.ratingChangesForMatch(matchId))
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        firstUserId, new MatchPersistenceService.RatingChange(1100, 1120),
                        secondUserId, new MatchPersistenceService.RatingChange(1200, 1180)));
    }

    private MatchParticipant participant(UUID userId, int before, Integer after) {
        AppUser user = new AppUser();
        user.setId(userId);
        return participant(user, before, after);
    }

    private MatchParticipant participant(AppUser user, int before, Integer after) {
        MatchParticipant participant = new MatchParticipant();
        participant.setUser(user);
        participant.setRatingBefore(before);
        participant.setRatingAfter(after);
        return participant;
    }

    @Nested
    class RatingNeutralDraws {
        @Test
        void drawBeforeAnyRoundWasFoughtDoesNotChangeRatings() {
            MatchRepository matchRepository = mock(MatchRepository.class);
            MatchParticipantRepository participantRepository = mock(MatchParticipantRepository.class);
            ProfileRepository profileRepository = mock(ProfileRepository.class);
            UserRepository userRepository = mock(UserRepository.class);
            PlayerRatingRepository ratingRepository = mock(PlayerRatingRepository.class);
            EloRatingService elo = new EloRatingService(ratingRepository);
            MatchPersistenceService service = new MatchPersistenceService(
                    matchRepository, participantRepository, profileRepository, userRepository,
                    Clock.fixed(Instant.parse("2026-10-16T12:00:00Z"), ZoneOffset.UTC),
                    new JsonMapper(), null, new DatabaseLookupCache(), elo);

            AppUser strong = user();
            AppUser weak = user();
            PlayerRating strongRating = rating(strong, 1400);
            PlayerRating weakRating = rating(weak, 1000);
            when(ratingRepository.findByUserIdAndModeForUpdate(strong.getId(), MatchMode.ONES))
                    .thenReturn(Optional.of(strongRating));
            when(ratingRepository.findByUserIdAndModeForUpdate(weak.getId(), MatchMode.ONES))
                    .thenReturn(Optional.of(weakRating));

            Match match = new Match();
            match.setId(UUID.randomUUID());
            match.setMode(MatchMode.ONES);
            match.setRanked(true);
            match.setStatus(MatchStatus.RUNNING);
            when(matchRepository.findById(match.getId())).thenReturn(Optional.of(match));
            List<MatchParticipant> participants = List.of(participant(strong, 1), participant(weak, 2));
            when(participantRepository.findByMatchId(match.getId())).thenReturn(participants);

            // Weak player disconnects during initial loadout selection -> draw, no round fought.
            service.completeMatchAsDraw(match.getId(), "INITIAL_DISCONNECTION");

            assertThat(weakRating.getRating())
                    .as("lower-rated disconnector must not gain rating from a no-round draw")
                    .isEqualTo(1000);
            assertThat(strongRating.getRating())
                    .as("higher-rated player must not lose rating from a no-round draw")
                    .isEqualTo(1400);
        }

        private static MatchParticipant participant(AppUser user, int team) {
            MatchParticipant p = new MatchParticipant();
            p.setUser(user);
            p.setTeamNumber((short) team);
            return p;
        }

        private static PlayerRating rating(AppUser user, int value) {
            PlayerRating r = new PlayerRating();
            r.setUser(user);
            r.setMode(MatchMode.ONES);
            r.setRating(value);
            r.setRatedMatches(10);
            return r;
        }

        private static AppUser user() {
            AppUser u = new AppUser();
            u.setId(UUID.randomUUID());
            return u;
        }
    }
}
