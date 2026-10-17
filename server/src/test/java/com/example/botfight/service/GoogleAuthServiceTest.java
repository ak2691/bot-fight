package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.auth.AuthRequestDTO;
import com.example.botfight.DTO.auth.AuthUserDTO;
import com.example.botfight.DTO.auth.GoogleLinkRequestDTO;
import com.example.botfight.DTO.auth.UsernameRequestDTO;
import com.example.botfight.config.BotFightSecurityProperties;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.auth.UserAuthIdentity;
import com.example.botfight.repository.UserAuthIdentityRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.EmailVerificationService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.auth.UserAuthIdentityService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.user.OAuth2User;

class GoogleAuthServiceTest {

    private final UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    private final UserAuthIdentityRepository identityRepository = org.mockito.Mockito.mock(UserAuthIdentityRepository.class);
    private final UserAuthIdentityService identityService = org.mockito.Mockito.mock(UserAuthIdentityService.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final AuthService authService = org.mockito.Mockito.mock(AuthService.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final BotFightSecurityProperties securityProperties = new BotFightSecurityProperties();
    private final GoogleAuthService service = new GoogleAuthService(
            userRepository,
            identityRepository,
            identityService,
            currentUserService,
            authService,
            passwordEncoder,
            Clock.fixed(Instant.parse("2026-08-01T12:00:00Z"), ZoneOffset.UTC),
            securityProperties);
    private final HttpServletRequest request = org.mockito.Mockito.mock(HttpServletRequest.class);
    private final HttpSession session = new MockHttpSession();
    private final OAuth2User googleUser = org.mockito.Mockito.mock(OAuth2User.class);

    @BeforeEach
    void setUp() {
        when(request.getSession(true)).thenReturn(session);
        when(request.getSession(false)).thenReturn(session);
        when(googleUser.getAttribute("sub")).thenReturn("google-sub-123");
        when(googleUser.getAttribute("email")).thenReturn("pilot@example.com");
        when(googleUser.getAttribute("email_verified")).thenReturn(true);
        when(identityRepository.findByProviderAndProviderSubject("google", "google-sub-123"))
                .thenReturn(Optional.empty());
    }

    @Test
    void createsGoogleOnlyAccountAndLinksProviderIdentity() {
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.empty());
        when(userRepository.save(any(AppUser.class))).thenAnswer(invocation -> {
            AppUser saved = invocation.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        GoogleAuthService.GoogleLoginResult result = service.loginOrPrepareLink(googleUser, request);

        assertThat(result.authenticated()).isFalse();
        assertThat(result.linkRequired()).isFalse();
        assertThat(result.profileLink()).isFalse();
        verify(userRepository).save(org.mockito.ArgumentMatchers.argThat(user -> user.getUsername() == null));
        assertThat(session.getAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_SESSION_KEY)).isNotNull();
        assertThat(session.getAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_EXPIRES_AT_SESSION_KEY))
                .isEqualTo(Instant.parse("2026-08-01T12:00:00Z").plus(Duration.ofMinutes(15)));
        verify(identityService).linkIdentity(
                any(AppUser.class),
                org.mockito.ArgumentMatchers.eq("google"),
                org.mockito.ArgumentMatchers.eq("google-sub-123"),
                org.mockito.ArgumentMatchers.eq("pilot@example.com"),
                org.mockito.ArgumentMatchers.eq(true));
        verify(authService, never()).authenticateSession(any(AppUser.class), org.mockito.ArgumentMatchers.same(request));
    }

    @Test
    void pausesForExistingPasswordBeforeLinkingGoogleIdentity() {
        AppUser existing = user("pilot", "pilot@example.com", passwordEncoder.encode("password123"));
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(existing));

        GoogleAuthService.GoogleLoginResult result = service.loginOrPrepareLink(googleUser, request);

        assertThat(result.linkRequired()).isTrue();
        assertThat(session.getAttribute(GoogleAuthService.GOOGLE_PENDING_LINK_SESSION_KEY)).isNotNull();
    }

