package com.example.botfight.security;

import com.example.botfight.service.AuthException;
import com.example.botfight.service.GoogleAuthService;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

@Component
public class GoogleOAuth2AuthenticationSuccessHandler implements AuthenticationSuccessHandler {

    private final GoogleAuthService googleAuthService;
    private final String frontendOrigin;

    public GoogleOAuth2AuthenticationSuccessHandler(
            GoogleAuthService googleAuthService,
            @Value("${botfight.security.frontend-origin:http://localhost:5173}") String frontendOrigin) {
        this.googleAuthService = googleAuthService;
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
        }
    }

    private void redirect(HttpServletResponse response, String path) throws IOException {
        response.sendRedirect(frontendOrigin + path);
    }
}
