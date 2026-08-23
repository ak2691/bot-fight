package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class MatchStatusControllerTest {

    @Test
    void activeMatchStatusUsesTheAuthenticatedUserRatherThanAClientUserId() {
        CurrentUserService currentUserService = mock(CurrentUserService.class);
        MatchService matchService = mock(MatchService.class);
        Authentication authentication = mock(Authentication.class);
        AppUser user = new AppUser();
        UUID userId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        Instant disconnectEndsAt = Instant.parse("2026-07-24T12:00:30Z");
        user.setId(userId);
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(userId);
        when(matchService.activeMatchStatus(userId)).thenReturn(
                new ActiveMatchStatusDTO(
                        true,
                        true,
                        matchId,
                        disconnectEndsAt));

        ActiveMatchStatusDTO status = new MatchStatusController(
                currentUserService,
                matchService,
                new TokenBucketRateLimiter<String>(Clock.systemUTC(), 1, Duration.ofSeconds(1)))
                .activeMatch(authentication);

        assertThat(status.activeMatch()).isTrue();
        assertThat(status.disconnected()).isTrue();
        assertThat(status.matchId()).isEqualTo(matchId);
        assertThat(status.disconnectEndsAt()).isEqualTo(disconnectEndsAt);
        verify(currentUserService).requireCurrentUserId(authentication);
        verify(matchService).activeMatchStatus(userId);
    }
}
