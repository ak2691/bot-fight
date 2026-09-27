package com.example.botfight.controller;

import com.example.botfight.DTO.auth.AuthRequestDTO;
import com.example.botfight.DTO.auth.AuthRequestResponseDTO;
import com.example.botfight.DTO.auth.AuthUserDTO;
import com.example.botfight.DTO.auth.EmailVerificationRequestDTO;
import com.example.botfight.DTO.auth.GoogleAuthStatusDTO;
import com.example.botfight.DTO.auth.GoogleLinkRequestDTO;
import com.example.botfight.DTO.auth.PasswordChangeRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetPasswordRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetRequestResponseDTO;
import com.example.botfight.DTO.auth.PasswordResetStatusDTO;
import com.example.botfight.DTO.auth.PasswordResetVerificationRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetVerificationResponseDTO;
import com.example.botfight.DTO.auth.UsernameRequestDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.auth.PasswordResetService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.security.AuthenticatedUserDetails;
import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.core.task.TaskExecutor;
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
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final AuthService authService;
    private final GoogleAuthService googleAuthService;
    private final TokenBucketRateLimiter<String> authIpRateLimiter;
    private final TokenBucketRateLimiter<String> authEmailRateLimiter;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;
    private final PasswordResetService passwordResetService;
    private final TaskExecutor authRequestExecutor;

    @Autowired
    public AuthController(
            AuthService authService,
            GoogleAuthService googleAuthService,
            @Qualifier("authIpRateLimiter") TokenBucketRateLimiter<String> authIpRateLimiter,
            @Qualifier("authEmailRateLimiter") TokenBucketRateLimiter<String> authEmailRateLimiter,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter,
            PasswordResetService passwordResetService,
            @Qualifier("authRequestExecutor") TaskExecutor authRequestExecutor) {
        this.authService = authService;
        this.googleAuthService = googleAuthService;
        this.authIpRateLimiter = authIpRateLimiter;
        this.authEmailRateLimiter = authEmailRateLimiter;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
        this.passwordResetService = passwordResetService;
        this.authRequestExecutor = authRequestExecutor;
    }

    /** Compatibility constructor for focused controller tests that do not exercise password reset routes. */
    public AuthController(
            AuthService authService,
            GoogleAuthService googleAuthService,
            TokenBucketRateLimiter<String> authIpRateLimiter,
            TokenBucketRateLimiter<String> authEmailRateLimiter,
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter,
            PasswordResetService passwordResetService) {
        this(
                authService,
                googleAuthService,
                authIpRateLimiter,
                authEmailRateLimiter,
                authenticatedGetRateLimiter,
                passwordResetService,
                new SyncTaskExecutor());
    }

    /** Compatibility constructor for focused controller tests that do not exercise password reset routes. */
    public AuthController(
            AuthService authService,
            GoogleAuthService googleAuthService,
            TokenBucketRateLimiter<String> authIpRateLimiter,
            TokenBucketRateLimiter<String> authEmailRateLimiter,
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this(
                authService,
                googleAuthService,
                authIpRateLimiter,
                authEmailRateLimiter,
                authenticatedGetRateLimiter,
                null,
                new SyncTaskExecutor());
    }

    @PostMapping("/register")
    public ResponseEntity<AuthRequestResponseDTO> register(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("register", email(request), httpRequest);
        authService.validateRegistration(request);

        AuthRequestDTO queuedRequest = new AuthRequestDTO();
        if (request != null) {
            queuedRequest.setEmail(request.getEmail());
            queuedRequest.setUsername(request.getUsername());
            queuedRequest.setPassword(request.getPassword());
        }
        enqueueAccountStateDependentWork("registration", () -> authService.register(queuedRequest));
        return ResponseEntity.accepted().body(AuthRequestResponseDTO.registration());
    }

    @PostMapping("/verify-email")
    public ResponseEntity<AuthUserDTO> verifyEmail(
            @RequestBody EmailVerificationRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("verify", email(request), httpRequest);
        return ResponseEntity.ok(authService.verifyEmail(request, httpRequest));
    }

    @PostMapping("/resend-verification")
    public ResponseEntity<AuthRequestResponseDTO> resendVerification(
            @RequestBody EmailVerificationRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("resend-verification", email(request), httpRequest);
        String requestedEmail = request == null ? null : request.getEmail();
        enqueueAccountStateDependentWork("verification-resend", () -> authService.resendVerification(requestedEmail));
        return ResponseEntity.ok(AuthRequestResponseDTO.verificationResend());
    }

    @PostMapping("/login")
    public ResponseEntity<AuthUserDTO> login(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("login", email(request), httpRequest);
        return ResponseEntity.ok(authService.login(request, httpRequest));
    }

    @PostMapping("/guest")
    public ResponseEntity<AuthUserDTO> guest(HttpServletRequest httpRequest) {
        requireAuthLimits("guest", null, httpRequest);
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.playAsGuest(httpRequest));
    }

    @PostMapping({"/password-reset/request", "/forgot-password"})
    public ResponseEntity<PasswordResetRequestResponseDTO> requestPasswordReset(
            @RequestBody PasswordResetRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("password-reset-request", email(request), httpRequest);
        String requestedEmail = request == null ? null : request.getEmail();
        enqueueAccountStateDependentWork(
                "password-reset-request",
                () -> passwordResetService.requestPasswordReset(requestedEmail));
        return ResponseEntity.ok(PasswordResetRequestResponseDTO.generic());
    }

    @PostMapping({"/password-reset/verify", "/verify-password-reset"})
    public ResponseEntity<PasswordResetVerificationResponseDTO> verifyPasswordReset(
            @RequestBody PasswordResetVerificationRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("password-reset-verify", email(request), httpRequest);
        passwordResetService.verifyCode(
                request == null ? null : request.getEmail(),
                request == null ? null : request.getCode(),
                httpRequest);
        return ResponseEntity.ok(new PasswordResetVerificationResponseDTO(true));
    }

    @GetMapping("/password-reset/status")
    public PasswordResetStatusDTO passwordResetStatus(HttpServletRequest httpRequest) {
        return passwordResetService.status(httpRequest);
    }

    @PostMapping({"/password-reset", "/reset-password"})
    public ResponseEntity<Map<String, String>> resetPassword(
            @RequestBody PasswordResetPasswordRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("password-reset-complete", null, httpRequest);
        passwordResetService.resetPassword(request, httpRequest);
        invalidateSession(httpRequest);
        return ResponseEntity.ok(Map.of("message", "Password reset successfully"));
    }

    @PostMapping("/change-password")
    public ResponseEntity<AuthUserDTO> changePassword(
            Authentication authentication,
            @RequestBody PasswordChangeRequestDTO request,
            HttpServletRequest httpRequest) {
        requireAuthLimits("change-password", authenticatedEmail(authentication), httpRequest);
        AuthUserDTO updatedUser = authService.changePassword(authentication, request);
        rotateSessionId(httpRequest);
        return ResponseEntity.ok(updatedUser);
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
    public ResponseEntity<AuthUserDTO> me(
            Authentication authentication,
            HttpServletRequest request) {
        // Session bootstrap must remain available after a page refresh. Edge-level
        // rate limiting protects this idempotent endpoint; do not turn a temporary
        // application limiter response into a client-side logout.
        AuthUserDTO currentUser = authService.currentUser(authentication);
        if (!currentUser.isAuthenticated()
                && !currentUser.isGuest()
                && hasInvalidSessionCookie(request)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(currentUser);
        }
        return ResponseEntity.ok(currentUser);
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

    private void enqueueAccountStateDependentWork(String flow, Runnable work) {
        try {
            authRequestExecutor.execute(() -> {
                try {
                    work.run();
                } catch (RuntimeException exception) {
                    // Public acknowledgements intentionally do not reveal delivery, lookup, or account state.
                    log.warn("Background auth flow {} failed ({})", flow, exception.getClass().getSimpleName());
                }
            });
        } catch (RuntimeException exception) {
            // A saturated queue must not create an account-state-dependent response either.
            log.warn("Background auth flow {} could not be queued ({})", flow, exception.getClass().getSimpleName());
        }
    }

    private void rotateSessionId(HttpServletRequest request) {
        if (request != null && request.getSession(false) != null) {
            request.changeSessionId();
        }
    }

    private void invalidateSession(HttpServletRequest request) {
        HttpSession session = request == null ? null : request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();
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

    private boolean hasInvalidSessionCookie(HttpServletRequest request) {
        return request != null
                && request.isRequestedSessionIdFromCookie()
                && request.getRequestedSessionId() != null
                && !request.isRequestedSessionIdValid();
    }

    private String email(AuthRequestDTO request) {
        return request == null ? null : request.getEmail();
    }

    private String email(EmailVerificationRequestDTO request) {
        return request == null ? null : request.getEmail();
    }

    private String email(PasswordResetRequestDTO request) {
        return request == null ? null : request.getEmail();
    }

    private String email(PasswordResetVerificationRequestDTO request) {
        return request == null ? null : request.getEmail();
    }

    private String authenticatedEmail(Authentication authentication) {
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)) {
            return null;
        }
        return principal.getEmail();
    }

    private String normalizeEmail(String email) {
        if (email == null) return "";
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        return normalized.length() <= MAX_RATE_LIMIT_EMAIL_KEY_LENGTH
                ? normalized
                : normalized.substring(0, MAX_RATE_LIMIT_EMAIL_KEY_LENGTH);
    }
}
