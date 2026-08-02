package com.example.botfight.service;

import com.example.botfight.DTO.AuthUserDTO;
import com.example.botfight.DTO.GoogleLinkRequestDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.UserAuthIdentity;
import com.example.botfight.repository.UserAuthIdentityRepository;
import com.example.botfight.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.io.Serializable;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GoogleAuthService {

    public static final String GOOGLE_PROVIDER = "google";
    public static final String GOOGLE_LINK_USER_SESSION_KEY = "botfight.google.link.user";
    public static final String GOOGLE_PENDING_LINK_SESSION_KEY = "botfight.google.pending.link";
    public static final String GOOGLE_PENDING_USERNAME_SESSION_KEY = "botfight.google.pending.username";

    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final int MAX_PROVIDER_SUBJECT_LENGTH = 255;

    private final UserRepository userRepository;
    private final UserAuthIdentityRepository identityRepository;
    private final UserAuthIdentityService identityService;
    private final CurrentUserService currentUserService;
    private final AuthService authService;
    private final PasswordEncoder passwordEncoder;

    public GoogleAuthService(
            UserRepository userRepository,
            UserAuthIdentityRepository identityRepository,
            UserAuthIdentityService identityService,
            CurrentUserService currentUserService,
            AuthService authService,
            PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.identityRepository = identityRepository;
        this.identityService = identityService;
        this.currentUserService = currentUserService;
        this.authService = authService;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public GoogleLoginResult loginOrPrepareLink(OAuth2User googleUser, HttpServletRequest request) {
        GoogleIdentity googleIdentity = readGoogleIdentity(googleUser);
        HttpSession session = request.getSession(true);
        UUID linkUserId = readUuid(session.getAttribute(GOOGLE_LINK_USER_SESSION_KEY));

        if (linkUserId != null) {
            AppUser linkUser = userRepository.findById(linkUserId)
                    .orElseThrow(() -> new AuthException("authenticated user was not found"));
            identityService.linkIdentity(
                    linkUser,
                    GOOGLE_PROVIDER,
                    googleIdentity.subject(),
                    googleIdentity.email(),
                    googleIdentity.emailVerified());
            clearGoogleFlowState(session);
            authService.authenticateSession(linkUser, request);
            return GoogleLoginResult.authenticated(true);
        }

        UserAuthIdentity linkedIdentity = identityRepository
                .findByProviderAndProviderSubject(GOOGLE_PROVIDER, googleIdentity.subject())
                .orElse(null);
        if (linkedIdentity != null) {
            if (linkedIdentity.getUser() == null) {
                throw new AuthException("Google account link is invalid");
            }
            if (!UsernamePolicy.isValid(linkedIdentity.getUser().getUsername())) {
                prepareUsername(session, linkedIdentity.getUser());
                clearAuthentication(session);
                return GoogleLoginResult.usernameRequired();
            }
            clearGoogleFlowState(session);
            authenticateLinkedIdentity(linkedIdentity, request);
            return GoogleLoginResult.authenticated(false);
        }

        AppUser existingEmailUser = userRepository.findByNormalizedEmail(googleIdentity.normalizedEmail()).orElse(null);
        if (existingEmailUser != null) {
            session.setAttribute(
                    GOOGLE_PENDING_LINK_SESSION_KEY,
                    new PendingGoogleLink(
                            existingEmailUser.getId(),
                            googleIdentity.subject(),
                            googleIdentity.email(),
                            googleIdentity.normalizedEmail(),
                            googleIdentity.emailVerified()));
            clearAuthentication(session);
            return GoogleLoginResult.needsLink();
        }

        AppUser newUser = new AppUser();
        newUser.setEmail(googleIdentity.email());
        newUser.setNormalizedEmail(googleIdentity.normalizedEmail());
        newUser.setUsername(null);
        newUser.setPasswordHash(null);
        AppUser savedUser = userRepository.save(newUser);
        identityService.linkIdentity(
                savedUser,
                GOOGLE_PROVIDER,
                googleIdentity.subject(),
                googleIdentity.email(),
                googleIdentity.emailVerified());
        prepareUsername(session, savedUser);
        clearAuthentication(session);
        return GoogleLoginResult.usernameRequired();
    }

    @Transactional
    public AuthUserDTO completePendingLink(GoogleLinkRequestDTO request, HttpServletRequest httpRequest) {
        HttpSession session = httpRequest.getSession(false);
        PendingGoogleLink pending = session == null
                ? null
                : sessionAttribute(session, GOOGLE_PENDING_LINK_SESSION_KEY, PendingGoogleLink.class);
        if (pending == null) {
            throw new AuthException("Google account linking has expired; try Google again");
        }

        String email = clean(request == null ? null : request.getEmail());
        String password = request == null ? null : request.getPassword();
        if (!isValidEmail(email) || !pending.normalizedEmail().equals(normalizeEmail(email))) {
            throw new AuthException("enter the email and password for the existing account");
        }
        PasswordPolicy.requireForLogin(password);

        AppUser user = userRepository.findById(pending.userId())
                .orElseThrow(() -> new AuthException("account could not be found"));
        if (user.getPasswordHash() == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new AuthException("enter the email and password for the existing account");
        }

        identityService.linkIdentity(
                user,
                GOOGLE_PROVIDER,
                pending.subject(),
                pending.providerEmail(),
                pending.emailVerified());
        clearGoogleFlowState(session);
        authService.authenticateSession(user, httpRequest);
        return authService.toAuthUser(user);
    }

    @Transactional
    public AuthUserDTO completePendingUsername(UsernameRequestDTO request, HttpServletRequest httpRequest) {
        HttpSession session = httpRequest.getSession(false);
        UUID userId = session == null
                ? null
                : readUuid(session.getAttribute(GOOGLE_PENDING_USERNAME_SESSION_KEY));
        if (userId == null) {
            throw new AuthException("username setup has expired; sign in with Google again");
        }

        String username = UsernamePolicy.clean(request == null ? null : request.getUsername());
        UsernamePolicy.validate(username);
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new AuthException("username is already taken");
        }

        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> new AuthException("account could not be found"));
        if (UsernamePolicy.isValid(user.getUsername())) {
            throw new AuthException("this account already has a username");
        }
        user.setUsername(username);
        try {
            userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException exception) {
            throw new AuthException("username is already taken");
        }
        clearGoogleFlowState(session);
        authService.authenticateSession(user, httpRequest);
        return authService.toAuthUser(user);
    }

    @Transactional(readOnly = true)
    public boolean isGoogleLinked(Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        return isGoogleLinked(user);
    }

    @Transactional(readOnly = true)
    public boolean isGoogleLinked(AppUser user) {
        return user != null && user.getId() != null && identityRepository.findByUserId(user.getId()).stream()
                .anyMatch(identity -> GOOGLE_PROVIDER.equalsIgnoreCase(identity.getProvider()));
    }

    @Transactional(readOnly = true)
    public void beginLink(Authentication authentication, HttpServletRequest request) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        request.getSession(true).setAttribute(GOOGLE_LINK_USER_SESSION_KEY, user.getId());
    }

    public void clearFlowState(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            clearGoogleFlowState(session);
        }
    }

    public void clearOAuthAuthentication(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            clearGoogleFlowState(session);
            session.removeAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        }
        SecurityContextHolder.clearContext();
    }

    public void restoreLinkUserAfterFailure(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        UUID linkUserId = session == null ? null : readUuid(session.getAttribute(GOOGLE_LINK_USER_SESSION_KEY));
        if (linkUserId == null) {
            clearOAuthAuthentication(request);
            return;
        }
        userRepository.findById(linkUserId).ifPresentOrElse(
                user -> {
                    clearFlowState(request);
                    authService.authenticateSession(user, request);
                },
                () -> clearOAuthAuthentication(request));
    }

    private GoogleIdentity readGoogleIdentity(OAuth2User googleUser) {
        if (googleUser == null) {
            throw new AuthException("Google authentication did not return an account");
        }
        String subject = clean(googleUser.getAttribute("sub"));
        String email = clean(googleUser.getAttribute("email"));
        Object verifiedAttribute = googleUser.getAttribute("email_verified");
        boolean emailVerified = verifiedAttribute instanceof Boolean verified
                ? verified
                : "true".equalsIgnoreCase(String.valueOf(verifiedAttribute));
        if (subject == null || subject.length() > MAX_PROVIDER_SUBJECT_LENGTH || !isValidEmail(email) || !emailVerified) {
            throw new AuthException("Google did not provide a verified email address");
        }
        return new GoogleIdentity(subject, email, normalizeEmail(email), emailVerified);
    }

    private void authenticateLinkedIdentity(UserAuthIdentity identity, HttpServletRequest request) {
        AppUser user = identity.getUser();
        if (user == null) {
            throw new AuthException("Google account link is invalid");
        }
        authService.authenticateSession(user, request);
    }

    private void clearGoogleFlowState(HttpSession session) {
        session.removeAttribute(GOOGLE_LINK_USER_SESSION_KEY);
        session.removeAttribute(GOOGLE_PENDING_LINK_SESSION_KEY);
        session.removeAttribute(GOOGLE_PENDING_USERNAME_SESSION_KEY);
    }

    private void prepareUsername(HttpSession session, AppUser user) {
        session.removeAttribute(GOOGLE_LINK_USER_SESSION_KEY);
        session.removeAttribute(GOOGLE_PENDING_LINK_SESSION_KEY);
        session.setAttribute(GOOGLE_PENDING_USERNAME_SESSION_KEY, user.getId());
    }

    private void clearAuthentication(HttpSession session) {
        SecurityContextHolder.clearContext();
        session.removeAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
    }

    private UUID readUuid(Object value) {
        if (value instanceof UUID uuid) {
            return uuid;
        }
        if (value instanceof String string) {
            try {
                return UUID.fromString(string);
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        return null;
    }

    private <T> T sessionAttribute(HttpSession session, String key, Class<T> type) {
        Object value = session.getAttribute(key);
        return type.isInstance(value) ? type.cast(value) : null;
    }

    private boolean isValidEmail(String email) {
        return email != null && email.length() <= 255 && EMAIL_PATTERN.matcher(email).matches();
    }

    private String normalizeEmail(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    private String clean(String value) {
        return value == null ? null : value.trim();
    }

    public record GoogleLoginResult(boolean authenticated, boolean linkRequired, boolean profileLink) {

        public static GoogleLoginResult authenticated(boolean profileLink) {
            return new GoogleLoginResult(true, false, profileLink);
        }

        public static GoogleLoginResult needsLink() {
            return new GoogleLoginResult(false, true, false);
        }

        public static GoogleLoginResult usernameRequired() {
            return new GoogleLoginResult(false, false, false);
        }
    }

    private record GoogleIdentity(String subject, String email, String normalizedEmail, boolean emailVerified) {
    }

    private record PendingGoogleLink(
            UUID userId,
            String subject,
            String providerEmail,
            String normalizedEmail,
            boolean emailVerified) implements Serializable {
    }
}
