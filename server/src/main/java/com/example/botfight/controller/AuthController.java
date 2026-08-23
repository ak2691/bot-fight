package com.example.botfight.controller;

import com.example.botfight.DTO.AuthRequestDTO;
import com.example.botfight.DTO.AuthUserDTO;
import com.example.botfight.DTO.EmailVerificationRequestDTO;
import com.example.botfight.DTO.GoogleAuthStatusDTO;
import com.example.botfight.DTO.GoogleLinkRequestDTO;
import com.example.botfight.DTO.RegistrationResponseDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.security.AuthenticatedUserDetails;
import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final int MAX_RATE_LIMIT_EMAIL_KEY_LENGTH = 320;

    private final AuthService authService;
    private final GoogleAuthService googleAuthService;
    private final TokenBucketRateLimiter<String> authIpRateLimiter;
    private final TokenBucketRateLimiter<String> authEmailRateLimiter;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;

    public AuthController(
            AuthService authService,
            GoogleAuthService googleAuthService,
            @Qualifier("authIpRateLimiter") TokenBucketRateLimiter<String> authIpRateLimiter,
            @Qualifier("authEmailRateLimiter") TokenBucketRateLimiter<String> authEmailRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this.authService = authService;
        this.googleAuthService = googleAuthService;
        this.authIpRateLimiter = authIpRateLimiter;
        this.authEmailRateLimiter = authEmailRateLimiter;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
    }

    @PostMapping("/register")
    public ResponseEntity<RegistrationResponseDTO> register(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("register", email(request), httpRequest);
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request, httpRequest));
    }

    @PostMapping("/verify-email")
    public ResponseEntity<AuthUserDTO> verifyEmail(
            @RequestBody EmailVerificationRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("verify", email(request), httpRequest);
        return ResponseEntity.ok(authService.verifyEmail(request, httpRequest));
    }

    @PostMapping("/resend-verification")
    public ResponseEntity<RegistrationResponseDTO> resendVerification(
            @RequestBody EmailVerificationRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("resend-verification", email(request), httpRequest);
        return ResponseEntity.ok(authService.resendVerification(request == null ? null : request.getEmail()));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthUserDTO> login(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("login", email(request), httpRequest);
        return ResponseEntity.ok(authService.login(request, httpRequest));
    }

    @PostMapping("/google/link-existing")
    public ResponseEntity<AuthUserDTO> linkExistingGoogleAccount(
            @RequestBody GoogleLinkRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("google-link", request == null ? null : request.getEmail(), httpRequest);
        return ResponseEntity.ok(googleAuthService.completePendingLink(request, httpRequest));
    }

    @PostMapping("/google/username")
    public ResponseEntity<AuthUserDTO> completeGoogleUsername(
            @RequestBody UsernameRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("google-username", null, httpRequest);
        return ResponseEntity.ok(googleAuthService.completePendingUsername(request, httpRequest));
    }

    @GetMapping("/google/link")
    public void beginGoogleLink(
            Authentication authentication,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) throws IOException {
        requireAuthenticatedGetAllowed(authentication, "google-link-start");
        requireAuthLimits("google-link-start", null, httpRequest);
        googleAuthService.beginLink(authentication, httpRequest);
        httpResponse.sendRedirect("/oauth2/authorization/google");
    }

    @GetMapping("/google/status")
    public GoogleAuthStatusDTO googleStatus(Authentication authentication) {
        requireAuthenticatedGetAllowed(authentication, "google-status");
        return new GoogleAuthStatusDTO(googleAuthService.isGoogleLinked(authentication));
    }

    @PostMapping("/logout")
    public ResponseEntity<AuthUserDTO> logout(
            HttpServletRequest request,
            HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        if (request.getSession(false) != null) {
            request.getSession(false).invalidate();
        }
        return ResponseEntity.ok(AuthUserDTO.guest());
    }

    @GetMapping("/me")
    public ResponseEntity<AuthUserDTO> me(Authentication authentication) {
        requireAuthenticatedGetAllowed(authentication, "auth-me");
        return ResponseEntity.ok(authService.currentUser(authentication));
    }

    @GetMapping("/csrf")
    public ResponseEntity<Map<String, String>> csrf(CsrfToken csrfToken) {
        return ResponseEntity.ok(Map.of(
                "headerName", csrfToken.getHeaderName(),
                "token", csrfToken.getToken()));
    }

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<Map<String, String>> handleAuthException(AuthException ex) {
        return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
    }

    private void requireAuthLimits(String action, String email, HttpServletRequest request) {
        String clientIp = request == null ? null : request.getRemoteAddr();
        if (clientIp == null || clientIp.isBlank()) {
            clientIp = "unknown";
        }
        authIpRateLimiter.requireAllowed("auth:ip:" + clientIp);

        String normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail.isBlank()) {
            authEmailRateLimiter.requireAllowed("auth:" + action + ":email:" + normalizedEmail);
        }
    }

    private void requireAuthenticatedGetAllowed(Authentication authentication, String category) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)
                || principal.getId() == null) {
            return;
        }
        authenticatedGetRateLimiter.requireAllowed(category + ":" + principal.getId());
    }

    private String email(AuthRequestDTO request) {
        return request == null ? null : request.getEmail();
    }

    private String email(EmailVerificationRequestDTO request) {
        return request == null ? null : request.getEmail();
    }

    private String normalizeEmail(String email) {
        if (email == null) return "";
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        return normalized.length() <= MAX_RATE_LIMIT_EMAIL_KEY_LENGTH
                ? normalized
                : normalized.substring(0, MAX_RATE_LIMIT_EMAIL_KEY_LENGTH);
    }
}
