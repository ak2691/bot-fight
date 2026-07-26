package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.CurrentUserService;
import com.example.botfight.service.MatchService;
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
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(matchService.activeMatchStatus(userId)).thenReturn(
                new ActiveMatchStatusDTO(
                        true,
                        true,
                        matchId,
                        disconnectEndsAt));

        ActiveMatchStatusDTO status = new MatchStatusController(
                currentUserService,
                matchService).activeMatch(authentication);

        assertThat(status.activeMatch()).isTrue();
        assertThat(status.disconnected()).isTrue();
        assertThat(status.matchId()).isEqualTo(matchId);
        assertThat(status.disconnectEndsAt()).isEqualTo(disconnectEndsAt);
        verify(matchService).activeMatchStatus(userId);
    }
}
