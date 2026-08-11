package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.AuthRequestDTO;
import com.example.botfight.DTO.EmailVerificationRequestDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.lang.reflect.Field;
import java.util.Optional;
import java.util.UUID;
import static org.mockito.ArgumentMatchers.eq;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private final UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final EmailVerificationService emailVerificationService = org.mockito.Mockito.mock(EmailVerificationService.class);
    private final AuthService service = new AuthService(userRepository, passwordEncoder, emailVerificationService);

    @Test
    void registersUserWithNormalizedEmailAndHashedPassword() throws Exception {
        HttpServletRequest request = requestWithSession();
        when(userRepository.existsByNormalizedEmail("pilot@example.com")).thenReturn(false);
        when(userRepository.existsByUsernameIgnoreCase("pilot")).thenReturn(false);
        when(userRepository.save(any(AppUser.class))).thenAnswer(invocation -> {
            AppUser user = invocation.getArgument(0);
            setId(user, UUID.randomUUID());
            return user;
        });

        var response = service.register(authRequest("Pilot@Example.com", "pilot", "password123"), request);

        assertThat(response.isVerificationRequired()).isTrue();
        assertThat(response.getEmail()).isEqualTo("Pilot@Example.com");

        verify(userRepository).save(org.mockito.ArgumentMatchers.argThat(user ->
                user.getNormalizedEmail().equals("pilot@example.com")
                        && passwordEncoder.matches("password123", user.getPasswordHash())
                        && !user.isEmailVerified()));
        verify(emailVerificationService).sendVerificationCode(any(AppUser.class), eq(false));
    }

    @Test
    void rejectsInvalidRegistrationEmail() {
        assertThatThrownBy(() -> service.register(authRequest("not-email", "pilot", "password123"), requestWithSession()))
                .isInstanceOf(AuthException.class)
                .hasMessage("email must be a valid email address");
    }

    @Test
    void rejectsUnsafeRegistrationUsername() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "<script>", "password123"),
                requestWithSession()))
                .isInstanceOf(AuthException.class)
                .hasMessage("username may only contain letters, numbers, underscores, and hyphens");
    }

    @Test
    void rejectsShortRegistrationPassword() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "pilot", "short"),
                requestWithSession()))
                .isInstanceOf(AuthException.class)
                .hasMessage("password must be between 8 and 128 characters");
    }

    @Test
    void rejectsRegistrationPasswordWithSpaces() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "pilot", "password 123"),
                requestWithSession()))
                .isInstanceOf(AuthException.class)
                .hasMessage("password cannot contain spaces");
    }

    @Test
    void rejectsRegistrationUsernameLongerThanTwentyCharacters() {
        assertThatThrownBy(() -> service.register(
                authRequest("pilot@example.com", "this_username_is_way_too_long", "password123"),
                requestWithSession()))
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
}
