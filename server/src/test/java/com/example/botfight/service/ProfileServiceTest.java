package com.example.botfight.service;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.profile.ProfileService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.Profile;
import com.example.botfight.DTO.AboutMeRequestDTO;
import com.example.botfight.DTO.ProfileSearchPageDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchParticipantRepository.RecentMatchProjection;
import com.example.botfight.repository.PuzzleCompletionRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.core.Authentication;
import org.springframework.test.util.ReflectionTestUtils;

class ProfileServiceTest {

    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final MatchParticipantRepository participantRepository = mock(MatchParticipantRepository.class);
    private final PuzzleCompletionRepository puzzleCompletionRepository = mock(PuzzleCompletionRepository.class);
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final ProfileService service = new ProfileService(
            currentUserService,
            userRepository,
            participantRepository,
            puzzleCompletionRepository,
            profileRepository,
            new SlidingWindowRateLimiter<>(Clock.systemUTC(), 10, Duration.ofMinutes(1)),
            new TokenBucketRateLimiter<String>(Clock.systemUTC(), 1, Duration.ofSeconds(1)));

    @Test
    void returnsOwnedAggregate() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        ReflectionTestUtils.setField(user, "createdAt", Instant.parse("2026-01-15T12:00:00Z"));
        Profile storedProfile = new Profile();
        storedProfile.setUser(user);
        storedProfile.setAboutMe("A careful bot builder.");

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(profileRepository.findByUserId(user.getId())).thenReturn(Optional.of(storedProfile));
        when(participantRepository.countByUserIdAndResultAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()), eq(MatchResult.WIN), any(Instant.class))).thenReturn(7L);
        when(participantRepository.countByUserIdAndResultInAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()),
                eq(List.of(MatchResult.LOSS, MatchResult.FORFEIT)),
                any(Instant.class))).thenReturn(3L);
        when(participantRepository.countByUserIdAndResultAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()), eq(MatchResult.DRAW), any(Instant.class))).thenReturn(2L);
        when(participantRepository.countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()), eq(MatchMode.ONES), eq(MatchResult.WIN), any(Instant.class)))
                .thenReturn(5L);
        when(participantRepository.countByUserIdAndModeAndResultInAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()),
                eq(MatchMode.ONES),
                eq(List.of(MatchResult.LOSS, MatchResult.FORFEIT)),
                any(Instant.class)))
                .thenReturn(2L);
        when(participantRepository.countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()), eq(MatchMode.ONES), eq(MatchResult.DRAW), any(Instant.class)))
                .thenReturn(1L);
        when(participantRepository.countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()), eq(MatchMode.TWOS), eq(MatchResult.WIN), any(Instant.class)))
                .thenReturn(2L);
        when(participantRepository.countByUserIdAndModeAndResultInAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()),
                eq(MatchMode.TWOS),
                eq(List.of(MatchResult.LOSS, MatchResult.FORFEIT)),
                any(Instant.class)))
                .thenReturn(1L);
        when(participantRepository.countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
                eq(user.getId()), eq(MatchMode.TWOS), eq(MatchResult.DRAW), any(Instant.class)))
                .thenReturn(3L);
        when(puzzleCompletionRepository.countByUserId(user.getId())).thenReturn(4L);
        var profileView = service.currentProfile(authentication);

        assertThat(profileView.username()).isEqualTo("allan");
        assertThat(profileView.matchesPlayed()).isEqualTo(12);
        assertThat(profileView.joinedAt()).isEqualTo(Instant.parse("2026-01-15T12:00:00Z"));
        assertThat(profileView.aboutMe()).isEqualTo("A careful bot builder.");
        assertThat(profileView.wins()).isEqualTo(7);
        assertThat(profileView.losses()).isEqualTo(3);
        assertThat(profileView.draws()).isEqualTo(2);
        assertThat(profileView.puzzlesSolved()).isEqualTo(4);
        assertThat(profileView.queueStats().ones().wins()).isEqualTo(5);
        assertThat(profileView.queueStats().ones().losses()).isEqualTo(2);
        assertThat(profileView.queueStats().ones().draws()).isEqualTo(1);
        assertThat(profileView.queueStats().twos().wins()).isEqualTo(2);
        assertThat(profileView.queueStats().twos().losses()).isEqualTo(1);
        assertThat(profileView.queueStats().twos().draws()).isEqualTo(3);
    }

    @Test
    void returnsTwentyMatchPagesWithOpponentAndDateFilters() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        UUID matchId = UUID.randomUUID();
        Instant from = Instant.parse("2026-07-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-01T00:00:00Z");
        PageRequest pageRequest = PageRequest.of(0, 20);
        RecentMatchProjection recentMatch = mock(RecentMatchProjection.class);

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(participantRepository.findRecentMatches(
                eq(user.getId()),
                any(Instant.class),
                eq("byte"),
                eq(from),
                eq(to),
                eq(pageRequest)))
                .thenReturn(new PageImpl<>(List.of(recentMatch), pageRequest, 21));
        when(recentMatch.getMatchId()).thenReturn(matchId);
        when(recentMatch.getOpponentUsername()).thenReturn("ByteBrawler");
        when(recentMatch.getResult()).thenReturn(MatchResult.WIN);
        when(recentMatch.getCompletedAt()).thenReturn(Instant.parse("2026-07-22T10:15:00Z"));
        when(recentMatch.getCompletionReason()).thenReturn("SIMULATION");

        var history = service.matchHistory(authentication, 0, " byte ", from, to);

        assertThat(history.pageSize()).isEqualTo(20);
        assertThat(history.hasMore()).isTrue();
        assertThat(history.totalMatches()).isEqualTo(21);
        assertThat(history.matches()).singleElement().satisfies(recent -> {
            assertThat(recent.opponentUsername()).isEqualTo("ByteBrawler");
            assertThat(recent.result()).isEqualTo("WIN");
            assertThat(recent.completedAt()).isEqualTo(Instant.parse("2026-07-22T10:15:00Z"));
        });
    }

    @Test
    void updatesOwnedUsernameAfterCheckingUniqueness() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        UsernameRequestDTO request = new UsernameRequestDTO();
        request.setUsername("Allan_2");

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(userRepository.existsByUsernameIgnoreCaseAndIdNot("Allan_2", user.getId())).thenReturn(false);

        var profile = service.updateUsername(authentication, request);

        assertThat(user.getUsername()).isEqualTo("Allan_2");
        assertThat(profile.username()).isEqualTo("Allan_2");
        org.mockito.Mockito.verify(userRepository).saveAndFlush(user);
    }

    @Test
    void rejectsTakenUsernameBeforeChangingOwnedUser() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        UsernameRequestDTO request = new UsernameRequestDTO();
        request.setUsername("rival");

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(userRepository.existsByUsernameIgnoreCaseAndIdNot("rival", user.getId())).thenReturn(true);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.updateUsername(authentication, request))
                .isInstanceOf(AuthException.class)
                .hasMessage("username is already taken");
        assertThat(user.getUsername()).isEqualTo("allan");
    }

    @Test
    void searchesVerifiedProfilesInTwentyResultPages() {
        Authentication authentication = mock(Authentication.class);
        AppUser viewer = user("allan");
        AppUser first = user("ByteBrawler");
        AppUser second = user("ByteSmith");
        PageRequest pageRequest = PageRequest.of(
                0,
                20,
                Sort.by(Sort.Direction.ASC, "username", "id"));

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(viewer.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(viewer);
        when(userRepository.findByEmailVerifiedTrueAndUsernameContainingIgnoreCaseOrderByUsernameAscIdAsc(
                "byte",
                pageRequest))
                .thenReturn(new PageImpl<>(List.of(first, second), pageRequest, 21));

        ProfileSearchPageDTO results = service.searchProfiles(authentication, 0, " byte ");

        assertThat(results.profiles())
                .extracting(ProfileSearchPageDTO.ProfileSearchResultDTO::username)
                .containsExactly("ByteBrawler", "ByteSmith");
        assertThat(results.pageSize()).isEqualTo(20);
        assertThat(results.hasMore()).isTrue();
        assertThat(results.totalProfiles()).isEqualTo(21);
    }

    @Test
    void loadsPublicProfileForRequestedUsernameWhileUsingAuthenticatedViewer() {
        Authentication authentication = mock(Authentication.class);
        AppUser viewer = user("allan");
        AppUser target = user("rival");
        ReflectionTestUtils.setField(target, "createdAt", Instant.parse("2026-02-10T12:00:00Z"));

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(viewer.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(viewer);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("Rival"))
                .thenReturn(Optional.of(target));
        when(profileRepository.findByUserId(target.getId())).thenReturn(Optional.empty());

        var profile = service.publicProfile(authentication, " Rival ");

        assertThat(profile.username()).isEqualTo("rival");
        assertThat(profile.joinedAt()).isEqualTo(Instant.parse("2026-02-10T12:00:00Z"));
    }

    @Test
    void loadsPublicMatchHistoryForRequestedUsername() {
        Authentication authentication = mock(Authentication.class);
        AppUser viewer = user("allan");
        AppUser target = user("rival");
        UUID matchId = UUID.randomUUID();
        PageRequest pageRequest = PageRequest.of(0, 20);
        RecentMatchProjection recentMatch = mock(RecentMatchProjection.class);

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(viewer.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(viewer);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("rival"))
                .thenReturn(Optional.of(target));
        when(participantRepository.findRecentMatches(
                eq(target.getId()),
                any(Instant.class),
                eq(""),
                eq(null),
                eq(null),
                eq(pageRequest)))
                .thenReturn(new PageImpl<>(List.of(recentMatch), pageRequest, 1));
        when(recentMatch.getMatchId()).thenReturn(matchId);
        when(recentMatch.getOpponentUsername()).thenReturn("ByteBrawler");
        when(recentMatch.getResult()).thenReturn(MatchResult.WIN);
        when(recentMatch.getCompletedAt()).thenReturn(Instant.parse("2026-07-22T10:15:00Z"));

        var history = service.publicMatchHistory(authentication, "rival", 0, "", null, null);

        assertThat(history.matches()).singleElement().satisfies(recent -> {
            assertThat(recent.opponentUsername()).isEqualTo("ByteBrawler");
            assertThat(recent.result()).isEqualTo("WIN");
        });
    }

    @Test
    void normalizesAndPersistsPlainTextAboutMeForAuthenticatedUser() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        Profile profile = new Profile();
        profile.setUser(user);
        AboutMeRequestDTO request = new AboutMeRequestDTO();
        request.setAboutMe("SELECT * FROM users;\r\n<script>alert(1)</script>");

        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(profileRepository.findByUserId(user.getId())).thenReturn(Optional.of(profile));

        service.updateAboutMe(authentication, request);

        assertThat(profile.getAboutMe()).isEqualTo("SELECT * FROM users;\n<script>alert(1)</script>");
        org.mockito.Mockito.verify(profileRepository).saveAndFlush(profile);
    }

    @Test
    void rejectsAboutMeControlCharactersAndOversizedValues() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(user.getId());
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);

        AboutMeRequestDTO controlCharacterRequest = new AboutMeRequestDTO();
        controlCharacterRequest.setAboutMe("safe\u0007text");
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.updateAboutMe(authentication, controlCharacterRequest))
                .isInstanceOf(AuthException.class)
                .hasMessage("About Me contains an unsupported control character");

        AboutMeRequestDTO oversizedRequest = new AboutMeRequestDTO();
        oversizedRequest.setAboutMe("x".repeat(501));
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.updateAboutMe(authentication, oversizedRequest))
                .isInstanceOf(AuthException.class)
                .hasMessage("About Me must be 500 characters or fewer");
    }

    private static AppUser user(String username) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        return user;
    }

}
