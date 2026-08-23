package com.example.botfight.service;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.EmailVerificationService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.EmailVerification;
import com.example.botfight.repository.EmailVerificationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class EmailVerificationServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-02T12:00:00Z");
    private static final Pattern CODE_PATTERN = Pattern.compile("\\b(\\d{6})\\b");

    private final EmailVerificationRepository repository = org.mockito.Mockito.mock(EmailVerificationRepository.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final JavaMailSender mailSender = org.mockito.Mockito.mock(JavaMailSender.class);
    private final EmailVerificationService service = new EmailVerificationService(
            repository,
            passwordEncoder,
            mailSender,
            "no-reply@example.com",
            Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void sendsSixDigitCodeAndStoresOnlyItsHashForFiveMinutes() {
        AppUser user = user();
        when(repository.findByUserId(user.getId())).thenReturn(Optional.empty());

        Instant expiresAt = service.sendVerificationCode(user, false);

        var saved = org.mockito.ArgumentCaptor.forClass(EmailVerification.class);
        verify(repository).save(saved.capture());
        var message = org.mockito.ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mailSender).send(message.capture());

        Matcher matcher = CODE_PATTERN.matcher(message.getValue().getText());
        assertThat(matcher.find()).isTrue();
        String code = matcher.group(1);
        assertThat(code).hasSize(6);
        assertThat(passwordEncoder.matches(code, saved.getValue().getCodeHash())).isTrue();
        assertThat(saved.getValue().getUser()).isSameAs(user);
        assertThat(saved.getValue().getSentAt()).isEqualTo(NOW);
        assertThat(saved.getValue().getExpiresAt()).isEqualTo(NOW.plusSeconds(300));
        assertThat(expiresAt).isEqualTo(NOW.plusSeconds(300));
        assertThat(message.getValue().getTo()).containsExactly("pilot@example.com");
    }

    @Test
    void rejectsExpiredCode() {
        AppUser user = user();
        EmailVerification verification = new EmailVerification();
        verification.setUser(user);
        verification.setCodeHash(passwordEncoder.encode("123456"));
        verification.setExpiresAt(NOW.minusSeconds(1));
        when(repository.findByUserId(user.getId())).thenReturn(Optional.of(verification));

        assertThatThrownBy(() -> service.consumeCode(user, "123456"))
                .isInstanceOf(AuthException.class)
                .hasMessage("verification code has expired; request a new code");
    }

    private AppUser user() {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setEmail("pilot@example.com");
        user.setNormalizedEmail("pilot@example.com");
        user.setUsername("pilot");
        return user;
    }
}
