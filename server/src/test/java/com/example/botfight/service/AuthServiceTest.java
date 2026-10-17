package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.auth.AuthRequestDTO;
import com.example.botfight.DTO.auth.EmailVerificationRequestDTO;
import com.example.botfight.DTO.auth.PasswordChangeRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.security.AuthenticatedUserDetails;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.AuthSessionRegistry;
import com.example.botfight.service.auth.EmailVerificationService;
import com.example.botfight.service.auth.PasswordPolicy;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.lang.reflect.Field;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private final UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final EmailVerificationService emailVerificationService = org.mockito.Mockito.mock(EmailVerificationService.class);
    private final AuthService service = new AuthService(userRepository, passwordEncoder, emailVerificationService);

    @Test
    void registersUserWithNormalizedEmailAndHashedPassword() throws Exception {
        when(userRepository.existsByNormalizedEmail("pilot@example.com")).thenReturn(false);
        when(userRepository.existsByUsernameIgnoreCase("pilot")).thenReturn(false);
        when(userRepository.save(any(AppUser.class))).thenAnswer(invocation -> {
            AppUser user = invocation.getArgument(0);
            setId(user, UUID.randomUUID());
            return user;
        });

        var response = service.register(authRequest("Pilot@Example.com", "pilot", "password123"));

        assertThat(response.isVerificationRequired()).isTrue();
        assertThat(response.getEmail()).isEqualTo("Pilot@Example.com");

        verify(userRepository).save(org.mockito.ArgumentMatchers.argThat(user ->
                user.getNormalizedEmail().equals("pilot@example.com")
                        && passwordEncoder.matches("password123", user.getPasswordHash())
                        && !user.isEmailVerified()));
        verify(emailVerificationService).sendVerificationCode(any(AppUser.class), eq(false));
    }

    @Test
    void duplicateEmailRegistrationDoesNotSaveAnAccountOrSendAnotherVerificationEmail() {
        when(userRepository.existsByUsernameIgnoreCase("pilot")).thenReturn(false);
        when(userRepository.existsByNormalizedEmail("pilot@example.com")).thenReturn(true);

        assertThatThrownBy(() -> service.register(authRequest("pilot@example.com", "pilot", "password123")))
                .isInstanceOf(AuthException.class)
                .hasMessage("email is already registered");

        verify(userRepository, never()).save(any(AppUser.class));
        verifyNoInteractions(emailVerificationService);
    }

    @Test
    void usernameConflictIsValidatedBeforeAnyEmailAccountLookup() {
        when(userRepository.existsByUsernameIgnoreCase("taken-pilot")).thenReturn(true);

        assertThatThrownBy(() -> service.validateRegistration(
                authRequest("pilot@example.com", "taken-pilot", "password123")))
                .isInstanceOf(AuthException.class)
                .hasMessage("username is already taken");

        verify(userRepository, never()).existsByNormalizedEmail(anyString());
    }

    @Test
    void rejectsInvalidRegistrationEmail() {
        assertThatThrownBy(() -> service.register(authRequest("not-email", "pilot", "password123")))
                .isInstanceOf(AuthException.class)
                .hasMessage("email must be a valid email address");
    }

    @Test
    void rejectsUnsafeRegistrationUsername() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "<script>", "password123")))
                .isInstanceOf(AuthException.class)
                .hasMessage("username may only contain letters, numbers, underscores, and hyphens");
    }

    @Test
    void rejectsShortRegistrationPassword() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "pilot", "short")))
                .isInstanceOf(AuthException.class)
                .hasMessage("password must be at least 8 characters");
    }

    @Test
    void rejectsRegistrationPasswordWithSpaces() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "pilot", "password 123")))
                .isInstanceOf(AuthException.class)
                .hasMessage("password cannot contain spaces");
    }

    @Test
    void rejectsRegistrationUsernameLongerThanTwentyCharacters() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "this_username_is_way_too_long", "password123")))
                .isInstanceOf(AuthException.class)
                .hasMessage("username must be between 3 and 20 characters");
    }

    @Test
    void logsInWithExistingPasswordCredential() throws Exception {
        HttpServletRequest request = requestWithSession();
        AppUser user = user("pilot@example.com", "pilot", passwordEncoder.encode("password123"));
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));

        var response = service.login(authRequest("PILOT@example.com", null, "password123"), request);

        assertThat(response.isAuthenticated()).isTrue();
        assertThat(response.getId()).isEqualTo(user.getId());
        assertThat(response.getUsername()).isEqualTo("pilot");
        assertThat(response.isHasPassword()).isTrue();
    }

    @Test
    void changesPasswordForAnAccountWithALocalCredential() throws Exception {
        AppUser user = user("pilot@example.com", "pilot", passwordEncoder.encode("old-password"));
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
        Authentication authentication = authenticationFor(user);
        PasswordChangeRequestDTO request = new PasswordChangeRequestDTO();
        request.setCurrentPassword("old-password");
        request.setNewPassword("new-password");
        request.setConfirmPassword("new-password");

        var response = service.changePassword(authentication, request);

        assertThat(response.isAuthenticated()).isTrue();
        assertThat(response.isHasPassword()).isTrue();
        assertThat(passwordEncoder.matches("new-password", user.getPasswordHash())).isTrue();
        verify(userRepository).save(user);
    }

    @Test
    void rejectsPasswordChangeForGoogleOnlyAccount() throws Exception {
        AppUser user = user("pilot@example.com", "pilot", null);
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> service.changePassword(authenticationFor(user), new PasswordChangeRequestDTO()))
                .isInstanceOf(AuthException.class)
                .hasMessage("This account does not use password authentication.");
        verify(userRepository, org.mockito.Mockito.never()).save(user);
    }

    @Test
    void rejectsInvalidLoginPassword() throws Exception {
        AppUser user = user("pilot@example.com", "pilot", passwordEncoder.encode("password123"));
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> service.login(authRequest("pilot@example.com", null, "wrong"), requestWithSession()))
                .isInstanceOf(AuthException.class)
                .hasMessage("invalid email or password");
    }

    @Test
    void rejectsLoginUntilEmailIsVerified() throws Exception {
        AppUser user = user("pilot@example.com", "pilot", passwordEncoder.encode("password123"));
        user.setEmailVerified(false);
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> service.login(authRequest("pilot@example.com", null, "password123"), requestWithSession()))
                .isInstanceOf(AuthException.class)
                .hasMessage("email verification is required; check your inbox");
    }

    @Test
    void verifiesEmailAndAuthenticatesTheUser() throws Exception {
        HttpServletRequest request = requestWithSession();
        AppUser user = user("pilot@example.com", "pilot", passwordEncoder.encode("password123"));
        user.setEmailVerified(false);
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));

        EmailVerificationRequestDTO verificationRequest = new EmailVerificationRequestDTO();
        verificationRequest.setEmail("PILOT@example.com");
        verificationRequest.setCode("123456");

        var response = service.verifyEmail(verificationRequest, request);

        assertThat(response.isAuthenticated()).isTrue();
        assertThat(user.isEmailVerified()).isTrue();
        verify(emailVerificationService).consumeCode(user, "123456");
        verify(userRepository).save(user);
    }

    private AuthRequestDTO authRequest(String email, String username, String password) {
        AuthRequestDTO request = new AuthRequestDTO();
        request.setEmail(email);
        request.setUsername(username);
        request.setPassword(password);
        return request;
    }

    private HttpServletRequest requestWithSession() {
        HttpServletRequest request = org.mockito.Mockito.mock(HttpServletRequest.class);
        HttpSession session = org.mockito.Mockito.mock(HttpSession.class);
        when(request.getSession(true)).thenReturn(session);
        return request;
    }

    private AppUser user(String email, String username, String passwordHash) throws Exception {
        AppUser user = new AppUser();
        setId(user, UUID.randomUUID());
        user.setEmail(email);
        user.setNormalizedEmail(email.toLowerCase());
        user.setUsername(username);
        user.setPasswordHash(passwordHash);
        return user;
    }

    private void setId(AppUser user, UUID id) throws Exception {
        Field idField = AppUser.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(user, id);
    }

    private Authentication authenticationFor(AppUser user) {
        AuthenticatedUserDetails details = new AuthenticatedUserDetails(user);
        return new UsernamePasswordAuthenticationToken(details, null, details.getAuthorities());
    }

    @Nested
    class GuestCreation {
        private static final class MutableClock extends Clock {
            private Instant now = Instant.parse("2026-01-01T00:00:00Z");

            @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return now; }
            void advance(Duration d) { now = now.plus(d); }
        }

        @AfterEach
        void clearSecurityContext() {
            SecurityContextHolder.clearContext();
        }

        private static HttpServletRequest requestFrom(String ip) {
            HttpServletRequest request = mock(HttpServletRequest.class);
            when(request.getRemoteAddr()).thenReturn(ip);
            when(request.getSession(true)).thenReturn(mock(HttpSession.class));
            return request;
        }

        @Test
        void guestCreationAllowanceExpiresAfterTwentyFourHours() {
            UserRepository repository = mock(UserRepository.class);
            when(repository.save(any(AppUser.class))).thenAnswer(invocation -> {
                AppUser user = invocation.getArgument(0);
                user.setId(UUID.randomUUID());
                return user;
            });
            AuthService service = new AuthService(repository, new BCryptPasswordEncoder(), mock(EmailVerificationService.class));
            MutableClock clock = new MutableClock();
            service.setClock(clock);
            for (int i = 0; i < 100; i++) {
                SecurityContextHolder.clearContext();
                service.playAsGuest(requestFrom("198.51.100.7"));
            }
            SecurityContextHolder.clearContext();
            assertThatThrownBy(() -> service.playAsGuest(requestFrom("198.51.100.7")))
                    .isInstanceOf(com.example.botfight.service.limits.RateLimitExceededException.class);
            assertThat(service.playAsGuest(requestFrom("203.0.113.9")).isGuest()).isTrue();
            SecurityContextHolder.clearContext();
            clock.advance(Duration.ofHours(24));
            assertThat(service.playAsGuest(requestFrom("198.51.100.7")).isGuest()).isTrue();
        }
    }

    @Nested
    class SessionRevocation {
        @AfterEach
        void clear() {
            SecurityContextHolder.clearContext();
        }

        @Test
        void passwordChangeRevokesOtherAuthenticatedSessions() throws Exception {
            UserRepository userRepository = mock(UserRepository.class);
            BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
            AuthService service = new AuthService(userRepository, encoder, mock(EmailVerificationService.class));

            AppUser user = new AppUser();
            Field idField = AppUser.class.getDeclaredField("id");
            idField.setAccessible(true);
            idField.set(user, UUID.randomUUID());
            user.setEmail("pilot@example.com");
            user.setNormalizedEmail("pilot@example.com");
            user.setUsername("pilot");
            user.setPasswordHash(encoder.encode("old-password"));
            when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

            // Session B: a second, already-authenticated session (e.g. attacker / stolen cookie).
            MockHttpServletRequest requestB = new MockHttpServletRequest();
            service.authenticateSession(user, requestB);
            org.springframework.mock.web.MockHttpSession sessionB =
                    (org.springframework.mock.web.MockHttpSession) requestB.getSession(false);
            SecurityContextHolder.clearContext();
            MockHttpServletRequest requestA = new MockHttpServletRequest();
            service.authenticateSession(user, requestA);

            // Session A: the legitimate user changes the password.
            AuthenticatedUserDetails details = new AuthenticatedUserDetails(user);
            Authentication authA = new UsernamePasswordAuthenticationToken(details, null, details.getAuthorities());
            PasswordChangeRequestDTO dto = new PasswordChangeRequestDTO();
            dto.setCurrentPassword("old-password");
            dto.setNewPassword("new-password");
            dto.setConfirmPassword("new-password");
            service.changePassword(authA, dto, requestA);

            assertThat(sessionB.isInvalid()).as("other session is invalidated").isTrue();
            assertThat(((org.springframework.mock.web.MockHttpSession) requestA.getSession(false)).isInvalid()).isFalse();
        }

        @Test
        void switchingAccountsTransfersSessionOwnership() {
            UserRepository repository = mock(UserRepository.class);
            AuthService service = new AuthService(repository, new BCryptPasswordEncoder(), mock(EmailVerificationService.class));
            AppUser first = new AppUser();
            first.setId(UUID.randomUUID());
            first.setEmail("first@example.com");
            first.setUsername("first");
            AppUser second = new AppUser();
            second.setId(UUID.randomUUID());
            second.setEmail("second@example.com");
            second.setUsername("second");
            MockHttpServletRequest request = new MockHttpServletRequest();
            service.authenticateSession(first, request);
            service.authenticateSession(second, request);
            org.springframework.mock.web.MockHttpSession session =
                    (org.springframework.mock.web.MockHttpSession) request.getSession(false);
            AuthSessionRegistry.revoke(first.getId(), null);
            assertThat(session.isInvalid()).isFalse();
            AuthSessionRegistry.revoke(second.getId(), null);
            assertThat(session.isInvalid()).isTrue();
        }
    }

    @Nested
    class VerificationResponses {
        private final UserRepository userRepository = mock(UserRepository.class);
        private final EmailVerificationService verification = mock(EmailVerificationService.class);
        private final AuthService service =
                new AuthService(userRepository, new BCryptPasswordEncoder(), verification);

        private String messageFor(String email) {
            EmailVerificationRequestDTO req = new EmailVerificationRequestDTO();
            req.setEmail(email);
            req.setCode("123456");
            try {
                service.verifyEmail(req, null);
            } catch (AuthException e) {
                return e.getMessage();
            }
            return "no exception";
        }

        @Test
        void verifyEmailDoesNotRevealAccountState() {
            AppUser verified = new AppUser();
            verified.setEmailVerified(true);
            when(userRepository.findByNormalizedEmail("verified@example.com")).thenReturn(Optional.of(verified));
            when(userRepository.findByNormalizedEmail("nobody@example.com")).thenReturn(Optional.empty());

            String forVerified = messageFor("verified@example.com");
            String forMissing = messageFor("nobody@example.com");

            assertThat(forVerified).isEqualTo(forMissing);
        }
    }

    @Nested
    class PasswordBoundaries {
        @Test
        void utf8ByteBoundaryMatchesTheEncoderAndRejectsOversizedLoginInput() {
            BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
            String supported = "é".repeat(36);
            PasswordPolicy.validateForRegistration(supported);
            org.assertj.core.api.Assertions.assertThatCode(() -> encoder.encode(supported))
                    .doesNotThrowAnyException();
            assertThatThrownBy(() -> PasswordPolicy.validateForRegistration("é".repeat(37)))
                    .isInstanceOf(AuthException.class).hasMessageContaining("72 UTF-8 bytes");
            assertThatThrownBy(() -> PasswordPolicy.requireForLogin("a".repeat(73)))
                    .isInstanceOf(AuthException.class);
        }

        @Test
        void oversizedPasswordsAreRejectedBeforeRegistrationIsQueued() {
            UserRepository repo = mock(UserRepository.class);
            when(repo.save(any(AppUser.class))).thenAnswer(i -> i.getArgument(0));
            AuthService service = new AuthService(repo, new BCryptPasswordEncoder(), mock(EmailVerificationService.class));

            AuthRequestDTO request = new AuthRequestDTO();
            request.setEmail("pilot@example.com");
            request.setUsername("pilot");
            request.setPassword("a".repeat(80)); // exceeds the hashing limit

            // Reject before the asynchronous 202 so BCrypt never receives an unsupported password.
            assertThatThrownBy(() -> service.validateRegistration(request))
                    .isInstanceOf(AuthException.class).hasMessageContaining("72 UTF-8 bytes");
        }
    }
}
