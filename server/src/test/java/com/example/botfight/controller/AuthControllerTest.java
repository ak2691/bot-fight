package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.AuthUserDTO;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
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

        HttpServletRequest request = mock(HttpServletRequest.class);
        assertThat(controller.me(authentication, request).getBody()).isSameAs(currentUser);
        assertThat(controller.me(authentication, request).getBody()).isSameAs(currentUser);
    }

    @Test
    void invalidSessionCookieReturnsUnauthorizedButAnonymousBootstrapRemainsAvailable() {
        AuthService authService = mock(AuthService.class);
        GoogleAuthService googleAuthService = mock(GoogleAuthService.class);
        Authentication authentication = mock(Authentication.class);
        when(authService.currentUser(authentication)).thenReturn(AuthUserDTO.guest());

        Clock fixedClock = Clock.fixed(Instant.EPOCH, ZoneOffset.UTC);
        AuthController controller = new AuthController(
                authService,
                googleAuthService,
                new TokenBucketRateLimiter<>(fixedClock, 30, Duration.ofSeconds(1)),
                new TokenBucketRateLimiter<>(fixedClock, 5, Duration.ofSeconds(30)),
                new TokenBucketRateLimiter<>(fixedClock, 1, Duration.ofSeconds(1)));

        HttpServletRequest staleRequest = mock(HttpServletRequest.class);
        when(staleRequest.isRequestedSessionIdFromCookie()).thenReturn(true);
        when(staleRequest.getRequestedSessionId()).thenReturn("stale-session");
        when(staleRequest.isRequestedSessionIdValid()).thenReturn(false);

        assertThat(controller.me(authentication, staleRequest).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        HttpServletRequest freshRequest = mock(HttpServletRequest.class);
        assertThat(controller.me(authentication, freshRequest).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }
}