    @Test
    void linksPendingGoogleIdentityAfterExistingPasswordVerification() {
        AppUser existing = user("pilot", "pilot@example.com", passwordEncoder.encode("password123"));
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(existing));
        service.loginOrPrepareLink(googleUser, request);
        AuthUserDTO linkedUser = new AuthUserDTO();
        linkedUser.setAuthenticated(true);
        when(userRepository.findById(existing.getId())).thenReturn(Optional.of(existing));
        when(authService.toAuthUser(existing)).thenReturn(linkedUser);

        GoogleLinkRequestDTO linkRequest = new GoogleLinkRequestDTO();
        linkRequest.setEmail("PILOT@example.com");
        linkRequest.setPassword("password123");
        AuthUserDTO result = service.completePendingLink(linkRequest, request);

        assertThat(result).isSameAs(linkedUser);
        verify(identityService).linkIdentity(
                existing,
                "google",
                "google-sub-123",
                "pilot@example.com",
                true);
        verify(authService).authenticateSession(existing, request);
    }

    @Test
    void reportsInvalidCredentialsWhenPendingGoogleLinkPasswordIsWrong() {
        AppUser existing = user("pilot", "pilot@example.com", passwordEncoder.encode("password123"));
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(existing));
        service.loginOrPrepareLink(googleUser, request);
        when(userRepository.findById(existing.getId())).thenReturn(Optional.of(existing));

        GoogleLinkRequestDTO linkRequest = new GoogleLinkRequestDTO();
        linkRequest.setEmail("pilot@example.com");
        linkRequest.setPassword("wrong-password");

        assertThatThrownBy(() -> service.completePendingLink(linkRequest, request))
                .isInstanceOf(AuthException.class)
                .hasMessage("invalid email or password");
    }

    @Test
    void assignsUsernameAndOnlyThenAuthenticatesNewGoogleAccount() {
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.empty());
        when(userRepository.save(any(AppUser.class))).thenAnswer(invocation -> {
            AppUser saved = invocation.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });
        when(userRepository.findById(any(UUID.class))).thenAnswer(invocation -> {
            AppUser pending = new AppUser();
            pending.setId(invocation.getArgument(0));
            pending.setUsername(null);
            return Optional.of(pending);
        });
        when(userRepository.existsByUsernameIgnoreCase("new_pilot")).thenReturn(false);
        AuthUserDTO authenticatedUser = new AuthUserDTO();
        authenticatedUser.setAuthenticated(true);
        authenticatedUser.setUsername("new_pilot");
        when(authService.toAuthUser(any(AppUser.class))).thenReturn(authenticatedUser);

        service.loginOrPrepareLink(googleUser, request);
        UsernameRequestDTO usernameRequest = new UsernameRequestDTO();
        usernameRequest.setUsername("new_pilot");

        AuthUserDTO result = service.completePendingUsername(usernameRequest, request);

        assertThat(result).isSameAs(authenticatedUser);
        verify(authService).authenticateSession(any(AppUser.class), org.mockito.ArgumentMatchers.same(request));
    }

    @Test
    void rejectsExpiredPendingUsernameSetup() {
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.empty());
        when(userRepository.save(any(AppUser.class))).thenAnswer(invocation -> {
            AppUser saved = invocation.getArgument(0);
            saved.setId(UUID.randomUUID());
            return saved;
        });

        service.loginOrPrepareLink(googleUser, request);
        GoogleAuthService expiredService = new GoogleAuthService(
                userRepository,
                identityRepository,
                identityService,
                currentUserService,
                authService,
                passwordEncoder,
                Clock.fixed(Instant.parse("2026-08-01T12:15:00Z"), ZoneOffset.UTC),
                securityProperties);
        UsernameRequestDTO usernameRequest = new UsernameRequestDTO();
        usernameRequest.setUsername("new_pilot");

        assertThatThrownBy(() -> expiredService.completePendingUsername(usernameRequest, request))
                .isInstanceOf(AuthException.class)
                .hasMessage("username setup has expired; sign in with Google again");
        assertThat(session.getAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_SESSION_KEY)).isNull();
        assertThat(session.getAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_EXPIRES_AT_SESSION_KEY)).isNull();
    }

    @Test
    void asksForUsernameAgainWhenExistingGoogleIdentityHasNoUsername() {
        AppUser existing = user(null, "different@example.com", null);
        UserAuthIdentity identity = new UserAuthIdentity();
        identity.setUser(existing);
        identity.setProvider("google");
        identity.setProviderSubject("google-sub-123");
        when(identityRepository.findByProviderAndProviderSubject("google", "google-sub-123"))
                .thenReturn(Optional.of(identity));

        GoogleAuthService.GoogleLoginResult result = service.loginOrPrepareLink(googleUser, request);

        assertThat(result.authenticated()).isFalse();
        assertThat(session.getAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_SESSION_KEY))
                .isEqualTo(existing.getId());
    }

    @Test
    void signsInExistingGoogleIdentityWithoutUsingEmailAsTheIdentityKey() {
        AppUser existing = user("pilot", "different@example.com", null);
        UserAuthIdentity identity = new UserAuthIdentity();
        identity.setUser(existing);
        identity.setProvider("google");
        identity.setProviderSubject("google-sub-123");
        when(identityRepository.findByProviderAndProviderSubject("google", "google-sub-123"))
                .thenReturn(Optional.of(identity));

        GoogleAuthService.GoogleLoginResult result = service.loginOrPrepareLink(googleUser, request);

        assertThat(result.authenticated()).isTrue();
        assertThat(result.linkRequired()).isFalse();
        verify(authService).authenticateSession(existing, request);
    }

    private AppUser user(String username, String email, String passwordHash) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(email);
        user.setNormalizedEmail(email.toLowerCase());
        user.setPasswordHash(passwordHash);
        return user;
    }

    @Nested
    class AccountLinking {
        @Test
        void abandonedGoogleLinkMarkerOfUserADoesNotLinkUserBsGoogleIdentity() {
            UserRepository userRepository = mock(UserRepository.class);
            UserAuthIdentityRepository identityRepository = mock(UserAuthIdentityRepository.class);
            UserAuthIdentityService identityService = mock(UserAuthIdentityService.class);
            CurrentUserService currentUserService = mock(CurrentUserService.class);
            PasswordEncoder encoder = new BCryptPasswordEncoder();
            AuthService authService = new AuthService(userRepository, encoder, mock(EmailVerificationService.class));
            GoogleAuthService google = new GoogleAuthService(
                    userRepository, identityRepository, identityService, currentUserService,
                    authService, encoder, Clock.systemUTC(), new BotFightSecurityProperties());

            AppUser a = user("alice", "alice@example.com", encoder.encode("password123"));
            AppUser b = user("bobby", "bob@example.com", encoder.encode("password123"));
            when(userRepository.findById(a.getId())).thenReturn(Optional.of(a));
            when(userRepository.findByNormalizedEmail("bob@example.com")).thenReturn(Optional.of(b));
            when(currentUserService.requireCurrentUser(any())).thenReturn(a);
            when(identityRepository.findByProviderAndProviderSubject(anyString(), anyString()))
                    .thenReturn(Optional.empty());

            MockHttpServletRequest request = new MockHttpServletRequest();
            // A starts linking Google (GET /api/auth/google/link) and abandons the flow.
            google.beginLink(null, request);
            request.getSession(false).setAttribute(GoogleAuthService.GOOGLE_PENDING_LINK_SESSION_KEY, "stale");
            request.getSession(false).setAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_SESSION_KEY, a.getId());
            request.getSession(false).setAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_EXPIRES_AT_SESSION_KEY,
                    Instant.now().plusSeconds(300));

            // B logs in with a password in the same HTTP session (changeSessionId keeps attributes).
            AuthRequestDTO login = new AuthRequestDTO();
            login.setEmail("bob@example.com");
            login.setPassword("password123");
            authService.login(login, request);
            assertThat(request.getSession(false).getAttribute(GoogleAuthService.GOOGLE_LINK_USER_SESSION_KEY)).isNull();
            assertThat(request.getSession(false).getAttribute(GoogleAuthService.GOOGLE_PENDING_LINK_SESSION_KEY)).isNull();
            assertThat(request.getSession(false).getAttribute(GoogleAuthService.GOOGLE_PENDING_USERNAME_SESSION_KEY)).isNull();

            // B later signs in with B's own Google account.
            OAuth2User googleUser = mock(OAuth2User.class);
            when(googleUser.getAttribute("sub")).thenReturn("bob-google-sub");
            when(googleUser.getAttribute("email")).thenReturn("bob@example.com");
            when(googleUser.getAttribute("email_verified")).thenReturn(true);
            assertThat(google.loginOrPrepareLink(googleUser, request).linkRequired()).isTrue();

            // Correct behavior: B's Google identity is never attached to A.
            verify(identityService, never()).linkIdentity(
                    org.mockito.ArgumentMatchers.same(a), anyString(), anyString(), anyString(), anyBoolean());
        }

        @Test
        void authorizedLinkCompletesForTheSameAccount() {
            UserRepository users = mock(UserRepository.class);
            UserAuthIdentityService identities = mock(UserAuthIdentityService.class);
            CurrentUserService currentUsers = mock(CurrentUserService.class);
            AuthService auth = mock(AuthService.class);
            AppUser owner = user("alice", "alice@example.com", "hash");
            when(currentUsers.requireCurrentUser(any())).thenReturn(owner);
            when(users.findById(owner.getId())).thenReturn(Optional.of(owner));
            GoogleAuthService google = new GoogleAuthService(users, mock(UserAuthIdentityRepository.class),
                    identities, currentUsers, auth, mock(PasswordEncoder.class), Clock.systemUTC(),
                    new BotFightSecurityProperties());
            MockHttpServletRequest request = new MockHttpServletRequest();
            google.beginLink(null, request);
            OAuth2User googleUser = mock(OAuth2User.class);
            when(googleUser.getAttribute("sub")).thenReturn("alice-google-sub");
            when(googleUser.getAttribute("email")).thenReturn("alice.google@example.com");
            when(googleUser.getAttribute("email_verified")).thenReturn(true);

            assertThat(google.loginOrPrepareLink(googleUser, request).profileLink()).isTrue();
            verify(identities).linkIdentity(org.mockito.ArgumentMatchers.same(owner),
                    org.mockito.ArgumentMatchers.eq("google"),
                    org.mockito.ArgumentMatchers.eq("alice-google-sub"),
                    org.mockito.ArgumentMatchers.eq("alice.google@example.com"),
                    org.mockito.ArgumentMatchers.eq(true));
            assertThat(request.getSession(false).getAttribute(GoogleAuthService.GOOGLE_LINK_USER_SESSION_KEY)).isNull();
        }

        @Test
        void expiredLinkIntentCannotAttachGoogleIdentity() {
            UserRepository users = mock(UserRepository.class);
            UserAuthIdentityService identities = mock(UserAuthIdentityService.class);
            CurrentUserService currentUsers = mock(CurrentUserService.class);
            AppUser owner = user("alice", "alice@example.com", "hash");
            when(currentUsers.requireCurrentUser(any())).thenReturn(owner);
            Instant now = Instant.parse("2026-10-16T12:00:00Z");
            GoogleAuthService google = new GoogleAuthService(users, mock(UserAuthIdentityRepository.class),
                    identities, currentUsers, mock(AuthService.class), mock(PasswordEncoder.class),
                    Clock.fixed(now, java.time.ZoneOffset.UTC), new BotFightSecurityProperties());
            MockHttpServletRequest request = new MockHttpServletRequest();
            google.beginLink(null, request);
            request.getSession(false).setAttribute(GoogleAuthService.GOOGLE_LINK_EXPIRES_AT_SESSION_KEY,
                    now.minusSeconds(1));
            OAuth2User googleUser = mock(OAuth2User.class);
            when(googleUser.getAttribute("sub")).thenReturn("alice-google-sub");
            when(googleUser.getAttribute("email")).thenReturn("alice.google@example.com");
            when(googleUser.getAttribute("email_verified")).thenReturn(true);

            assertThatThrownBy(() -> google.loginOrPrepareLink(googleUser, request))
                    .isInstanceOf(AuthException.class).hasMessageContaining("expired");
            verify(identities, never()).linkIdentity(any(), anyString(), anyString(), anyString(), anyBoolean());
        }

        private static AppUser user(String username, String email, String hash) {
            AppUser u = new AppUser();
            u.setId(UUID.randomUUID());
            u.setUsername(username);
            u.setEmail(email);
            u.setNormalizedEmail(email);
            u.setPasswordHash(hash);
            u.setEmailVerified(true);
            return u;
        }
    }
}
