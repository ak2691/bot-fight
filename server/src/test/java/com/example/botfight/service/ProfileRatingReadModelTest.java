package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.profile.ProfileService;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class ProfileRatingReadModelTest {

    @Test
    void exposesModeSpecificRatingsFromTheCachedProfileReadModel() {
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        UserRepository userRepository = mock(UserRepository.class);
        MatchParticipantRepository participantRepository = mock(MatchParticipantRepository.class);
        PuzzleCompletionRepository puzzleCompletionRepository = mock(PuzzleCompletionRepository.class);
        ProfileRepository profileRepository = mock(ProfileRepository.class);
        EloRatingService eloRatingService = mock(EloRatingService.class);
        Authentication authentication = mock(Authentication.class);
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername("rating-user");

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(eloRatingService.ratingFor(user.getId(), MatchMode.ONES)).thenReturn(1234);
        when(eloRatingService.ratingFor(user.getId(), MatchMode.TWOS)).thenReturn(1188);

        ProfileService service = new ProfileService(
                currentUserService,
                userRepository,
                participantRepository,
                puzzleCompletionRepository,
                profileRepository,
                new SlidingWindowRateLimiter<>(Clock.systemUTC(), 10, Duration.ofMinutes(1)),
                new TokenBucketRateLimiter<String>(Clock.systemUTC(), 2, Duration.ofSeconds(1)),
                new DatabaseLookupCache(),
                eloRatingService);

        var first = service.currentProfile(authentication);
        var second = service.currentProfile(authentication);

        assertThat(first.queueStats().ones().elo()).isEqualTo(1234);
        assertThat(first.queueStats().twos().elo()).isEqualTo(1188);
        assertThat(second).isSameAs(first);
        verify(eloRatingService).ratingFor(user.getId(), MatchMode.ONES);
        verify(eloRatingService).ratingFor(user.getId(), MatchMode.TWOS);
    }
}
