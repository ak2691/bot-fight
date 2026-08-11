package com.example.botfight.service;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.EmailVerification;
import com.example.botfight.repository.EmailVerificationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.security.SecureRandom;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmailVerificationService {

    public static final Duration CODE_VALIDITY = Duration.ofMinutes(5);
    private static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);
    private static final int CODE_BOUND = 900_000;
    private static final Logger log = LoggerFactory.getLogger(EmailVerificationService.class);

    private final EmailVerificationRepository verificationRepository;
    private final PasswordEncoder passwordEncoder;
    private final JavaMailSender mailSender;
    private final String fromAddress;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    public EmailVerificationService(
            EmailVerificationRepository verificationRepository,
            PasswordEncoder passwordEncoder,
            JavaMailSender mailSender,
            @Value("${botfight.mail.from:no-reply@example.test}") String fromAddress,
            Clock clock) {
        this.verificationRepository = verificationRepository;
        this.passwordEncoder = passwordEncoder;
        this.mailSender = mailSender;
        this.fromAddress = fromAddress;
        this.clock = clock;
    }

    @Transactional
    public Instant sendVerificationCode(AppUser user, boolean enforceResendCooldown) {
        if (user == null || user.getId() == null) {
            throw new AuthException("account could not be verified");
        }

        Instant now = clock.instant();
        EmailVerification verification = verificationRepository.findByUserId(user.getId()).orElse(null);
        if (enforceResendCooldown
                && verification != null
                && verification.getSentAt() != null
                && verification.getSentAt().plus(RESEND_COOLDOWN).isAfter(now)) {
            throw new AuthException("please wait before requesting another verification code");
        }

        String code = generateCode();
        if (verification == null) {
            verification = new EmailVerification();
            verification.setUser(user);
        }
        Instant expiresAt = now.plus(CODE_VALIDITY);
        verification.setCodeHash(passwordEncoder.encode(code));
        verification.setSentAt(now);
        verification.setExpiresAt(expiresAt);
        verificationRepository.save(verification);

        try {
            sendMessage(user.getEmail(), code);
        } catch (MailException exception) {
            log.warn("Unable to send email verification message for userId={}", user.getId(), exception);
            throw new AuthException("verification email could not be sent; try again later");
        }
        return expiresAt;
    }

    @Transactional
    public void consumeCode(AppUser user, String code) {
        EmailVerification verification = verificationRepository.findByUserId(user.getId())
                .orElseThrow(() -> new AuthException("invalid or expired verification code"));
        Instant now = clock.instant();
        if (verification.getExpiresAt() == null || !now.isBefore(verification.getExpiresAt())) {
            throw new AuthException("verification code has expired; request a new code");
        }
        if (code == null || !passwordEncoder.matches(code, verification.getCodeHash())) {
            throw new AuthException("invalid or expired verification code");
        }
        verificationRepository.delete(verification);
    }

    private String generateCode() {
        int value = 100_000 + secureRandom.nextInt(CODE_BOUND);
        return String.format(Locale.ROOT, "%06d", value);
    }

    private void sendMessage(String recipient, String code) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(fromAddress);
        message.setTo(recipient);
        message.setSubject("Verify your Bot Fight email");
        message.setText("Your Bot Fight verification code is: " + code
                + "\n\nThis code expires in 5 minutes. If you did not create this account, you can ignore this email.");
        mailSender.send(message);
    }
}
