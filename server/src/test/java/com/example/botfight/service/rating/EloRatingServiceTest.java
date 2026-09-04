package com.example.botfight.service.rating;

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
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.rating.PlayerRating;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.PlayerRatingRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EloRatingServiceTest {

    private final PlayerRatingRepository repository = mock(PlayerRatingRepository.class);
    private final EloRatingService service = new EloRatingService(repository);

    @Test
    void equalProvisionalOneVOneRatingsMoveSymmetricallyByTwenty() {
        AppUser winner = user();
        AppUser loser = user();
        PlayerRating winnerRating = rating(winner, MatchMode.ONES, 1000, 0);
        PlayerRating loserRating = rating(loser, MatchMode.ONES, 1000, 0);
        when(repository.findByUserIdAndModeForUpdate(winner.getId(), MatchMode.ONES))
                .thenReturn(Optional.of(winnerRating));
        when(repository.findByUserIdAndModeForUpdate(loser.getId(), MatchMode.ONES))
                .thenReturn(Optional.of(loserRating));

        MatchParticipant winnerParticipant = participant(winner, 1, MatchResult.WIN);
        MatchParticipant loserParticipant = participant(loser, 2, MatchResult.LOSS);
        service.applyRatedResult(
                match(MatchMode.ONES),
                List.of(winnerParticipant, loserParticipant));

        assertThat(winnerParticipant.getRatingBefore()).isEqualTo(1000);
        assertThat(winnerParticipant.getRatingAfter()).isEqualTo(1020);
        assertThat(loserParticipant.getRatingBefore()).isEqualTo(1000);
        assertThat(loserParticipant.getRatingAfter()).isEqualTo(980);
        assertThat(winnerRating.getRatedMatches()).isEqualTo(1);
        assertThat(loserRating.getRatedMatches()).isEqualTo(1);
        verify(repository).saveAll(any());
    }

    @Test
    void establishedEqualRatingsDoNotMoveOnADraw() {
        AppUser first = user();
        AppUser second = user();
        PlayerRating firstRating = rating(first, MatchMode.ONES, 1000, 10);
        PlayerRating secondRating = rating(second, MatchMode.ONES, 1000, 10);
        when(repository.findByUserIdAndModeForUpdate(first.getId(), MatchMode.ONES))
                .thenReturn(Optional.of(firstRating));
        when(repository.findByUserIdAndModeForUpdate(second.getId(), MatchMode.ONES))
                .thenReturn(Optional.of(secondRating));

        service.applyRatedResult(
                match(MatchMode.ONES),
                List.of(
                        participant(first, 1, MatchResult.DRAW),
                        participant(second, 2, MatchResult.DRAW)));

        assertThat(firstRating.getRating()).isEqualTo(1000);
        assertThat(secondRating.getRating()).isEqualTo(1000);
        assertThat(firstRating.getRatedMatches()).isEqualTo(11);
        assertThat(secondRating.getRatedMatches()).isEqualTo(11);
    }

    @Test
    void twosUsesTeamAveragesAndAppliesTheSameTeamDelta() {
        AppUser first = user();
        AppUser second = user();
        AppUser third = user();
        AppUser fourth = user();
        PlayerRating firstRating = rating(first, MatchMode.TWOS, 1000, 0);
        PlayerRating secondRating = rating(second, MatchMode.TWOS, 1100, 0);
        PlayerRating thirdRating = rating(third, MatchMode.TWOS, 1000, 0);
        PlayerRating fourthRating = rating(fourth, MatchMode.TWOS, 1100, 0);
        when(repository.findByUserIdAndModeForUpdate(first.getId(), MatchMode.TWOS))
                .thenReturn(Optional.of(firstRating));
        when(repository.findByUserIdAndModeForUpdate(second.getId(), MatchMode.TWOS))
                .thenReturn(Optional.of(secondRating));
        when(repository.findByUserIdAndModeForUpdate(third.getId(), MatchMode.TWOS))
                .thenReturn(Optional.of(thirdRating));
        when(repository.findByUserIdAndModeForUpdate(fourth.getId(), MatchMode.TWOS))
                .thenReturn(Optional.of(fourthRating));

        service.applyRatedResult(
                match(MatchMode.TWOS),
                List.of(
                        participant(first, 1, MatchResult.WIN),
                        participant(second, 1, MatchResult.WIN),
                        participant(third, 2, MatchResult.LOSS),
                        participant(fourth, 2, MatchResult.LOSS)));

        assertThat(firstRating.getRating()).isEqualTo(1020);
        assertThat(secondRating.getRating()).isEqualTo(1120);
        assertThat(thirdRating.getRating()).isEqualTo(980);
        assertThat(fourthRating.getRating()).isEqualTo(1080);
        assertThat(firstRating.getRatedMatches()).isEqualTo(1);
        assertThat(fourthRating.getRatedMatches()).isEqualTo(1);
    }

    @Test
    void customMatchesNeverTouchRatedRows() {
        AppUser first = user();
        AppUser second = user();

        service.applyRatedResult(
                match(MatchMode.CUSTOM),
                List.of(
                        participant(first, 1, MatchResult.WIN),
                        participant(second, 2, MatchResult.LOSS)));

        verifyNoInteractions(repository);
    }

    @Test
    void ratingReadsStayAtThePreMatchValueUntilTheResultIsVisible() {
        AppUser player = user();
        PlayerRating currentRating = rating(player, MatchMode.ONES, 1053, 1);
        MatchParticipantRepository participantRepository = mock(MatchParticipantRepository.class);
        MatchParticipantRepository.RatingSnapshotProjection snapshot =
                mock(MatchParticipantRepository.RatingSnapshotProjection.class);
        when(repository.findByUserIdsAndMode(List.of(player.getId()), MatchMode.ONES))
                .thenReturn(List.of(currentRating));
        when(snapshot.getUserId()).thenReturn(player.getId());
        when(snapshot.getRatingBefore()).thenReturn(1035);
        when(snapshot.getRatingAfter()).thenReturn(1053);
        when(snapshot.getResultVisibleAt()).thenReturn(Instant.now().plusSeconds(60));
        when(participantRepository.findRatingSnapshotsByUserIdsAndMode(
                List.of(player.getId()), MatchMode.ONES))
                .thenReturn(List.of(snapshot));

        EloRatingService gatedService = new EloRatingService(repository, participantRepository);

        assertThat(gatedService.ratingFor(player.getId(), MatchMode.ONES)).isEqualTo(1035);
    }

    private static Match match(MatchMode mode) {
        Match match = new Match();
        match.setMode(mode);
        return match;
    }

    private static MatchParticipant participant(AppUser user, int team, MatchResult result) {
        MatchParticipant participant = new MatchParticipant();
        participant.setUser(user);
        participant.setTeamNumber((short) team);
        participant.setResult(result);
        return participant;
    }

    private static PlayerRating rating(
            AppUser user,
            MatchMode mode,
            int currentRating,
            int ratedMatches) {
        PlayerRating rating = new PlayerRating();
        rating.setUser(user);
        rating.setMode(mode);
        rating.setRating(currentRating);
        rating.setRatedMatches(ratedMatches);
        return rating;
    }

    private static AppUser user() {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        return user;
    }
}
