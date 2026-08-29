package com.example.botfight.service;

import com.example.botfight.DTO.PasswordResetPasswordRequestDTO;
import com.example.botfight.DTO.PasswordResetStatusDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.PasswordResetRequest;
import com.example.botfight.repository.PasswordResetRequestRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.PasswordResetService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PasswordResetServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-29T12:00:00Z");
    private static final Pattern CODE_PATTERN = Pattern.compile("\\b(\\d{6})\\b");

    private final UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    private final PasswordResetRequestRepository resetRepository = org.mockito.Mockito.mock(PasswordResetRequestRepository.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final JavaMailSender mailSender = org.mockito.Mockito.mock(JavaMailSender.class);
    private final PasswordResetService service = new PasswordResetService(
            userRepository,
            resetRepository,
            passwordEncoder,
            mailSender,
            "no-reply@example.com",
            Clock.fixed(NOW, ZoneOffset.UTC));

    private AppUser user;
    private HttpServletRequest request;
    private MockHttpSession session;

    @BeforeEach
    void setUp() {
        user = user(passwordEncoder.encode("old-password"));
        session = new MockHttpSession();
        request = org.mockito.Mockito.mock(HttpServletRequest.class);
        when(request.getSession(true)).thenReturn(session);
        when(request.getSession(false)).thenReturn(session);
    }

    @Test
    void sendsResetCodeOnlyForLocalPasswordAccounts() {
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));
        when(resetRepository.findByUserId(user.getId())).thenReturn(Optional.empty());

        service.requestPasswordReset(" PILOT@example.com ");

        var saved = org.mockito.ArgumentCaptor.forClass(PasswordResetRequest.class);
        verify(resetRepository).save(saved.capture());
        var message = org.mockito.ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mailSender).send(message.capture());
        Matcher matcher = CODE_PATTERN.matcher(message.getValue().getText());

        assertThat(matcher.find()).isTrue();
        assertThat(passwordEncoder.matches(matcher.group(1), saved.getValue().getCodeHash())).isTrue();
        assertThat(saved.getValue().getUser()).isSameAs(user);
        assertThat(saved.getValue().getSentAt()).isEqualTo(NOW);
        assertThat(saved.getValue().getExpiresAt()).isEqualTo(NOW.plusSeconds(300));
        assertThat(message.getValue().getSubject()).isEqualTo("Reset your Bot Fight password");
    }

    @Test
    void doesNotSendResetCodeToGoogleOnlyAccounts() {
        user.setPasswordHash(null);
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));

        service.requestPasswordReset("pilot@example.com");

        verify(resetRepository, never()).save(any(PasswordResetRequest.class));
        verify(mailSender, never()).send(any(SimpleMailMessage.class));
    }

    @Test
    void verifiesCodeAndCreatesExpiringResetGrant() {
        PasswordResetRequest resetRequest = resetRequest("123456", NOW.plusSeconds(300));
        when(userRepository.findByNormalizedEmail("pilot@example.com")).thenReturn(Optional.of(user));
        when(resetRepository.findByUserId(user.getId())).thenReturn(Optional.of(resetRequest));

        Instant expiresAt = service.verifyCode("PILOT@example.com", "123456", request);

        assertThat(expiresAt).isEqualTo(NOW.plusSeconds(300));
        assertThat(session.getAttribute(PasswordResetService.PASSWORD_RESET_USER_SESSION_KEY)).isEqualTo(user.getId());
        assertThat(session.getAttribute(PasswordResetService.PASSWORD_RESET_EXPIRES_AT_SESSION_KEY)).isEqualTo(expiresAt);
        verify(resetRepository).delete(resetRequest);
    }

    @Test
    void resetRequiresGrantAndConsumesItAfterSavingTheNewPassword() {
        session.setAttribute(PasswordResetService.PASSWORD_RESET_USER_SESSION_KEY, user.getId());
        session.setAttribute(PasswordResetService.PASSWORD_RESET_EXPIRES_AT_SESSION_KEY, NOW.plusSeconds(300));
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
        PasswordResetPasswordRequestDTO passwordRequest = new PasswordResetPasswordRequestDTO();
        passwordRequest.setPassword("new-password");
        passwordRequest.setConfirmPassword("new-password");

        service.resetPassword(passwordRequest, request);

        assertThat(passwordEncoder.matches("new-password", user.getPasswordHash())).isTrue();
        verify(userRepository).save(user);
        assertThat(session.getAttribute(PasswordResetService.PASSWORD_RESET_USER_SESSION_KEY)).isNull();
        assertThat(session.getAttribute(PasswordResetService.PASSWORD_RESET_EXPIRES_AT_SESSION_KEY)).isNull();
    }

    @Test
    void statusRejectsExpiredGrantAndClearsIt() {
        session.setAttribute(PasswordResetService.PASSWORD_RESET_USER_SESSION_KEY, user.getId());
        session.setAttribute(PasswordResetService.PASSWORD_RESET_EXPIRES_AT_SESSION_KEY, NOW.minusSeconds(1));

        PasswordResetStatusDTO status = service.status(request);

        assertThat(status.valid()).isFalse();
        assertThat(session.getAttribute(PasswordResetService.PASSWORD_RESET_USER_SESSION_KEY)).isNull();
        assertThat(session.getAttribute(PasswordResetService.PASSWORD_RESET_EXPIRES_AT_SESSION_KEY)).isNull();
    }

    @Test
    void resetRejectsGoogleOnlyAccountEvenWithAStaleGrant() {
        user.setPasswordHash(null);
        session.setAttribute(PasswordResetService.PASSWORD_RESET_USER_SESSION_KEY, user.getId());
        session.setAttribute(PasswordResetService.PASSWORD_RESET_EXPIRES_AT_SESSION_KEY, NOW.plusSeconds(300));
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
        PasswordResetPasswordRequestDTO passwordRequest = new PasswordResetPasswordRequestDTO();
        passwordRequest.setPassword("new-password");
        passwordRequest.setConfirmPassword("new-password");

        assertThatThrownBy(() -> service.resetPassword(passwordRequest, request))
                .isInstanceOf(AuthException.class)
                .hasMessage("This account does not use password authentication.");
        verify(userRepository, never()).save(user);
    }

    private PasswordResetRequest resetRequest(String code, Instant expiresAt) {
        PasswordResetRequest resetRequest = new PasswordResetRequest();
        resetRequest.setUser(user);
        resetRequest.setCodeHash(passwordEncoder.encode(code));
        resetRequest.setSentAt(NOW);
        resetRequest.setExpiresAt(expiresAt);
        return resetRequest;
    }

    private AppUser user(String passwordHash) {
        AppUser account = new AppUser();
        account.setId(UUID.randomUUID());
        account.setEmail("pilot@example.com");
        account.setNormalizedEmail("pilot@example.com");
        account.setUsername("pilot");
        account.setEmailVerified(true);
        account.setPasswordHash(passwordHash);
        return account;
    }
}
