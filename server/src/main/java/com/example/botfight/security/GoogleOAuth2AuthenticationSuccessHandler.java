package com.example.botfight.security;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class GoogleOAuth2AuthenticationSuccessHandler implements AuthenticationSuccessHandler {

    private static final Logger log = LoggerFactory.getLogger(GoogleOAuth2AuthenticationSuccessHandler.class);

    private final GoogleAuthService googleAuthService;
    private final TokenBucketRateLimiter<String> authIpRateLimiter;
    private final String frontendOrigin;

    public GoogleOAuth2AuthenticationSuccessHandler(
            GoogleAuthService googleAuthService,
            @Qualifier("authIpRateLimiter") TokenBucketRateLimiter<String> authIpRateLimiter,
            @Value("${botfight.security.frontend-origin:http://localhost:5173}") String frontendOrigin) {
        this.googleAuthService = googleAuthService;
        this.authIpRateLimiter = authIpRateLimiter;
        this.frontendOrigin = frontendOrigin.replaceAll("/+$", "");
    }

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication) throws IOException, ServletException {
        try {
            if (!(authentication instanceof OAuth2AuthenticationToken oauthToken)
                    || !"google".equals(oauthToken.getAuthorizedClientRegistrationId())
                    || !(authentication.getPrincipal() instanceof OAuth2User googleUser)) {
                throw new AuthException("unsupported OAuth provider");
            }

            authIpRateLimiter.requireAllowed("auth:ip:" + clientIp(request));
            GoogleAuthService.GoogleLoginResult result = googleAuthService.loginOrPrepareLink(googleUser, request);
            if (result.linkRequired()) {
                redirect(response, "/login?google=link-required");
            } else if (!result.authenticated()) {
                redirect(response, "/login?google=username-required");
            } else if (result.profileLink()) {
                redirect(response, "/profile?google=linked");
            } else {
                redirect(response, "/home");
            }
        } catch (AuthException exception) {
            googleAuthService.restoreLinkUserAfterFailure(request);
            redirect(response, "/login?google=error");
        } catch (RateLimitExceededException exception) {
            googleAuthService.restoreLinkUserAfterFailure(request);
            redirect(response, "/login?google=error");
        } catch (RuntimeException exception) {
            log.error("Unexpected OAuth success-handler failure for {}", request.getRequestURI(), exception);
            restoreLinkUserOrClearOAuthState(request);
            redirect(response, "/error");
        }
    }

    private void restoreLinkUserOrClearOAuthState(HttpServletRequest request) {
        try {
            googleAuthService.restoreLinkUserAfterFailure(request);
        } catch (RuntimeException cleanupException) {
            log.error("Could not restore OAuth link state after an unexpected failure", cleanupException);
            googleAuthService.clearOAuthAuthentication(request);
        }
    }

    private void redirect(HttpServletResponse response, String path) throws IOException {
        response.sendRedirect(frontendOrigin + path);
    }

    private String clientIp(HttpServletRequest request) {
        String clientIp = request == null ? null : request.getRemoteAddr();
        return clientIp == null || clientIp.isBlank() ? "unknown" : clientIp;
    }
}
