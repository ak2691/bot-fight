package com.example.botfight.service.auth;

import com.example.botfight.DTO.auth.AuthRequestDTO;
import com.example.botfight.DTO.auth.AuthUserDTO;
import com.example.botfight.DTO.auth.EmailVerificationRequestDTO;
import com.example.botfight.DTO.auth.PasswordChangeRequestDTO;
import com.example.botfight.DTO.auth.RegistrationResponseDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.security.AuthenticatedUserDetails;
import com.example.botfight.service.limits.RateLimitExceededException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.beans.factory.annotation.Autowired;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final Duration GUEST_SESSION_DURATION = Duration.ofHours(24);
    private static final int MAX_ACTIVE_GUEST_ACCOUNTS = 5_000;
    private static final int MAX_GUESTS_PER_IP_PER_DAY = 100;
    private final Map<String, ArrayDeque<Instant>> guestCreationsByIp = new HashMap<>();
    private static final int GUEST_USERNAME_SUFFIX_LENGTH = 12;
    private static final int GUEST_USERNAME_GENERATION_ATTEMPTS = 5;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailVerificationService emailVerificationService;
    private SingleUserWebSocketSessionRegistry webSocketSessions;
    private Clock clock = Clock.systemUTC();

    @Autowired
    public void setClock(Clock clock) {
        this.clock = clock;
    }

    @Autowired(required = false)
    public void setWebSocketSessions(SingleUserWebSocketSessionRegistry webSocketSessions) {
        this.webSocketSessions = webSocketSessions;
        AuthSessionRegistry.setWebSocketSessions(webSocketSessions);
    }

    public AuthService(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            EmailVerificationService emailVerificationService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailVerificationService = emailVerificationService;
    }

    @Transactional(readOnly = true)
    public void validateRegistration(AuthRequestDTO request) {
        RegistrationDetails details = validateRegistrationFields(request);
        validateUsernameAvailable(details.username());
    }

    @Transactional
    public RegistrationResponseDTO register(AuthRequestDTO request) {
        RegistrationDetails details = validateRegistrationFields(request);
        validateUsernameAvailable(details.username());

        if (userRepository.existsByNormalizedEmail(details.normalizedEmail())) {
            throw new AuthException("email is already registered");
        }

        AppUser user = new AppUser();
        user.setEmail(details.email());
        user.setNormalizedEmail(details.normalizedEmail());
        user.setUsername(details.username());
        user.setPasswordHash(passwordEncoder.encode(details.password()));
        user.setEmailVerified(false);
        AppUser savedUser = userRepository.save(user);

        emailVerificationService.sendVerificationCode(savedUser, false);
        return new RegistrationResponseDTO(savedUser.getEmail());
    }

    private RegistrationDetails validateRegistrationFields(AuthRequestDTO request) {
        String email = clean(request == null ? null : request.getEmail());
        String normalizedEmail = normalizeEmail(email);
        String username = UsernamePolicy.clean(request == null ? null : request.getUsername());
        String password = request == null ? null : request.getPassword();

        validateEmail(email);
        UsernamePolicy.validate(username);
        PasswordPolicy.validateForRegistration(password);
        return new RegistrationDetails(email, normalizedEmail, username, password);
    }

    private void validateUsernameAvailable(String username) {
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new AuthException("username is already taken");
        }
    }

    private record RegistrationDetails(String email, String normalizedEmail, String username, String password) {}

    @Transactional
    public RegistrationResponseDTO resendVerification(String email) {
        String cleanedEmail = clean(email);
        validateEmail(cleanedEmail);
        AppUser user = userRepository.findByNormalizedEmail(normalizeEmail(cleanedEmail))
                .orElseThrow(() -> new AuthException("verification code could not be sent"));
        if (user.isEmailVerified()) {
            throw new AuthException("email is already verified; please log in");
        }

        emailVerificationService.sendVerificationCode(user, true);
        return new RegistrationResponseDTO(user.getEmail());
    }

    @Transactional(noRollbackFor = AuthException.class)
    public AuthUserDTO verifyEmail(
            EmailVerificationRequestDTO request,
            HttpServletRequest httpRequest) {
        String email = clean(request == null ? null : request.getEmail());
        String code = clean(request == null ? null : request.getCode());
        validateEmail(email);
        if (code == null || !code.matches("\\d{6}")) {
            throw new AuthException("verification code must be six digits");
        }

        AppUser user = userRepository.findByNormalizedEmail(normalizeEmail(email))
                .orElseThrow(() -> new AuthException("invalid or expired verification code"));
        if (user.isEmailVerified()) {
            throw new AuthException("invalid or expired verification code");
        }

        emailVerificationService.consumeCode(user, code);
        user.setEmailVerified(true);
        userRepository.save(user);
        authenticateSession(user, httpRequest);
        return toAuthUser(user);
    }

    @Transactional(readOnly = true)
    public AuthUserDTO login(AuthRequestDTO request, HttpServletRequest httpRequest) {
        String email = clean(request == null ? null : request.getEmail());
        String password = request == null ? null : request.getPassword();
        validateEmail(email);
        requirePasswordForLogin(password);

        AppUser user = userRepository.findByNormalizedEmail(normalizeEmail(email))
                .orElseThrow(() -> new AuthException("invalid email or password"));
        if (user.getPasswordHash() == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new AuthException("invalid email or password");
        }
        if (!user.isEmailVerified()) {
            throw new AuthException("email verification is required; check your inbox");
        }
        if (!UsernamePolicy.isValid(user.getUsername())) {
            throw new AuthException("username setup is required; continue with Google to choose one");
        }

        authenticateSession(user, httpRequest);
        return toAuthUser(user);
    }

    @Transactional
    public synchronized AuthUserDTO playAsGuest(HttpServletRequest httpRequest) {
        Instant now = clock.instant();
        Authentication existingAuthentication = SecurityContextHolder.getContext().getAuthentication();
        if (existingAuthentication != null
                && existingAuthentication.isAuthenticated()
                && existingAuthentication.getPrincipal() instanceof AuthenticatedUserDetails principal) {
            AppUser existingUser = userRepository.findById(principal.getId()).orElse(null);
            if (existingUser != null && existingUser.isGuest() && existingUser.isGuestActive(now)) {
                return AuthUserDTO.temporaryGuest(existingUser);
            }
            if (existingUser != null && !existingUser.isGuest()) {
                throw new AuthException("log out before starting guest mode");
            }
        }

        String ip = httpRequest == null || httpRequest.getRemoteAddr() == null ? "unknown" : httpRequest.getRemoteAddr();
        guestCreationsByIp.values().removeIf(times -> {
            while (!times.isEmpty() && !times.peekFirst().plus(GUEST_SESSION_DURATION).isAfter(now)) times.removeFirst();
            return times.isEmpty();
        });
        ArrayDeque<Instant> creations = guestCreationsByIp.computeIfAbsent(ip, ignored -> new ArrayDeque<>());
        if (creations.size() >= MAX_GUESTS_PER_IP_PER_DAY
                || userRepository.countByGuestTrueAndGuestExpiresAtAfter(now) >= MAX_ACTIVE_GUEST_ACCOUNTS) {
            throw RateLimitExceededException.tooManyRequests(Duration.ofSeconds(30));
        }

        AppUser guest = new AppUser();
        guest.setUsername(nextGuestUsername());
        guest.setEmail("guest-" + UUID.randomUUID() + "@guest.invalid");
        guest.setNormalizedEmail(guest.getEmail().toLowerCase(Locale.ROOT));
        guest.setEmailVerified(true);
        guest.setGuest(true);
        guest.setRole(com.example.botfight.domain.auth.UserRole.GUEST);
        guest.setGuestExpiresAt(now.plus(GUEST_SESSION_DURATION));
        AppUser savedGuest = userRepository.save(guest);
        creations.addLast(now);
        authenticateSession(savedGuest, httpRequest);
        return AuthUserDTO.temporaryGuest(savedGuest);
    }

    private String nextGuestUsername() {
        for (int attempt = 0; attempt < GUEST_USERNAME_GENERATION_ATTEMPTS; attempt++) {
            String suffix = UUID.randomUUID().toString()
                    .replace("-", "")
                    .substring(0, GUEST_USERNAME_SUFFIX_LENGTH)
                    .toUpperCase(Locale.ROOT);
            String username = "Guest-" + suffix;
            if (!userRepository.existsByUsernameIgnoreCase(username)) {
                return username;
            }
        }
        throw new AuthException("guest mode is temporarily unavailable; try again");
    }

    @Transactional(readOnly = true)
    public AuthUserDTO currentUser(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)) {
            return AuthUserDTO.guest();
        }

        Instant now = Instant.now();
        return userRepository.findById(principal.getId())
                .filter(AppUser::isEmailVerified)
                .filter(user -> user.isGuestActive(now))
                .filter(user -> UsernamePolicy.isValid(user.getUsername()))
                .map(this::toAuthUser)
                .orElseGet(AuthUserDTO::guest);
    }

    public AuthUserDTO toAuthUser(AppUser user) {
        if (user != null && user.isGuest()) {
            return AuthUserDTO.temporaryGuest(user);
        }
        AuthUserDTO response = new AuthUserDTO();
        response.setAuthenticated(true);
        response.setId(user.getId());
        response.setEmail(user.getEmail());
        response.setUsername(user.getUsername());
        response.setAdmin(user.getRole() == com.example.botfight.domain.auth.UserRole.ADMIN);
        response.setHasPassword(user.getPasswordHash() != null && !user.getPasswordHash().isBlank());
        return response;
    }

    @Transactional
    public AuthUserDTO changePassword(
            Authentication authentication,
            PasswordChangeRequestDTO request) {
        return changePassword(authentication, request, null);
    }

    @Transactional
    public AuthUserDTO changePassword(
            Authentication authentication,
            PasswordChangeRequestDTO request,
            HttpServletRequest httpRequest) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)
                || principal.getId() == null) {
            throw new AuthException("authentication is required");
        }

        AppUser user = userRepository.findById(principal.getId())
                .orElseThrow(() -> new AuthException("authenticated user was not found"));
        if (user.isGuest()) {
            throw new AuthException("create an account before changing a password");
        }
        if (user.getPasswordHash() == null || user.getPasswordHash().isBlank()) {
            throw new AuthException("This account does not use password authentication.");
        }

        String currentPassword = request == null ? null : request.getCurrentPassword();
        String newPassword = request == null ? null : request.getNewPassword();
        String confirmPassword = request == null ? null : request.getConfirmPassword();
        PasswordPolicy.requireForLogin(currentPassword);
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new AuthException("current password is incorrect");
        }
        PasswordPolicy.validateForRegistration(newPassword);
        if (!newPassword.equals(confirmPassword)) {
            throw new AuthException("passwords do not match");
        }

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        var currentSession = httpRequest == null ? null : httpRequest.getSession(false);
        AuthSessionRegistry.afterCommit(() -> {
            AuthSessionRegistry.revoke(user.getId(), currentSession);
            if (webSocketSessions != null) webSocketSessions.closeSessionsForPrincipal(user.getEmail());
        });
        return toAuthUser(user);
    }

    public void authenticateSession(AppUser user, HttpServletRequest request) {
        AuthenticatedUserDetails principal = new AuthenticatedUserDetails(user);
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new UsernamePasswordAuthenticationToken(
                principal,
                null,
                principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
        var session = request.getSession(true);
        request.changeSessionId();
        session.removeAttribute(GoogleAuthService.GOOGLE_LINK_USER_SESSION_KEY);
        session.removeAttribute(GoogleAuthService.GOOGLE_LINK_EXPIRES_AT_SESSION_KEY);
        session.removeAttribute(GoogleAuthService.GOOGLE_PENDING_LINK_SESSION_KEY);
        session.removeAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_SESSION_KEY);
        session.removeAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_EXPIRES_AT_SESSION_KEY);
        session.setAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                context);
        AuthSessionRegistry.register(user.getId(), user.getEmail(), session);
    }

    private void validateEmail(String email) {
        if (email == null || email.length() > 255 || !EMAIL_PATTERN.matcher(email).matches()) {
            throw new AuthException("email must be a valid email address");
        }
    }

    private void requirePasswordForLogin(String password) {
        PasswordPolicy.requireForLogin(password);
    }

    private String normalizeEmail(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    private String clean(String value) {
        return value == null ? null : value.trim();
    }
}
