package com.example.botfight.security;

import com.example.botfight.service.GoogleAuthService;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

@Component
public class GoogleOAuth2AuthenticationFailureHandler implements AuthenticationFailureHandler {

    private final GoogleAuthService googleAuthService;
    private final String frontendOrigin;

    public GoogleOAuth2AuthenticationFailureHandler(
            GoogleAuthService googleAuthService,
            @Value("${botfight.security.frontend-origin:http://localhost:5173}") String frontendOrigin) {
        this.googleAuthService = googleAuthService;
        this.frontendOrigin = frontendOrigin.replaceAll("/+$", "");
    }

    @Override
    public void onAuthenticationFailure(
            HttpServletRequest request,
            HttpServletResponse response,
        AuthenticationException exception) throws IOException, ServletException {
        googleAuthService.clearFlowState(request);
        response.sendRedirect(frontendOrigin + "/login?google=error");
    }
}
