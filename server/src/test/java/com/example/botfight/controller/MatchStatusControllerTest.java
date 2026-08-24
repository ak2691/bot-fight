package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.match.MatchService;
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
        UUID userId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        Instant disconnectEndsAt = Instant.parse("2026-07-24T12:00:30Z");
        when(currentUserService.requireCurrentUserId(authentication)).thenReturn(userId);
        when(matchService.activeMatchStatus(userId)).thenReturn(
                new ActiveMatchStatusDTO(
                        true,
                        true,
                        matchId,
                        disconnectEndsAt));

        MatchStatusController controller = new MatchStatusController(currentUserService, matchService);
        ActiveMatchStatusDTO status = controller.activeMatch(authentication);
        ActiveMatchStatusDTO refreshedStatus = controller.activeMatch(authentication);

        assertThat(status.activeMatch()).isTrue();
        assertThat(status.disconnected()).isTrue();
        assertThat(status.matchId()).isEqualTo(matchId);
        assertThat(status.disconnectEndsAt()).isEqualTo(disconnectEndsAt);
        assertThat(refreshedStatus).isSameAs(status);
        verify(currentUserService, times(2)).requireCurrentUserId(authentication);
        verify(matchService, times(2)).activeMatchStatus(userId);
    }
}
