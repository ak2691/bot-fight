package com.example.botfight.service.auth;

import com.example.botfight.DTO.PasswordResetPasswordRequestDTO;
import com.example.botfight.DTO.PasswordResetStatusDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.PasswordResetRequest;
import com.example.botfight.repository.PasswordResetRequestRepository;
import com.example.botfight.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
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
public class PasswordResetService {

    public static final Duration CODE_VALIDITY = Duration.ofMinutes(5);
    public static final String PASSWORD_RESET_USER_SESSION_KEY = "botfight.password-reset.user";
    public static final String PASSWORD_RESET_EXPIRES_AT_SESSION_KEY = "botfight.password-reset.expires-at";

    private static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);
    private static final int CODE_BOUND = 900_000;
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

    private final UserRepository userRepository;
    private final PasswordResetRequestRepository resetRequestRepository;
    private final PasswordEncoder passwordEncoder;
    private final JavaMailSender mailSender;
    private final String fromAddress;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(
            UserRepository userRepository,
            PasswordResetRequestRepository resetRequestRepository,
            PasswordEncoder passwordEncoder,
            JavaMailSender mailSender,
            @Value("${botfight.mail.from:no-reply@example.test}") String fromAddress,
            Clock clock) {
        this.userRepository = userRepository;
        this.resetRequestRepository = resetRequestRepository;
        this.passwordEncoder = passwordEncoder;
        this.mailSender = mailSender;
        this.fromAddress = fromAddress;
        this.clock = clock;
    }

    /**
     * Starts a reset only for verified accounts that have a local password.
     * Callers should always return the generic request response so this lookup
     * does not disclose whether an address is registered.
     */
    @Transactional
    public void requestPasswordReset(String email) {
        String normalizedEmail = normalizeAndValidateEmail(email);
        AppUser user = userRepository.findByNormalizedEmail(normalizedEmail).orElse(null);
        if (user == null || !user.isEmailVerified() || !hasLocalPassword(user)) {
            return;
        }
        sendCode(user, true);
    }

    @Transactional
    public Instant verifyCode(String email, String code, HttpServletRequest request) {
        String normalizedEmail = normalizeAndValidateEmail(email);
        if (code == null || !code.trim().matches("\\d{6}")) {
            throw new AuthException("verification code must be six digits");
        }

        AppUser user = userRepository.findByNormalizedEmail(normalizedEmail)
                .orElseThrow(() -> invalidCodeException());
        if (!user.isEmailVerified() || !hasLocalPassword(user)) {
            throw invalidCodeException();
        }

        PasswordResetRequest resetRequest = resetRequestRepository.findByUserId(user.getId())
                .orElseThrow(() -> invalidCodeException());
        Instant now = clock.instant();
        if (resetRequest.getExpiresAt() == null || !now.isBefore(resetRequest.getExpiresAt())) {
            resetRequestRepository.delete(resetRequest);
            throw new AuthException("verification code has expired; request a new code");
        }
        if (!passwordEncoder.matches(code.trim(), resetRequest.getCodeHash())) {
            throw invalidCodeException();
        }

        resetRequestRepository.delete(resetRequest);
        establishResetGrant(request, user.getId(), resetRequest.getExpiresAt());
        return resetRequest.getExpiresAt();
    }

    @Transactional(readOnly = true)
    public PasswordResetStatusDTO status(HttpServletRequest request) {
        HttpSession session = request == null ? null : request.getSession(false);
        UUID userId = readUuid(session == null ? null : session.getAttribute(PASSWORD_RESET_USER_SESSION_KEY));
        Instant expiresAt = readInstant(session == null ? null : session.getAttribute(PASSWORD_RESET_EXPIRES_AT_SESSION_KEY));
        if (session == null || userId == null || expiresAt == null || !clock.instant().isBefore(expiresAt)) {
            clearResetGrant(session);
            return new PasswordResetStatusDTO(false);
        }

        boolean valid = userRepository.findById(userId)
                .filter(AppUser::isEmailVerified)
                .filter(this::hasLocalPassword)
                .isPresent();
        if (!valid) {
            clearResetGrant(session);
        }
        return new PasswordResetStatusDTO(valid);
    }

    @Transactional
    public void resetPassword(PasswordResetPasswordRequestDTO request, HttpServletRequest httpRequest) {
        String password = request == null ? null : request.getPassword();
        String confirmPassword = request == null ? null : request.getConfirmPassword();
        PasswordPolicy.validateForRegistration(password);
        if (!password.equals(confirmPassword)) {
            throw new AuthException("passwords do not match");
        }

        HttpSession session = httpRequest == null ? null : httpRequest.getSession(false);
        UUID userId = requireResetGrant(session);
        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> resetGrantExpired(session));
        if (!hasLocalPassword(user)) {
            clearResetGrant(session);
            throw new AuthException("This account does not use password authentication.");
        }

        user.setPasswordHash(passwordEncoder.encode(password));
        userRepository.save(user);
        clearResetGrant(session);
    }

    public boolean hasLocalPassword(AppUser user) {
        return user != null && user.getPasswordHash() != null && !user.getPasswordHash().isBlank();
    }

    private Instant sendCode(AppUser user, boolean enforceResendCooldown) {
        Instant now = clock.instant();
        PasswordResetRequest resetRequest = resetRequestRepository.findByUserId(user.getId()).orElse(null);
        if (enforceResendCooldown
                && resetRequest != null
                && resetRequest.getSentAt() != null
                && resetRequest.getSentAt().plus(RESEND_COOLDOWN).isAfter(now)) {
            // Keep repeated requests indistinguishable from unknown addresses.
            // The controller still applies the shared IP/email rate limits.
            return resetRequest.getExpiresAt();
        }

        String code = generateCode();
        if (resetRequest == null) {
            resetRequest = new PasswordResetRequest();
            resetRequest.setUser(user);
        }
        Instant expiresAt = now.plus(CODE_VALIDITY);
        resetRequest.setCodeHash(passwordEncoder.encode(code));
        resetRequest.setSentAt(now);
        resetRequest.setExpiresAt(expiresAt);
        resetRequestRepository.save(resetRequest);

        try {
            sendMessage(user.getEmail(), code);
        } catch (MailException exception) {
            log.warn("Unable to send password reset message for userId={}", user.getId(), exception);
            throw new AuthException("password reset email could not be sent; try again later");
        }
        return expiresAt;
    }

    private void establishResetGrant(HttpServletRequest request, UUID userId, Instant expiresAt) {
        if (request == null) {
            throw new AuthException("password reset session is unavailable");
        }
        HttpSession session = request.getSession(true);
        request.changeSessionId();
        session.setAttribute(PASSWORD_RESET_USER_SESSION_KEY, userId);
        session.setAttribute(PASSWORD_RESET_EXPIRES_AT_SESSION_KEY, expiresAt);
    }

    private UUID requireResetGrant(HttpSession session) {
        UUID userId = readUuid(session == null ? null : session.getAttribute(PASSWORD_RESET_USER_SESSION_KEY));
        Instant expiresAt = readInstant(session == null ? null : session.getAttribute(PASSWORD_RESET_EXPIRES_AT_SESSION_KEY));
        if (session == null || userId == null || expiresAt == null || !clock.instant().isBefore(expiresAt)) {
            clearResetGrant(session);
            throw resetGrantExpired(session);
        }
        return userId;
    }

    private AuthException resetGrantExpired(HttpSession session) {
        clearResetGrant(session);
        return new AuthException("password reset session is invalid or expired");
    }

    private void clearResetGrant(HttpSession session) {
        if (session != null) {
            session.removeAttribute(PASSWORD_RESET_USER_SESSION_KEY);
            session.removeAttribute(PASSWORD_RESET_EXPIRES_AT_SESSION_KEY);
        }
    }

    private AuthException invalidCodeException() {
        return new AuthException("invalid or expired password reset code");
    }

    private String normalizeAndValidateEmail(String email) {
        String cleaned = email == null ? null : email.trim();
        if (cleaned == null || cleaned.length() > 255 || !EMAIL_PATTERN.matcher(cleaned).matches()) {
            throw new AuthException("email must be a valid email address");
        }
        return cleaned.toLowerCase(Locale.ROOT);
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

    private Instant readInstant(Object value) {
        return value instanceof Instant instant ? instant : null;
    }

    private String generateCode() {
        int value = 100_000 + secureRandom.nextInt(CODE_BOUND);
        return String.format(Locale.ROOT, "%06d", value);
    }

    private void sendMessage(String recipient, String code) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(fromAddress);
        message.setTo(recipient);
        message.setSubject("Reset your Bot Fight password");
        message.setText("Your Bot Fight password reset code is: " + code
                + "\n\nThis code expires in 5 minutes. If you did not request a password reset, you can ignore this email.");
        mailSender.send(message);
    }
}
