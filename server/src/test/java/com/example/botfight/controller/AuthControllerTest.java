package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.AuthUserDTO;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class AuthControllerTest {

    @Test
    void sessionBootstrapDoesNotUseTheAuthenticatedGetRateLimiter() {
        AuthService authService = mock(AuthService.class);
        GoogleAuthService googleAuthService = mock(GoogleAuthService.class);
        Authentication authentication = mock(Authentication.class);
        AuthUserDTO currentUser = new AuthUserDTO();
        currentUser.setAuthenticated(true);
        when(authService.currentUser(authentication)).thenReturn(currentUser);

        Clock fixedClock = Clock.fixed(Instant.EPOCH, ZoneOffset.UTC);
        AuthController controller = new AuthController(
                authService,
                googleAuthService,
                new TokenBucketRateLimiter<>(fixedClock, 30, Duration.ofSeconds(1)),
                new TokenBucketRateLimiter<>(fixedClock, 5, Duration.ofSeconds(30)),
                new TokenBucketRateLimiter<>(fixedClock, 1, Duration.ofSeconds(1)));

        assertThat(controller.me(authentication).getBody()).isSameAs(currentUser);
        assertThat(controller.me(authentication).getBody()).isSameAs(currentUser);
    }
}
