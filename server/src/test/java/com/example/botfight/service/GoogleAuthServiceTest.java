package com.example.botfight.service;

import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.auth.UserAuthIdentityService;
import com.example.botfight.config.BotFightSecurityProperties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.auth.AuthUserDTO;
import com.example.botfight.DTO.auth.GoogleLinkRequestDTO;
import com.example.botfight.DTO.auth.UsernameRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.auth.UserAuthIdentity;
import com.example.botfight.repository.UserAuthIdentityRepository;
import com.example.botfight.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.Optional;
import java.util.UUID;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
}
