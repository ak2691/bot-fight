package com.example.botfight.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;

class GoogleOAuth2AuthenticationSuccessHandlerTest {

    private final GoogleAuthService googleAuthService = mock(GoogleAuthService.class);
    private final TokenBucketRateLimiter<String> authIpRateLimiter =
            new TokenBucketRateLimiter<>(Clock.systemUTC(), 30, Duration.ofSeconds(1));
    private final GoogleOAuth2AuthenticationSuccessHandler handler =
            new GoogleOAuth2AuthenticationSuccessHandler(
                    googleAuthService,
                    authIpRateLimiter,
                    "http://localhost:5173/");

    @Test
    void redirectsUnexpectedOAuthProcessingFailuresToTheCustomServerErrorRoute() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn("/login/oauth2/code/google");
        OAuth2User googleUser = mock(OAuth2User.class);
        Authentication authentication = new OAuth2AuthenticationToken(
                googleUser,
                List.of(),
                "google");
        when(googleAuthService.loginOrPrepareLink(googleUser, request))
                .thenThrow(new IllegalStateException("temporary OAuth failure"));
        MockHttpServletResponse response = new MockHttpServletResponse();

        handler.onAuthenticationSuccess(request, response, authentication);

        assertThat(response.getRedirectedUrl()).isEqualTo("http://localhost:5173/error");
        verify(googleAuthService).restoreLinkUserAfterFailure(request);
    }
}
