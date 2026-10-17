package com.example.botfight.service.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.example.botfight.DTO.auth.EmailVerificationRequestDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.auth.EmailVerification;
import com.example.botfight.domain.auth.PasswordResetRequest;
import com.example.botfight.repository.EmailVerificationRepository;
import com.example.botfight.repository.PasswordResetRequestRepository;
import com.example.botfight.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@DataJpaTest(properties = {"spring.flyway.enabled=false", "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.show-sql=false"})
@Import({PasswordResetService.class, EmailVerificationService.class, AuthService.class,
        AuthCodeAttemptPersistenceTest.Config.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class AuthCodeAttemptPersistenceTest {
    private static final Instant NOW = Instant.parse("2026-10-16T12:00:00Z");
    @Autowired UserRepository users;
    @Autowired PasswordResetRequestRepository resets;
    @Autowired EmailVerificationRepository verifications;
    @Autowired PasswordResetService resetService;
    @Autowired AuthService authService;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactionManager;

    @BeforeEach
    void defaults() {
        jdbc.execute("alter table users alter column created_at set default current_timestamp");
        jdbc.execute("alter table users alter column updated_at set default current_timestamp");
    }

    @Test
    void resetFailuresCommitAcrossRequestsAndExhaustTheCode() {
        String email = fixture(true);
        for (int i = 0; i < PasswordResetService.MAX_CODE_ATTEMPTS; i++) {
            assertThatThrownBy(() -> resetService.verifyCode(email, "000000", new MockHttpServletRequest()))
                    .isInstanceOf(AuthException.class);
        }
        assertThat(jdbc.queryForObject("select failed_attempts from password_reset_requests r join users u on u.id=r.user_id where u.email=?",
                Integer.class, email)).isEqualTo(5);
        assertThatThrownBy(() -> resetService.verifyCode(email, "123456", new MockHttpServletRequest()))
                .isInstanceOf(AuthException.class);
    }

    @Test
    void verificationFailuresCommitThroughTheOuterAuthTransaction() {
        String email = fixture(false);
        EmailVerificationRequestDTO request = new EmailVerificationRequestDTO();
        request.setEmail(email);
        request.setCode("000000");
        for (int i = 0; i < EmailVerificationService.MAX_CODE_ATTEMPTS; i++) {
            assertThatThrownBy(() -> authService.verifyEmail(request, new MockHttpServletRequest()))
                    .isInstanceOf(AuthException.class);
        }
        assertThat(jdbc.queryForObject("select failed_attempts from email_verifications v join users u on u.id=v.user_id where u.email=?",
                Integer.class, email)).isEqualTo(5);
        request.setCode("123456");
        assertThatThrownBy(() -> authService.verifyEmail(request, new MockHttpServletRequest()))
                .isInstanceOf(AuthException.class);
        assertThat(users.findByNormalizedEmail(email).orElseThrow().isEmailVerified()).isFalse();
    }

    private String fixture(boolean verified) {
        return new TransactionTemplate(transactionManager).execute(status -> {
            String email = UUID.randomUUID() + "@example.test";
            AppUser user = new AppUser();
            user.setEmail(email);
            user.setNormalizedEmail(email);
            user.setPasswordHash("password");
            user.setEmailVerified(verified);
            users.saveAndFlush(user);
            if (verified) {
                PasswordResetRequest code = new PasswordResetRequest();
                code.setUser(user);
                code.setCodeHash("123456");
                code.setSentAt(NOW);
                code.setExpiresAt(NOW.plusSeconds(300));
                resets.save(code);
            } else {
                EmailVerification code = new EmailVerification();
                code.setUser(user);
                code.setCodeHash("123456");
                code.setSentAt(NOW);
                code.setExpiresAt(NOW.plusSeconds(300));
                verifications.save(code);
            }
            return email;
        });
    }

    @TestConfiguration
    static class Config {
        @Bean Clock clock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
        @Bean JavaMailSender mailSender() { return mock(JavaMailSender.class); }
        @Bean PasswordEncoder passwordEncoder() {
            return new PasswordEncoder() {
                public String encode(CharSequence raw) { return raw.toString(); }
                public boolean matches(CharSequence raw, String encoded) { return raw.toString().equals(encoded); }
            };
        }
    }
}
